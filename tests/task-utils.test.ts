import { describe, expect, it } from 'vitest'
import { deriveTaskStatus } from '../src/shared/task-utils'

describe('deriveTaskStatus', () => {
  it('prioritizes active work', () => {
    expect(deriveTaskStatus(['completed', 'running', 'queued'])).toBe('running')
    expect(deriveTaskStatus(['completed', 'queued'])).toBe('queued')
  })

  it('separates complete, partial, and failed outcomes', () => {
    expect(deriveTaskStatus(['completed', 'completed'])).toBe('completed')
    expect(deriveTaskStatus(['completed', 'failed'])).toBe('partial')
    expect(deriveTaskStatus(['failed', 'failed'])).toBe('failed')
  })
})
