export const MAX_TASK_NAME_LENGTH = 120

interface UniqueTaskNameOptions {
  now?: Date
  randomSuffix?: () => string
}

export function normalizeTaskName(value: string): string {
  return value.trim().slice(0, MAX_TASK_NAME_LENGTH)
}

export function resolveUniqueTaskName(
  value: string,
  exists: (candidate: string) => boolean,
  options: UniqueTaskNameOptions = {}
): string {
  const baseName = normalizeTaskName(value)
  if (!exists(baseName)) return baseName

  const dateSuffix = formatDateSuffix(options.now ?? new Date())
  const datedName = withSuffix(baseName, dateSuffix)
  if (!exists(datedName)) return datedName

  const randomSuffix =
    options.randomSuffix ?? (() => Math.random().toString(36).slice(2, 6).toUpperCase())
  let candidate = datedName
  do {
    candidate = withSuffix(baseName, `${dateSuffix} · ${randomSuffix()}`)
  } while (exists(candidate))
  return candidate
}

function formatDateSuffix(date: Date): string {
  const part = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    part(date.getMonth() + 1),
    part(date.getDate()),
    '-',
    part(date.getHours()),
    part(date.getMinutes())
  ].join('')
}

function withSuffix(name: string, suffix: string): string {
  const separator = ' · '
  const safeSuffix = suffix.trim().slice(0, 24)
  const availableLength = MAX_TASK_NAME_LENGTH - separator.length - safeSuffix.length
  return `${name.slice(0, Math.max(1, availableLength)).trimEnd()}${separator}${safeSuffix}`
}
