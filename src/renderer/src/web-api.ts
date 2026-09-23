import type {
  AppApi,
  CreatePromptInput,
  CreateTaskInput,
  ExportResultsResult,
  FolderImageSelection,
  ImageTask,
  ModelConfig,
  PromptPreset,
  RemoveTasksResult,
  SaveModelInput,
  TestModelInput,
  TestModelResult
} from '../../shared/types'
import { isImageFileName } from '../../shared/images'

interface SaveDirectory {
  name: string
  getFileHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<{
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>
  }>
}

interface DirectoryPickerHost {
  showDirectoryPicker?: (options?: { mode?: 'readwrite' }) => Promise<SaveDirectory>
}

export function installWebApi(): void {
  window.pixelbatch = createWebApi()
}

function createWebApi(): AppApi {
  return {
    images: {
      pickFiles: async () => upload(await chooseFiles({ multiple: true, directory: false })),
      pickFolder,
      pickCover: async () => {
        const paths = await upload(await chooseFiles({ multiple: false, directory: false }))
        return paths[0] ?? null
      },
      assetUrl: (path) => (path ? assetUrl(path) : '')
    },
    tasks: {
      list: () => request<ImageTask[]>('/api/tasks'),
      get: (id) => request<ImageTask | null>(`/api/tasks/${encodeURIComponent(id)}`),
      create: (input) =>
        request<ImageTask>('/api/tasks', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input satisfies CreateTaskInput)
        }),
      rename: (id, name) =>
        request<ImageTask>(`/api/tasks/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name })
        }),
      retry: (id) =>
        request<void>(`/api/tasks/${encodeURIComponent(id)}/retry`, { method: 'POST' }),
      cancel: (id) =>
        request<void>(`/api/tasks/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
      remove: (ids) =>
        request<RemoveTasksResult>('/api/tasks/remove', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids })
        }),
      exportCompleted
    },
    prompts: {
      list: () => request<PromptPreset[]>('/api/prompts'),
      create: (input) =>
        request<PromptPreset>('/api/prompts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input satisfies CreatePromptInput)
        }),
      remove: (id) => request<void>(`/api/prompts/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
    models: {
      list: () => request<ModelConfig[]>('/api/models'),
      save: (input) =>
        request<ModelConfig>('/api/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input satisfies SaveModelInput)
        }),
      remove: (id) => request<void>(`/api/models/${encodeURIComponent(id)}`, { method: 'DELETE' }),
      test: (input) =>
        request<TestModelResult>('/api/models/test', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input satisfies TestModelInput)
        })
    },
    system: {
      revealFile: (path) =>
        request<void>('/api/system/reveal', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path })
        }),
      onTaskChanged(callback) {
        const source = new EventSource('/api/events')
        const listener = (event: Event): void => {
          const data = (event as MessageEvent<string>).data
          callback(JSON.parse(data) as ImageTask)
        }
        source.addEventListener('task', listener)
        return () => {
          source.removeEventListener('task', listener)
          source.close()
        }
      }
    }
  }
}

function assetUrl(path: string): string {
  return `/api/assets?path=${encodeURIComponent(path)}`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const text = await response.text()
  const data = text ? (JSON.parse(text) as { error?: string }) : null
  if (!response.ok) throw new Error(data?.error ?? `请求失败 (${response.status})`)
  return data as T
}

async function pickFolder(): Promise<FolderImageSelection | null> {
  const files = await chooseFiles({ multiple: true, directory: true })
  if (files.length === 0) return null
  const images = files.filter((file) => isImageFileName(file.name))
  const relative = images[0]?.webkitRelativePath || files[0]?.webkitRelativePath || ''
  const name = relative.split('/')[0] || '导入文件夹'
  return {
    folderPath: name,
    name,
    imagePaths: images.length ? await upload(images) : []
  }
}

async function upload(files: File[]): Promise<string[]> {
  const images = files.filter((file) => isImageFileName(file.name))
  if (images.length === 0) return []
  const body = new FormData()
  for (const file of images) body.append('files', file, file.name)
  const result = await request<{ paths: string[] }>('/api/images/upload', { method: 'POST', body })
  return result.paths
}

function chooseFiles(options: { multiple: boolean; directory: boolean }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp'
    input.multiple = options.multiple || options.directory
    if (options.directory) input.setAttribute('webkitdirectory', '')
    input.style.position = 'fixed'
    input.style.left = '-1000px'
    let settled = false
    const finish = (files: File[]): void => {
      if (settled) return
      settled = true
      input.remove()
      resolve(files)
    }
    input.addEventListener('change', () => finish([...(input.files ?? [])]))
    input.addEventListener('cancel', () => finish([]))
    document.body.appendChild(input)
    input.click()
  })
}

async function exportCompleted(id: string): Promise<ExportResultsResult> {
  const picker = (window as Window & DirectoryPickerHost).showDirectoryPicker
  if (!picker) return exportOnServer(id)
  try {
    const directory = await picker({ mode: 'readwrite' })
    const task = await request<ImageTask | null>(`/api/tasks/${encodeURIComponent(id)}`)
    const outputs =
      task?.items
        ?.filter((item) => item.status === 'completed' && item.outputPath)
        .map((item) => item.outputPath!) ?? []
    if (outputs.length === 0) throw new Error('当前任务还没有可另存的成功结果。')
    const used = new Set<string>()
    for (const outputPath of outputs) {
      const fileName = await nextFileName(directory, baseName(outputPath), used)
      const handle = await directory.getFileHandle(fileName, { create: true })
      const writable = await handle.createWritable()
      const response = await fetch(assetUrl(outputPath))
      if (!response.ok) throw new Error('下载处理结果失败。')
      await writable.write(await response.blob())
      await writable.close()
    }
    return { canceled: false, directory: directory.name, count: outputs.length }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { canceled: true, directory: null, count: 0 }
    }
    if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
      return exportOnServer(id)
    }
    throw error
  }
}

function exportOnServer(id: string): Promise<ExportResultsResult> {
  return request<ExportResultsResult>(`/api/tasks/${encodeURIComponent(id)}/export`, {
    method: 'POST'
  })
}

function baseName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || 'image'
}

async function nextFileName(directory: SaveDirectory, fileName: string, used: Set<string>): Promise<string> {
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  const extension = dot > 0 ? fileName.slice(dot) : ''
  let candidate = fileName
  let suffix = 1
  while (used.has(candidate) || (await fileExists(directory, candidate))) {
    candidate = `${stem} (${suffix})${extension}`
    suffix += 1
  }
  used.add(candidate)
  return candidate
}

async function fileExists(directory: SaveDirectory, name: string): Promise<boolean> {
  try {
    await directory.getFileHandle(name)
    return true
  } catch {
    return false
  }
}
