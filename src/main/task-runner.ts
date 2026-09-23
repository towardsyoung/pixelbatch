import { mkdir, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { AppDatabase } from './database'
import {
  decideFailure,
  MAX_ITEM_ATTEMPTS,
  RETRY_DELAYS_MS
} from './provider-errors'
import { createProvider, type ImageEditResult } from './providers'
import type { ImageTask, ModelConfig, TaskItem } from '../shared/types'

const IMAGE_CONCURRENCY = 2
const CANCELLED_MESSAGE = '已取消。'

export interface TaskRunnerHooks {
  concurrency?: number
  edit?: (input: { model: ModelConfig; inputPath: string; prompt: string }) => Promise<ImageEditResult>
  sleep?: (ms: number) => Promise<void>
}

export class TaskRunner {
  private readonly taskQueue: string[] = []
  private readonly cancelled = new Set<string>()
  private readonly stopped = new Set<string>()
  private readonly stopReasons = new Map<string, string>()
  private readonly inflightByTask = new Map<string, number>()
  private runningWorkers = 0
  private cursor = 0
  private readonly concurrency: number

  constructor(
    private readonly database: AppDatabase,
    private readonly outputRoot: string,
    private readonly onTaskChanged: (task: ImageTask) => void,
    private readonly hooks: TaskRunnerHooks = {}
  ) {
    this.concurrency = hooks.concurrency ?? IMAGE_CONCURRENCY
  }

  enqueue(taskId: string): void {
    this.cancelled.delete(taskId)
    this.stopped.delete(taskId)
    this.stopReasons.delete(taskId)
    if (!this.taskQueue.includes(taskId)) this.taskQueue.push(taskId)
    this.pump()
  }

  cancel(taskId: string): void {
    this.cancelled.add(taskId)
    this.database.failQueuedItems(taskId, CANCELLED_MESSAGE)
    this.emit(taskId)
  }

  discard(taskIds: Iterable<string>): void {
    const dropping = new Set(taskIds)
    for (const taskId of dropping) this.cancelled.add(taskId)
    this.taskQueue.splice(
      0,
      this.taskQueue.length,
      ...this.taskQueue.filter((taskId) => !dropping.has(taskId))
    )
  }

  isRunning(taskId: string): boolean {
    return (this.inflightByTask.get(taskId) ?? 0) > 0
  }

  private pump(): void {
    while (this.runningWorkers < this.concurrency) {
      const next = this.claimNextItem()
      if (!next) return
      this.runningWorkers += 1
      void this.runItem(next.taskId, next.item).finally(() => {
        this.runningWorkers -= 1
        this.release(next.taskId)
        this.pump()
      })
    }
  }

  private claimNextItem(): { taskId: string; item: TaskItem } | null {
    if (this.taskQueue.length === 0) return null
    for (let offset = 0; offset < this.taskQueue.length; offset += 1) {
      const index = (this.cursor + offset) % this.taskQueue.length
      const taskId = this.taskQueue[index]
      if (!taskId || this.cancelled.has(taskId) || this.stopped.has(taskId)) continue
      const item = this.database.getRunnableItems(taskId)[0]
      if (!item) continue
      this.database.updateItem(item.id, 'running')
      this.cursor = index + 1
      this.inflightByTask.set(taskId, (this.inflightByTask.get(taskId) ?? 0) + 1)
      return { taskId, item }
    }
    return null
  }

  private async runItem(taskId: string, item: TaskItem): Promise<void> {
    if (this.cancelled.has(taskId)) {
      this.database.updateItem(item.id, 'failed', null, CANCELLED_MESSAGE)
      this.emit(taskId)
      return
    }
    if (this.stopped.has(taskId)) {
      this.database.updateItem(item.id, 'failed', null, this.stopReasons.get(taskId) ?? '已停止。')
      this.emit(taskId)
      return
    }

    const task = this.database.getTask(taskId)
    if (!task) return
    this.emit(taskId)

    const model = this.database.getModel(task.modelConfigId)
    if (!model) {
      this.database.updateItem(item.id, 'failed', null, '模型已被删除。')
      this.emit(taskId)
      return
    }

    let provider
    try {
      provider = this.hooks.edit
        ? {
            edit: (request: { inputPath: string; prompt: string }) =>
              this.hooks.edit?.({ model, ...request }) ?? Promise.reject(new Error('编辑器不可用。'))
          }
        : createProvider(model)
    } catch (error) {
      const message = error instanceof Error ? error.message : '模型配置不可用。'
      this.database.updateItem(item.id, 'failed', null, message)
      this.stopRemaining(taskId, message)
      this.emit(taskId)
      return
    }

    const outputDirectory = join(this.outputRoot, taskId)
    try {
      await mkdir(outputDirectory, { recursive: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法创建结果目录。'
      this.database.updateItem(item.id, 'failed', null, message)
      this.emit(taskId)
      return
    }

    for (let attempt = 1; attempt <= MAX_ITEM_ATTEMPTS; attempt += 1) {
      if (await this.finishEarly(taskId, item.id)) return
      try {
        const result = await provider.edit({ inputPath: item.inputPath, prompt: task.prompt })
        if (!result) throw new Error('模型没有返回图片。')
        if (!this.database.getTask(taskId)) return
        const inputName = basename(item.inputPath, extname(item.inputPath))
        const extension =
          result.mimeType === 'image/webp' ? '.webp' : result.mimeType === 'image/jpeg' ? '.jpg' : '.png'
        const outputPath = join(
          outputDirectory,
          `${inputName}__edited_${item.id.slice(0, 6)}${extension}`
        )
        await writeFile(outputPath, result.data)
        this.database.updateItem(item.id, 'completed', outputPath)
        this.emit(taskId)
        return
      } catch (error) {
        if (this.cancelled.has(taskId)) {
          this.database.updateItem(item.id, 'failed', null, CANCELLED_MESSAGE)
          this.emit(taskId)
          return
        }
        const decision = decideFailure(error, attempt)
        const message = error instanceof Error ? error.message : '未知处理错误'
        if (decision === 'stop-batch') {
          this.database.updateItem(item.id, 'failed', null, message)
          this.stopRemaining(taskId, message)
          this.emit(taskId)
          return
        }
        if (decision === 'retry') {
          await this.sleep(RETRY_DELAYS_MS[attempt - 1] ?? 1000)
          continue
        }
        this.database.updateItem(item.id, 'failed', null, message)
        this.emit(taskId)
        return
      }
    }
  }

  private async finishEarly(taskId: string, itemId: string): Promise<boolean> {
    if (!this.database.getTask(taskId)) return true
    if (this.cancelled.has(taskId)) {
      this.database.updateItem(itemId, 'failed', null, CANCELLED_MESSAGE)
      this.emit(taskId)
      return true
    }
    if (this.stopped.has(taskId)) {
      this.database.updateItem(itemId, 'failed', null, this.stopReasons.get(taskId) ?? '已停止。')
      this.emit(taskId)
      return true
    }
    return false
  }

  private stopRemaining(taskId: string, reason: string): void {
    const message = `已停止：${reason}`.slice(0, 500)
    this.stopped.add(taskId)
    this.stopReasons.set(taskId, message)
    this.database.failQueuedItems(taskId, message)
  }

  private sleep(ms: number): Promise<void> {
    return this.hooks.sleep ? this.hooks.sleep(ms) : new Promise((resolve) => setTimeout(resolve, ms))
  }

  private release(taskId: string): void {
    const remaining = (this.inflightByTask.get(taskId) ?? 1) - 1
    if (remaining <= 0) this.inflightByTask.delete(taskId)
    else this.inflightByTask.set(taskId, remaining)
    this.taskQueue.splice(
      0,
      this.taskQueue.length,
      ...this.taskQueue.filter(
        (id) => (this.inflightByTask.get(id) ?? 0) > 0 || this.database.getRunnableItems(id).length > 0
      )
    )
  }

  private emit(taskId: string): void {
    const task = this.database.getTask(taskId)
    if (task) this.onTaskChanged(task)
  }
}
