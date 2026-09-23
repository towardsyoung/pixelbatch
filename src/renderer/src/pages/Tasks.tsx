import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  CheckCircle2,
  CircleStop,
  Clock3,
  Download,
  FolderSearch,
  Images,
  LoaderCircle,
  Maximize2,
  Pencil,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ImageTask, RemoveTasksResult, TaskItem } from '../../../shared/types'
import { CompareView } from '../components/CompareView'
import { ImageViewer } from '../components/ImageViewer'

const statusText: Record<ImageTask['status'], string> = {
  queued: '等待中',
  running: '处理中',
  completed: '已完成',
  partial: '部分完成',
  failed: '失败'
}

interface TasksProps {
  tasks: ImageTask[]
  initialTaskId: string | null
  onRetry: (id: string) => Promise<void>
  onCancel: (id: string) => Promise<void>
  onExport: (id: string) => Promise<void>
  onRename: (id: string, name: string) => Promise<ImageTask | null>
  onRemove: (ids: string[]) => Promise<RemoveTasksResult | null>
  onSavePrompt: (task: ImageTask, item: TaskItem) => Promise<void>
}

export function Tasks({
  tasks,
  initialTaskId,
  onRetry,
  onCancel,
  onExport,
  onRename,
  onRemove,
  onSavePrompt
}: TasksProps) {
  const [selectedId, setSelectedId] = useState<string | null>(initialTaskId)
  const [detail, setDetail] = useState<ImageTask | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [viewerItem, setViewerItem] = useState<TaskItem | null>(null)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [deleting, setDeleting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const allSelected = tasks.length > 0 && selectedIds.length === tasks.length

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => tasks.some((task) => task.id === id)))
  }, [tasks])

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedIds.length > 0 && !allSelected
    }
  }, [allSelected, selectedIds.length])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    void window.pixelbatch.tasks.get(selectedId).then((task) => {
      setDetail(task)
      setSelectedItemId(
        task?.items?.find((item) => item.status === 'completed')?.id ?? task?.items?.[0]?.id ?? null
      )
    })
  }, [selectedId, tasks])

  const selectedItem = useMemo(
    () => detail?.items?.find((item) => item.id === selectedItemId) ?? null,
    [detail, selectedItemId]
  )

  function toggleTask(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    )
  }

  async function cancelTask(id: string) {
    const task = tasks.find((item) => item.id === id) ?? (detail?.id === id ? detail : null)
    if (!task) return
    if (
      !window.confirm('取消这个任务？还没开始的图片会停止，正在处理的图片会完成。')
    ) {
      return
    }
    setCancelling(true)
    try {
      await onCancel(id)
    } finally {
      setCancelling(false)
    }
  }

  async function deleteTasks(ids: string[]) {
    const chosen = tasks.filter((task) => ids.includes(task.id))
    const deletable = chosen.filter((task) => task.status !== 'running')
    const runningCount = chosen.length - deletable.length
    if (deletable.length === 0) {
      window.alert('处理中的任务不能删除，请等它结束后再删。')
      return
    }
    const target =
      deletable.length === 1 ? `任务「${deletable[0]?.name ?? ''}」` : `这 ${deletable.length} 个任务`
    const runningNote = runningCount > 0 ? `\n${runningCount} 个处理中的任务会保留。` : ''
    if (
      !window.confirm(
        `删除${target}？\n任务记录会被移除。未被提示词库引用的处理结果会一起删除，原图保留。${runningNote}`
      )
    ) {
      return
    }
    setDeleting(true)
    try {
      const result = await onRemove(deletable.map((task) => task.id))
      if (!result) return
      setSelectedIds((current) => current.filter((id) => !result.deletedIds.includes(id)))
      if (selectedId && result.deletedIds.includes(selectedId)) setSelectedId(null)
    } finally {
      setDeleting(false)
    }
  }

  async function saveName() {
    if (!detail || editingName === null || !editingName.trim()) return
    if (editingName.trim() === detail.name) {
      setEditingName(null)
      return
    }
    setRenaming(true)
    try {
      const updated = await onRename(detail.id, editingName)
      if (updated) {
        setDetail(updated)
        setEditingName(null)
      }
    } finally {
      setRenaming(false)
    }
  }

  if (detail) {
    const progress = detail.total ? Math.round((detail.completed / detail.total) * 100) : 0
    return (
      <div className="page task-detail-page">
        <button className="back-button" onClick={() => setSelectedId(null)}>
          <ArrowLeft size={16} /> 返回任务列表
        </button>
        <header className="detail-heading">
          <div>
            <div className="eyebrow">TASK / {detail.id.slice(0, 8).toUpperCase()}</div>
            <div className="detail-title-row">
              {editingName === null ? (
                <>
                  <h1>{detail.name}</h1>
                  <button
                    className="detail-title-edit"
                    aria-label="修改批次名称"
                    title="修改批次名称"
                    onClick={() => setEditingName(detail.name)}
                  >
                    <Pencil size={14} />
                  </button>
                </>
              ) : (
                <div className="detail-title-editor">
                  <input
                    autoFocus
                    value={editingName}
                    maxLength={120}
                    aria-label="批次名称"
                    onChange={(event) => setEditingName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void saveName()
                      if (event.key === 'Escape') setEditingName(null)
                    }}
                  />
                  <button
                    aria-label="保存批次名称"
                    title="保存"
                    disabled={!editingName.trim() || renaming}
                    onClick={() => void saveName()}
                  >
                    <CheckCircle2 size={16} />
                  </button>
                  <button
                    aria-label="取消修改"
                    title="取消"
                    disabled={renaming}
                    onClick={() => setEditingName(null)}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
            </div>
            <p>{detail.prompt}</p>
          </div>
          <div className="detail-heading__actions">
            {(detail.status === 'queued' || detail.status === 'running') && (
              <button
                className="button button--ghost"
                disabled={cancelling}
                onClick={() => void cancelTask(detail.id)}
              >
                <CircleStop size={16} /> 取消任务
              </button>
            )}
            <button
              className="button button--danger"
              disabled={detail.status === 'running' || deleting}
              title={detail.status === 'running' ? '处理中的任务不能删除' : '删除这个任务'}
              onClick={() => void deleteTasks([detail.id])}
            >
              <Trash2 size={16} /> 删除任务
            </button>
            <button
              className="button button--accent"
              disabled={detail.completed === 0}
              onClick={() => onExport(detail.id)}
            >
              <Download size={16} /> 另存成功结果
              {detail.completed > 0 && <small>{detail.completed}</small>}
            </button>
            <div className={`status-stamp status-stamp--${detail.status}`}>
              <span>{statusText[detail.status]}</span>
              <strong>{progress}%</strong>
            </div>
          </div>
        </header>

        <div className="detail-meta">
          <span>模型 <strong>{detail.modelName}</strong></span>
          <span>共 {detail.total} 张</span>
          <span>完成 {detail.completed}</span>
          {detail.failed > 0 && <span className="danger">失败 {detail.failed}</span>}
          <span>{formatDate(detail.createdAt)}</span>
          {detail.failed > 0 && (
            <button onClick={() => onRetry(detail.id)}>
              <RefreshCw size={14} /> 重试失败项
            </button>
          )}
        </div>

        <div className="detail-layout">
          <aside className="result-rail">
            <div className="result-rail__heading">
              <span>处理明细</span>
              <small>{detail.items?.length ?? 0}</small>
            </div>
            <div className="result-list">
              {detail.items?.map((item, index) => (
                <button
                  key={item.id}
                  className={selectedItemId === item.id ? 'is-active' : ''}
                  onClick={() => setSelectedItemId(item.id)}
                >
                  <img
                    src={window.pixelbatch.images.assetUrl(item.outputPath ?? item.inputPath)}
                    alt={`任务图片 ${index + 1}`}
                  />
                  <span>
                    <strong>图片 {String(index + 1).padStart(2, '0')}</strong>
                    <small className={`item-status item-status--${item.status}`}>
                      {itemStatus(item.status)}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <section className="result-stage">
            {selectedItem ? (
              <>
                {selectedItem.status === 'completed' && selectedItem.outputPath ? (
                  <CompareView
                    before={window.pixelbatch.images.assetUrl(selectedItem.inputPath)}
                    after={window.pixelbatch.images.assetUrl(selectedItem.outputPath)}
                    alt="商品图片"
                  />
                ) : (
                  <div className={`result-placeholder result-placeholder--${selectedItem.status}`}>
                    {selectedItem.status === 'running' || selectedItem.status === 'queued' ? (
                      <LoaderCircle className="spin" size={34} />
                    ) : (
                      <AlertTriangle size={34} />
                    )}
                    <h3>{itemStatus(selectedItem.status)}</h3>
                    <p>{selectedItem.error ?? '任务队列会自动继续处理此图片。'}</p>
                  </div>
                )}
                <div className="result-actions">
                  <div>
                    <strong>{selectedItem.inputPath.split(/[\\/]/).pop()}</strong>
                    <small>拖动分割线查看前后差异</small>
                  </div>
                  {selectedItem.outputPath && (
                    <>
                      <button
                        className="button button--ghost"
                        onClick={() => setViewerItem(selectedItem)}
                      >
                        <Maximize2 size={15} /> 查看大图
                      </button>
                      <button
                        className="button button--ghost"
                        onClick={() => window.pixelbatch.system.revealFile(selectedItem.outputPath!)}
                      >
                        <FolderSearch size={15} /> 定位文件
                      </button>
                      <button
                        className="button button--ink"
                        onClick={() => onSavePrompt(detail, selectedItem)}
                      >
                        <Save size={15} /> 存入提示词库
                      </button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="result-placeholder">
                <Images size={34} />
                <h3>选择一张图片查看</h3>
              </div>
            )}
          </section>
        </div>
        {viewerItem?.outputPath && (
          <ImageViewer
            src={window.pixelbatch.images.assetUrl(viewerItem.outputPath)}
            fileName={viewerItem.outputPath.split(/[\\/]/).pop() ?? '处理结果'}
            onClose={() => setViewerItem(null)}
            onReveal={() => window.pixelbatch.system.revealFile(viewerItem.outputPath!)}
          />
        )}
      </div>
    )
  }

  return (
    <div className="page tasks-page">
      <header className="page-heading">
        <div className="page-heading__copy">
          <div className="eyebrow">QUEUE / 任务队列</div>
          <p>处理中任务会自动刷新。不需要的批次可以勾选后删除，处理中的任务会保留。</p>
        </div>
        <div className="tasks-toolbar">
          <button
            className="button button--danger"
            disabled={selectedIds.length === 0 || deleting}
            onClick={() => void deleteTasks(selectedIds)}
          >
            <Trash2 size={15} /> 删除所选
            {selectedIds.length > 0 && <small>{selectedIds.length}</small>}
          </button>
          <span className="page-heading__meta">{tasks.length} 批任务</span>
        </div>
      </header>

      {tasks.length === 0 ? (
        <div className="empty-state">
          <Archive size={38} strokeWidth={1.4} />
          <h2>任务队列还是空的</h2>
          <p>从“批量创作”导入商品图并创建第一个 AI 修图任务。</p>
        </div>
      ) : (
        <div className="task-table">
          <div className="task-table__head">
            <label className="task-check">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelected}
                aria-label="选择全部任务"
                onChange={() =>
                  setSelectedIds(allSelected ? [] : tasks.map((task) => task.id))
                }
              />
            </label>
            <span>任务</span>
            <span>模型</span>
            <span>进度</span>
            <span>状态</span>
            <span>创建时间</span>
            <span />
          </div>
          {tasks.map((task) => {
            const progress = task.total ? Math.round((task.completed / task.total) * 100) : 0
            const checked = selectedIds.includes(task.id)
            return (
              <div
                className={checked ? 'task-row is-selected' : 'task-row'}
                key={task.id}
                onClick={() => setSelectedId(task.id)}
              >
                <label className="task-check" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={checked}
                    aria-label={`选择任务 ${task.name}`}
                    onChange={() => toggleTask(task.id)}
                  />
                </label>
                <button type="button" className="task-open" onClick={() => setSelectedId(task.id)}>
                  <span className="task-name">
                    <span className="task-thumb">
                      {task.status === 'running' ? (
                        <LoaderCircle className="spin" size={20} />
                      ) : (
                        <Sparkles size={20} />
                      )}
                    </span>
                    <span>
                      <strong>{task.name}</strong>
                      <small>{task.prompt}</small>
                    </span>
                  </span>
                  <span>{task.modelName}</span>
                  <span className="progress-cell">
                    <span>
                      <i style={{ width: `${progress}%` }} />
                    </span>
                    <small>
                      {task.completed}/{task.total}
                    </small>
                  </span>
                  <span>
                    <span className={`status-pill status-pill--${task.status}`}>
                      {statusIcon(task.status)}
                      {statusText[task.status]}
                    </span>
                  </span>
                  <span>{formatDate(task.createdAt)}</span>
                </button>
                <div className="task-actions" onClick={(event) => event.stopPropagation()}>
                  {(task.status === 'queued' || task.status === 'running') && (
                    <button
                      type="button"
                      className="task-delete"
                      aria-label={`取消任务 ${task.name}`}
                      title="取消还没开始的图片"
                      disabled={cancelling}
                      onClick={() => void cancelTask(task.id)}
                    >
                      <CircleStop size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="task-delete"
                    aria-label={`删除任务 ${task.name}`}
                    title={task.status === 'running' ? '处理中的任务不能删除' : '删除任务'}
                    disabled={task.status === 'running' || deleting}
                    onClick={() => void deleteTasks([task.id])}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

function itemStatus(status: TaskItem['status']) {
  return { queued: '等待中', running: '处理中', completed: '已完成', failed: '失败' }[status]
}

function statusIcon(status: ImageTask['status']) {
  if (status === 'completed') return <CheckCircle2 size={13} />
  if (status === 'failed' || status === 'partial') return <AlertTriangle size={13} />
  if (status === 'running') return <LoaderCircle className="spin" size={13} />
  return <Clock3 size={13} />
}
