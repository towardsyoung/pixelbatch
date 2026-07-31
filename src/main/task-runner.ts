import { mkdir, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { AppDatabase } from './database'
import { createProvider } from './providers'
import type { ImageTask } from '../shared/types'

export class TaskRunner {
  private readonly queue: string[] = []
  private readonly active = new Set<string>()
  private runningWorkers = 0
  private readonly concurrency = 2

  constructor(
    private readonly database: AppDatabase,
    private readonly outputRoot: string,
    private readonly onTaskChanged: (task: ImageTask) => void
  ) {}

  enqueue(taskId: string): void {
    if (!this.queue.includes(taskId) && !this.active.has(taskId)) {
      this.queue.push(taskId)
    }
    void this.pump()
  }

  private async pump(): Promise<void> {
    while (this.runningWorkers < this.concurrency && this.queue.length > 0) {
      const taskId = this.queue.shift()
      if (!taskId) return
      this.runningWorkers += 1
      this.active.add(taskId)
      void this.runTask(taskId).finally(() => {
        this.runningWorkers -= 1
        this.active.delete(taskId)
        void this.pump()
      })
    }
  }

  private async runTask(taskId: string): Promise<void> {
    const task = this.database.getTask(taskId)
    if (!task) return
    const model = this.database.getModel(task.modelConfigId)
    if (!model) return

    let provider
    try {
      provider = createProvider(model)
    } catch (error) {
      const message = error instanceof Error ? error.message : '模型配置不可用。'
      for (const item of this.database.getRunnableItems(taskId)) {
        this.database.updateItem(item.id, 'failed', null, message)
      }
      this.emit(taskId)
      return
    }

    const outputDirectory = join(this.outputRoot, taskId)
    await mkdir(outputDirectory, { recursive: true })

    for (const item of this.database.getRunnableItems(taskId)) {
      this.database.updateItem(item.id, 'running')
      this.emit(taskId)
      try {
        const result = await provider.edit({ inputPath: item.inputPath, prompt: task.prompt })
        const inputName = basename(item.inputPath, extname(item.inputPath))
        const extension =
          result.mimeType === 'image/webp' ? '.webp' : result.mimeType === 'image/jpeg' ? '.jpg' : '.png'
        const outputPath = join(
          outputDirectory,
          `${inputName}__edited_${item.id.slice(0, 6)}${extension}`
        )
        await writeFile(outputPath, result.data)
        this.database.updateItem(item.id, 'completed', outputPath)
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知处理错误'
        this.database.updateItem(item.id, 'failed', null, message)
      }
      this.emit(taskId)
    }
  }

  private emit(taskId: string): void {
    const task = this.database.getTask(taskId)
    if (task) this.onTaskChanged(task)
  }
}
