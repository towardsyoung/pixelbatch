import type { TaskItemStatus, TaskStatus } from './types'

export function deriveTaskStatus(statuses: TaskItemStatus[]): TaskStatus {
  if (statuses.length === 0) return 'failed'
  if (statuses.some((status) => status === 'running')) return 'running'
  if (statuses.some((status) => status === 'queued')) return 'queued'

  const completed = statuses.filter((status) => status === 'completed').length
  const failed = statuses.filter((status) => status === 'failed').length
  if (completed === statuses.length) return 'completed'
  if (failed === statuses.length) return 'failed'
  return 'partial'
}
