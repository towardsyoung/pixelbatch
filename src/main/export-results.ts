import { existsSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

export function nextAvailablePath(
  directory: string,
  fileName: string,
  pathExists: (path: string) => boolean = existsSync
): string {
  const extension = extname(fileName)
  const stem = basename(fileName, extension)
  let candidate = join(directory, fileName)
  let suffix = 1

  while (pathExists(candidate)) {
    candidate = join(directory, `${stem} (${suffix})${extension}`)
    suffix += 1
  }
  return candidate
}

export async function copyResultsToDirectory(
  sourcePaths: string[],
  directory: string
): Promise<number> {
  for (const sourcePath of sourcePaths) {
    const destination = nextAvailablePath(directory, basename(sourcePath))
    await copyFile(sourcePath, destination)
  }
  return sourcePaths.length
}
