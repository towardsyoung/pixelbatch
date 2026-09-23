import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppApi,
  CreatePromptInput,
  CreateTaskInput,
  ImageTask,
  RemoveTasksResult,
  SaveModelInput,
  TestModelInput,
  TestModelResult
} from '../shared/types'

const api: AppApi = {
  images: {
    pickFiles: () => ipcRenderer.invoke('images:pick-files'),
    pickFolder: () => ipcRenderer.invoke('images:pick-folder'),
    pickCover: () => ipcRenderer.invoke('images:pick-cover'),
    assetUrl: (path) => (path ? `pixelbatch://asset?path=${encodeURIComponent(path)}` : '')
  },
  tasks: {
    list: () => ipcRenderer.invoke('tasks:list'),
    get: (id) => ipcRenderer.invoke('tasks:get', id),
    create: (input: CreateTaskInput) => ipcRenderer.invoke('tasks:create', input),
    rename: (id, name) => ipcRenderer.invoke('tasks:rename', id, name),
    retry: (id) => ipcRenderer.invoke('tasks:retry', id),
    cancel: (id) => ipcRenderer.invoke('tasks:cancel', id),
    exportCompleted: (id) => ipcRenderer.invoke('tasks:export-completed', id),
    remove: (ids: string[]): Promise<RemoveTasksResult> => ipcRenderer.invoke('tasks:remove', ids)
  },
  prompts: {
    list: () => ipcRenderer.invoke('prompts:list'),
    create: (input: CreatePromptInput) => ipcRenderer.invoke('prompts:create', input),
    remove: (id) => ipcRenderer.invoke('prompts:remove', id)
  },
  models: {
    list: () => ipcRenderer.invoke('models:list'),
    save: (input: SaveModelInput) => ipcRenderer.invoke('models:save', input),
    remove: (id) => ipcRenderer.invoke('models:remove', id),
    test: (input: TestModelInput): Promise<TestModelResult> => ipcRenderer.invoke('models:test', input)
  },
  system: {
    revealFile: (path) => ipcRenderer.invoke('system:reveal-file', path),
    onTaskChanged: (callback: (task: ImageTask) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, task: ImageTask): void => callback(task)
      ipcRenderer.on('task:changed', listener)
      return () => ipcRenderer.removeListener('task:changed', listener)
    }
  }
}

contextBridge.exposeInMainWorld('pixelbatch', api)
