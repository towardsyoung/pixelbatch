export type ProviderType = 'openai' | 'gemini'
export type TaskStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed'
export type TaskItemStatus = 'queued' | 'running' | 'completed' | 'failed'
export type OperationType = 'ai-retouch'

export interface ModelConfig {
  id: string
  name: string
  provider: ProviderType
  baseUrl: string
  apiKey: string
  apiKeyConfigured: boolean
  model: string
  enabled: boolean
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface TaskItem {
  id: string
  taskId: string
  inputPath: string
  outputPath: string | null
  status: TaskItemStatus
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface ImageTask {
  id: string
  name: string
  operation: OperationType
  prompt: string
  modelConfigId: string
  modelName: string
  status: TaskStatus
  total: number
  completed: number
  failed: number
  createdAt: string
  updatedAt: string
  items?: TaskItem[]
}

export interface PromptPreset {
  id: string
  title: string
  prompt: string
  coverPath: string | null
  beforePath: string | null
  afterPath: string | null
  source: 'manual' | 'task'
  createdAt: string
}

export interface CreateTaskInput {
  name?: string
  imagePaths: string[]
  prompt: string
  modelConfigId: string
  operation: OperationType
}

export interface CreatePromptInput {
  title: string
  prompt: string
  coverPath?: string | null
  beforePath?: string | null
  afterPath?: string | null
  source: 'manual' | 'task'
}

export interface SaveModelInput {
  id?: string
  name: string
  provider: ProviderType
  baseUrl: string
  apiKey?: string
  model: string
  enabled: boolean
  isDefault: boolean
}

export interface ExportResultsResult {
  canceled: boolean
  directory: string | null
  count: number
}

export interface FolderImageSelection {
  folderPath: string
  name: string
  imagePaths: string[]
}

export interface AppApi {
  images: {
    pickFiles: () => Promise<string[]>
    pickFolder: () => Promise<FolderImageSelection | null>
    pickCover: () => Promise<string | null>
    assetUrl: (path: string | null) => string
  }
  tasks: {
    list: () => Promise<ImageTask[]>
    get: (id: string) => Promise<ImageTask | null>
    create: (input: CreateTaskInput) => Promise<ImageTask>
    rename: (id: string, name: string) => Promise<ImageTask>
    retry: (id: string) => Promise<void>
    exportCompleted: (id: string) => Promise<ExportResultsResult>
  }
  prompts: {
    list: () => Promise<PromptPreset[]>
    create: (input: CreatePromptInput) => Promise<PromptPreset>
    remove: (id: string) => Promise<void>
  }
  models: {
    list: () => Promise<ModelConfig[]>
    save: (input: SaveModelInput) => Promise<ModelConfig>
    remove: (id: string) => Promise<void>
  }
  system: {
    revealFile: (path: string) => Promise<void>
    onTaskChanged: (callback: (task: ImageTask) => void) => () => void
  }
}
