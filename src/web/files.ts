import { realpathSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { isAbsolute, relative, sep } from 'node:path'
import { HttpError } from './http'

export function resolveInsideRoot(root: string, target: string): string {
  const rootReal = realpathSync(root)
  let targetReal: string
  try {
    targetReal = realpathSync(target)
  } catch {
    throw new HttpError(404, '找不到这个文件。')
  }
  const rel = relative(rootReal, targetReal)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new HttpError(403, '只能访问 Web 工作区里的文件。')
  }
  return targetReal
}

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f]/g, '_') ?? ''
  const cleaned = base.trim()
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'image'
  return cleaned.startsWith('.') ? `image${cleaned}` : cleaned
}

export function safeDirectoryName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()
  return cleaned || 'export'
}

export function revealInFileManager(filePath: string): void {
  if (process.platform === 'darwin') {
    spawn('open', ['-R', filePath], { stdio: 'ignore', detached: true }).unref()
    return
  }
  if (process.platform === 'win32') {
    spawn('explorer', [`/select,${filePath}`], { stdio: 'ignore', detached: true }).unref()
    return
  }
  spawn('xdg-open', [filePath], { stdio: 'ignore', detached: true }).unref()
}

export function imageContentType(filePath: string): string {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  return 'image/png'
}
