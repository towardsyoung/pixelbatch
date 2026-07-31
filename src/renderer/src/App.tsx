import {
  Blocks,
  ChevronRight,
  GalleryVerticalEnd,
  History,
  LayoutGrid,
  Library,
  Settings2,
  Sparkles
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  CreatePromptInput,
  ImageTask,
  ModelConfig,
  PromptPreset,
  SaveModelInput,
  TaskItem
} from '../../shared/types'
import { Models } from './pages/Models'
import { PromptLibrary } from './pages/PromptLibrary'
import { Tasks } from './pages/Tasks'
import { Workspace } from './pages/Workspace'
import creatorQr from './assets/xiaoyang-creator-qr.png'

type Page = 'workspace' | 'tasks' | 'prompts' | 'models'

const navItems = [
  { id: 'workspace' as const, label: '批量创作', icon: LayoutGrid },
  { id: 'tasks' as const, label: '任务队列', icon: History },
  { id: 'prompts' as const, label: '提示词库', icon: Library },
  { id: 'models' as const, label: '模型设置', icon: Settings2 }
]

export default function App() {
  const [page, setPage] = useState<Page>('workspace')
  const [tasks, setTasks] = useState<ImageTask[]>([])
  const [prompts, setPrompts] = useState<PromptPreset[]>([])
  const [models, setModels] = useState<ModelConfig[]>([])
  const [initialTaskId, setInitialTaskId] = useState<string | null>(null)
  const [draftPrompt, setDraftPrompt] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshTasks = useCallback(async () => setTasks(await window.pixelbatch.tasks.list()), [])
  const refreshPrompts = useCallback(
    async () => setPrompts(await window.pixelbatch.prompts.list()),
    []
  )
  const refreshModels = useCallback(async () => setModels(await window.pixelbatch.models.list()), [])

  useEffect(() => {
    void Promise.all([refreshTasks(), refreshPrompts(), refreshModels()])
      .catch((error) => showError(error))
      .finally(() => setLoading(false))
  }, [refreshModels, refreshPrompts, refreshTasks])

  useEffect(
    () =>
      window.pixelbatch.system.onTaskChanged((updated) => {
        setTasks((current) => {
          const exists = current.some((task) => task.id === updated.id)
          return exists
            ? current.map((task) => (task.id === updated.id ? { ...task, ...updated } : task))
            : [updated, ...current]
        })
      }),
    []
  )

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const activeCount = useMemo(
    () => tasks.filter((task) => task.status === 'running' || task.status === 'queued').length,
    [tasks]
  )

  function showError(error: unknown) {
    setToast(error instanceof Error ? error.message : String(error))
  }

  async function createTask(input: {
    name?: string
    imagePaths: string[]
    prompt: string
    modelConfigId: string
  }) {
    try {
      const task = await window.pixelbatch.tasks.create({
        ...input,
        operation: 'ai-retouch'
      })
      await refreshTasks()
      setInitialTaskId(task.id)
      setPage('tasks')
      setToast('任务已进入处理队列')
    } catch (error) {
      showError(error)
    }
  }

  async function renameTask(id: string, name: string): Promise<ImageTask | null> {
    try {
      const updated = await window.pixelbatch.tasks.rename(id, name)
      setTasks((current) =>
        current.map((task) => (task.id === updated.id ? { ...task, ...updated } : task))
      )
      setToast(`批次已命名为“${updated.name}”`)
      return updated
    } catch (error) {
      showError(error)
      return null
    }
  }

  async function createPrompt(input: CreatePromptInput) {
    try {
      await window.pixelbatch.prompts.create(input)
      await refreshPrompts()
      setToast('提示词已保存')
    } catch (error) {
      showError(error)
    }
  }

  async function savePromptFromTask(task: ImageTask, item: TaskItem) {
    await createPrompt({
      title: task.name,
      prompt: task.prompt,
      beforePath: item.inputPath,
      afterPath: item.outputPath,
      coverPath: item.outputPath,
      source: 'task'
    })
  }

  async function removePrompt(id: string) {
    if (!window.confirm('删除这条提示词配方？图片文件不会被删除。')) return
    try {
      await window.pixelbatch.prompts.remove(id)
      await refreshPrompts()
    } catch (error) {
      showError(error)
    }
  }

  async function saveModel(input: SaveModelInput) {
    try {
      await window.pixelbatch.models.save(input)
      await refreshModels()
      setToast('模型配置已保存')
    } catch (error) {
      showError(error)
    }
  }

  async function removeModel(id: string) {
    if (!window.confirm('删除这个模型配置？此操作不可撤销。')) return
    try {
      await window.pixelbatch.models.remove(id)
      await refreshModels()
    } catch (error) {
      showError(error)
    }
  }

  async function retryTask(id: string) {
    try {
      await window.pixelbatch.tasks.retry(id)
      await refreshTasks()
      setToast('失败项目已重新进入队列')
    } catch (error) {
      showError(error)
    }
  }

  async function exportCompletedResults(id: string) {
    try {
      const result = await window.pixelbatch.tasks.exportCompleted(id)
      if (!result.canceled) setToast(`已另存 ${result.count} 张结果到 ${result.directory}`)
    } catch (error) {
      showError(error)
    }
  }

  if (loading) {
    return (
      <div className="app-loading">
        <span><Sparkles size={22} /></span>
        <strong>PixelBatch</strong>
        <small>正在打开你的图片工作台…</small>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand__mark">
            <GalleryVerticalEnd size={20} />
          </span>
          <span>
            <strong>PixelBatch</strong>
            <small>ECOMMERCE IMAGE OPS</small>
          </span>
        </div>

        <nav>
          <span className="nav-label">WORKSPACE</span>
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                className={page === item.id ? 'is-active' : ''}
                onClick={() => {
                  setInitialTaskId(null)
                  setPage(item.id)
                }}
              >
                <Icon size={18} />
                <span>{item.label}</span>
                {item.id === 'tasks' && activeCount > 0 ? (
                  <em>{activeCount}</em>
                ) : (
                  <ChevronRight size={14} className="nav-chevron" />
                )}
              </button>
            )
          })}
        </nav>

        <div className="sidebar__bottom">
          <figure className="creator-card">
            <img
              className="creator-card__qr"
              src={creatorQr}
              alt="小阳哥微信二维码"
              draggable={false}
            />
            <figcaption>
              <span>CREATOR</span>
              <strong>小阳哥出品</strong>
            </figcaption>
          </figure>
          <div className="local-badge">
            <Blocks size={17} />
            <span>
              <strong>LOCAL FIRST</strong>
              <small>任务数据仅存本机</small>
            </span>
          </div>
          <p>v0.1.0 · MVP</p>
        </div>
      </aside>

      <main className="main-content">
        <div className="topbar">
          <span>{navItems.find((item) => item.id === page)?.label}</span>
          <div>
            {activeCount > 0 && (
              <button
                className="activity-chip"
                onClick={() => {
                  setInitialTaskId(null)
                  setPage('tasks')
                }}
              >
                <i />
                {activeCount} 个任务进行中
              </button>
            )}
            <span className="date-chip">
              {new Intl.DateTimeFormat('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
              }).format(new Date())}
            </span>
          </div>
        </div>

        {page === 'workspace' && (
          <Workspace
            models={models}
            prompts={prompts}
            defaultPrompt={draftPrompt}
            onCreateTask={createTask}
            onOpenPrompts={() => setPage('prompts')}
          />
        )}
        {page === 'tasks' && (
          <Tasks
            tasks={tasks}
            initialTaskId={initialTaskId}
            onRetry={retryTask}
            onExport={exportCompletedResults}
            onRename={renameTask}
            onSavePrompt={savePromptFromTask}
          />
        )}
        {page === 'prompts' && (
          <PromptLibrary
            prompts={prompts}
            onUse={(preset) => {
              setDraftPrompt(preset.prompt)
              setPage('workspace')
              setToast('已把提示词套用到新任务')
            }}
            onCreate={createPrompt}
            onRemove={removePrompt}
          />
        )}
        {page === 'models' && (
          <Models models={models} onSave={saveModel} onRemove={removeModel} />
        )}
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
