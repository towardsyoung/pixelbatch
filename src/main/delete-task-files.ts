import { rm, rmdir } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export async function removeUnreferencedOutputs(
  outputRoot: string,
  tasks: Array<{ taskId: string; paths: string[] }>,
  referenced: ReadonlySet<string>
): Promise<void> {
  const root = resolve(outputRoot)
  for (const task of tasks) {
    if (!/^[0-9a-f-]{36}$/i.test(task.taskId)) continue
    const directory = resolve(root, task.taskId)
    if (!isInside(root, directory)) continue
    for (const outputPath of task.paths) {
      if (referenced.has(outputPath)) continue
      const filePath = resolve(outputPath)
      if (!isInside(directory, filePath) || filePath === directory) continue
      await rm(filePath, { force: true }).catch(() => undefined)
    }
    await rmdir(directory).catch(() => undefined)
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}
