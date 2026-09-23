import { removeUnreferencedOutputs } from './delete-task-files'
import type { AppDatabase } from './database'
import type { TaskRunner } from './task-runner'
import type { RemoveTasksResult } from '../shared/types'

export async function removeTasksAndFiles(input: {
  database: AppDatabase
  taskRunner: TaskRunner
  outputRoot: string
  ids: string[]
}): Promise<RemoveTasksResult> {
  const uniqueIds = [...new Set(input.ids.filter((id) => typeof id === 'string' && id.trim()))]
  if (uniqueIds.length === 0) throw new Error('请选择要删除的任务。')

  const deletable = uniqueIds.filter(
    (id) => !input.taskRunner.isRunning(id) && input.database.getTask(id)?.status !== 'running'
  )
  input.taskRunner.discard(deletable)

  const removed = input.database.removeTasks(deletable)
  const deletedIds = removed.map((task) => task.taskId)
  const skippedIds = uniqueIds.filter(
    (id) =>
      !deletedIds.includes(id) &&
      (input.taskRunner.isRunning(id) || input.database.getTask(id)?.status === 'running')
  )
  if (deletedIds.length === 0) {
    throw new Error(
      skippedIds.length > 0 ? '处理中的任务不能删除，请等它结束后再删。' : '找不到要删除的任务。'
    )
  }

  const referenced = new Set<string>()
  for (const prompt of input.database.listPrompts()) {
    for (const path of [prompt.coverPath, prompt.beforePath, prompt.afterPath]) {
      if (path) referenced.add(path)
    }
  }
  await removeUnreferencedOutputs(input.outputRoot, removed, referenced)
  return {
    deletedIds,
    skippedIds: skippedIds.filter((id) => !deletedIds.includes(id))
  }
}
