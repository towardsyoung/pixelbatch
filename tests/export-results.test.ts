import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyResultsToDirectory, nextAvailablePath } from '../src/main/export-results'

describe('nextAvailablePath', () => {
  it('keeps the original file name when there is no conflict', () => {
    expect(nextAvailablePath('/exports', 'shoe.png', () => false)).toBe(
      join('/exports', 'shoe.png')
    )
  })

  it('adds a suffix without overwriting existing files', () => {
    const existing = new Set([
      join('/exports', 'shoe.png'),
      join('/exports', 'shoe (1).png')
    ])
    expect(nextAvailablePath('/exports', 'shoe.png', (path) => existing.has(path))).toBe(
      join('/exports', 'shoe (2).png')
    )
  })

  it('copies result files into the selected directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pixelbatch-export-'))
    const source = join(root, 'source.png')
    const destination = join(root, 'destination')
    await mkdir(destination)
    await writeFile(source, 'image-result')

    try {
      await copyResultsToDirectory([source], destination)
      expect(await readFile(join(destination, 'source.png'), 'utf8')).toBe('image-result')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
