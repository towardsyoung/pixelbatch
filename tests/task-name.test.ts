import { describe, expect, it } from 'vitest'
import {
  MAX_TASK_NAME_LENGTH,
  normalizeTaskName,
  resolveUniqueTaskName
} from '../src/shared/task-name'

describe('task names', () => {
  it('trims and limits names', () => {
    expect(normalizeTaskName('  夏季新品主图  ')).toBe('夏季新品主图')
    expect(normalizeTaskName('A'.repeat(150))).toHaveLength(MAX_TASK_NAME_LENGTH)
  })

  it('keeps an unused name unchanged', () => {
    expect(resolveUniqueTaskName('夏季新品', () => false)).toBe('夏季新品')
  })

  it('adds a date and then a random suffix when names repeat', () => {
    const existing = new Set(['夏季新品', '夏季新品 · 20260731-1435'])
    const uniqueName = resolveUniqueTaskName('夏季新品', (name) => existing.has(name), {
      now: new Date(2026, 6, 31, 14, 35),
      randomSuffix: () => 'A7K2'
    })

    expect(uniqueName).toBe('夏季新品 · 20260731-1435 · A7K2')
  })
})
