import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../src/main/database'
import { removeTasksAndFiles } from '../src/main/remove-tasks'
import { createLocalSecretStore } from '../src/main/secret-store'
import { TaskRunner } from '../src/main/task-runner'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('remove tasks', () => {
  it('deletes finished tasks, keeps originals, and removes unreferenced results', async () => {
    const root = createWorkspace()
    const database = openDatabase(root)
    const outputRoot = join(root, 'output')
    const runner = new TaskRunner(database, outputRoot, () => undefined)
    const modelId = database.listModels()[0]?.id ?? ''
    const keptInput = join(root, 'original.png')
    writeFileSync(keptInput, 'png')

    const disposable = createFinishedTask(database, outputRoot, modelId, '可删除', keptInput)
    const referenced = createFinishedTask(database, outputRoot, modelId, '被引用', keptInput)
    const running = database.createTask({
      imagePaths: [keptInput],
      prompt: '还在处理',
      modelConfigId: modelId,
      operation: 'ai-retouch'
    })
    const runningItem = database.getTask(running.id)?.items?.[0]
    if (!runningItem) throw new Error('缺少处理中的图片')
    database.updateItem(runningItem.id, 'running')
    database.createPrompt({
      title: '保留样片',
      prompt: '被引用',
      afterPath: referenced.outputPath,
      source: 'task'
    })

    const outside = join(root, 'outside.png')
    writeFileSync(outside, 'keep')
    const recreated = database.createTask({
      name: '外部路径',
      imagePaths: [keptInput],
      prompt: '外部路径',
      modelConfigId: modelId,
      operation: 'ai-retouch'
    })
    const recreatedItem = database.getTask(recreated.id)?.items?.[0]
    if (!recreatedItem) throw new Error('缺少外部路径任务')
    database.updateItem(recreatedItem.id, 'completed', outside)

    const result = await removeTasksAndFiles({
      database,
      taskRunner: runner,
      outputRoot,
      ids: [disposable.id, referenced.id, running.id, recreated.id, 'missing']
    })

    expect(result.deletedIds).toEqual([disposable.id, referenced.id, recreated.id])
    expect(result.skippedIds).toEqual([running.id])
    expect(database.getTask(disposable.id)).toBeNull()
    expect(database.getTask(referenced.id)).toBeNull()
    expect(database.getRunnableItems(disposable.id)).toEqual([])
    expect(existsSync(disposable.outputPath)).toBe(false)
    expect(existsSync(referenced.outputPath)).toBe(true)
    expect(existsSync(keptInput)).toBe(true)
    expect(existsSync(outside)).toBe(true)
    database.close()
  })

  it('refuses to delete a task that is still running', async () => {
    const root = createWorkspace()
    const database = openDatabase(root)
    const runner = new TaskRunner(database, join(root, 'output'), () => undefined)
    const modelId = database.listModels()[0]?.id ?? ''
    const task = database.createTask({
      imagePaths: [join(root, 'original.png')],
      prompt: '处理中',
      modelConfigId: modelId,
      operation: 'ai-retouch'
    })
    const item = database.getTask(task.id)?.items?.[0]
    if (!item) throw new Error('缺少任务图片')
    database.updateItem(item.id, 'running')

    await expect(
      removeTasksAndFiles({
        database,
        taskRunner: runner,
        outputRoot: join(root, 'output'),
        ids: [task.id]
      })
    ).rejects.toThrow('处理中的任务不能删除')
    expect(database.getTask(task.id)?.status).toBe('running')
    database.close()
  })
})

function createWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'pixelbatch-remove-'))
  directories.push(root)
  return root
}

function openDatabase(root: string): AppDatabase {
  return new AppDatabase(join(root, 'pixelbatch.sqlite'), createLocalSecretStore())
}

function createFinishedTask(
  database: AppDatabase,
  outputRoot: string,
  modelId: string,
  name: string,
  inputPath: string
): { id: string; outputPath: string } {
  const task = database.createTask({
    name,
    imagePaths: [inputPath],
    prompt: name,
    modelConfigId: modelId,
    operation: 'ai-retouch'
  })
  const outputDirectory = join(outputRoot, task.id)
  mkdirSync(outputDirectory, { recursive: true })
  const outputPath = join(outputDirectory, 'result.png')
  writeFileSync(outputPath, 'result')
  const item = database.getTask(task.id)?.items?.[0]
  if (!item) throw new Error('缺少任务图片')
  database.updateItem(item.id, 'completed', outputPath)
  return { id: task.id, outputPath }
}
