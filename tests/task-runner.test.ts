import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../src/main/database'
import { ProviderRequestError } from '../src/main/provider-errors'
import { createLocalSecretStore } from '../src/main/secret-store'
import { TaskRunner, type TaskRunnerHooks } from '../src/main/task-runner'
import type { ImageEditResult } from '../src/main/providers'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('task runner', () => {
  it('processes two images from the same batch at once', async () => {
    const { database, outputRoot, modelId } = createWorkspace()
    const task = createTask(database, modelId, ['a.png', 'b.png', 'c.png'])
    let active = 0
    let maxActive = 0
    const pending: Array<() => void> = []
    const runner = startRunner(database, outputRoot, {
      concurrency: 2,
      edit: () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        return new Promise((resolve) => {
          pending.push(() => {
            active -= 1
            resolve(image())
          })
        })
      }
    })

    runner.enqueue(task.id)
    await waitFor(() => pending.length >= 2)
    expect(maxActive).toBe(2)
    while (database.getTask(task.id)?.status !== 'completed') {
      const finish = pending.shift()
      if (finish) finish()
      else await delay(5)
    }
    expect(database.getTask(task.id)?.items?.every((item) => item.status === 'completed')).toBe(true)
    database.close()
  })

  it('cancels images that have not started and lets the current request finish', async () => {
    const { database, outputRoot, modelId } = createWorkspace()
    const task = createTask(database, modelId, ['a.png', 'b.png', 'c.png'])
    let started = 0
    let release: (result: ImageEditResult) => void = () => undefined
    const runner = startRunner(database, outputRoot, {
      concurrency: 1,
      edit: () => {
        started += 1
        return new Promise((resolve) => {
          release = resolve
        })
      }
    })

    runner.enqueue(task.id)
    await waitFor(() => started === 1)
    runner.cancel(task.id)
    release(image())
    await waitFor(() => database.getTask(task.id)?.status !== 'running')

    const stored = database.getTask(task.id)
    expect(started).toBe(1)
    expect(stored?.items?.filter((item) => item.status === 'completed')).toHaveLength(1)
    expect(stored?.items?.filter((item) => item.error === '已取消。')).toHaveLength(2)
    database.close()
  })

  it('stops the rest of a batch after an authentication failure', async () => {
    const { database, outputRoot, modelId } = createWorkspace()
    const task = createTask(database, modelId, ['a.png', 'b.png', 'c.png'])
    let calls = 0
    const runner = startRunner(database, outputRoot, {
      concurrency: 1,
      sleep: async () => undefined,
      edit: async () => {
        calls += 1
        throw new ProviderRequestError('图片服务请求失败 (401)：invalid api key', 'auth')
      }
    })

    runner.enqueue(task.id)
    await waitFor(() => database.getTask(task.id)?.status === 'failed')
    const stored = database.getTask(task.id)
    expect(calls).toBe(1)
    expect(stored?.items?.[0]?.error).toContain('401')
    expect(stored?.items?.slice(1).every((item) => item.error?.startsWith('已停止：'))).toBe(true)
    database.close()
  })

  it('retries a timeout and then keeps the successful image', async () => {
    const { database, outputRoot, modelId } = createWorkspace()
    const task = createTask(database, modelId, ['a.png'])
    let calls = 0
    const runner = startRunner(database, outputRoot, {
      concurrency: 1,
      sleep: async () => undefined,
      edit: async () => {
        calls += 1
        if (calls < 3) {
          const timeout = new Error('timed out')
          timeout.name = 'TimeoutError'
          throw timeout
        }
        return image()
      }
    })

    runner.enqueue(task.id)
    await waitFor(() => database.getTask(task.id)?.status === 'completed')
    expect(calls).toBe(3)
    database.close()
  })
})

function createWorkspace(): { database: AppDatabase; outputRoot: string; modelId: string } {
  const root = mkdtempSync(join(tmpdir(), 'pixelbatch-runner-'))
  directories.push(root)
  const database = new AppDatabase(join(root, 'pixelbatch.sqlite'), createLocalSecretStore())
  const model = database.listModels()[0]
  if (!model) throw new Error('缺少模型')
  database.saveModel({
    id: model.id,
    name: model.name,
    provider: model.provider,
    baseUrl: model.baseUrl,
    apiKey: 'sk-test',
    model: model.model,
    enabled: true,
    isDefault: true
  })
  return { database, outputRoot: join(root, 'output'), modelId: model.id }
}

function createTask(database: AppDatabase, modelId: string, names: string[]) {
  return database.createTask({
    imagePaths: names.map((name) => `/tmp/${name}`),
    prompt: '提亮',
    modelConfigId: modelId,
    operation: 'ai-retouch'
  })
}

function startRunner(database: AppDatabase, outputRoot: string, hooks: TaskRunnerHooks): TaskRunner {
  return new TaskRunner(database, outputRoot, () => undefined, hooks)
}

function image(): ImageEditResult {
  return { data: Buffer.from('ok'), mimeType: 'image/png' }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await delay(5)
  }
  throw new Error('等待任务状态超时')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
