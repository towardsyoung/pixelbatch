import { ArrowUpRight, BookOpen, ImagePlus, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { CreatePromptInput, PromptPreset } from '../../../shared/types'
import { Modal } from '../components/Modal'

interface PromptLibraryProps {
  prompts: PromptPreset[]
  onUse: (prompt: PromptPreset) => void
  onCreate: (input: CreatePromptInput) => Promise<void>
  onRemove: (id: string) => Promise<void>
}

export function PromptLibrary({ prompts, onUse, onCreate, onRemove }: PromptLibraryProps) {
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [cover, setCover] = useState<string | null>(null)

  async function chooseCover() {
    setCover(await window.pixelbatch.images.pickCover())
  }

  async function create() {
    if (!title.trim() || !prompt.trim()) return
    await onCreate({ title, prompt, coverPath: cover, source: 'manual' })
    setTitle('')
    setPrompt('')
    setCover(null)
    setShowCreate(false)
  }

  return (
    <div className="page prompt-page">
      <header className="page-heading">
        <div className="page-heading__copy">
          <div className="eyebrow">RECIPES / 提示词库</div>
          <p>保存稳定的提示词与效果样片，让下一批商品从成熟配方开始。</p>
        </div>
        <button className="button button--accent" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> 新建提示词
        </button>
      </header>

      <div className="prompt-intro">
        <BookOpen size={24} />
        <p>
          把稳定的修图要求连同效果样片保存下来。下一批同类商品，不必从空白提示词开始。
        </p>
        <span>{prompts.length} 条配方</span>
      </div>

      {prompts.length === 0 ? (
        <div className="empty-state">
          <Sparkles size={38} strokeWidth={1.4} />
          <h2>还没有保存的修图配方</h2>
          <p>可手动新建，也可以在任务结果页把提示词和前后对比一起保存。</p>
          <button className="button button--ink" onClick={() => setShowCreate(true)}>
            <Plus size={15} /> 新建第一条
          </button>
        </div>
      ) : (
        <div className="prompt-grid">
          {prompts.map((item, index) => (
            <article className="prompt-card" key={item.id}>
              <div className="prompt-card__visual">
                {item.beforePath && item.afterPath ? (
                  <div className="prompt-card__pair">
                    <img src={window.pixelbatch.images.assetUrl(item.beforePath)} alt="处理前" />
                    <img src={window.pixelbatch.images.assetUrl(item.afterPath)} alt="处理后" />
                  </div>
                ) : item.coverPath ? (
                  <img src={window.pixelbatch.images.assetUrl(item.coverPath)} alt={item.title} />
                ) : (
                  <div className="prompt-card__fallback">
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <Sparkles size={34} />
                  </div>
                )}
                <span className="source-chip">{item.source === 'task' ? '来自任务' : '手动创建'}</span>
              </div>
              <div className="prompt-card__body">
                <div>
                  <h3>{item.title}</h3>
                  <button
                    className="icon-button icon-button--danger"
                    aria-label="删除提示词"
                    onClick={() => onRemove(item.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <p>{item.prompt}</p>
                <button className="use-prompt" onClick={() => onUse(item)}>
                  套用到新任务 <ArrowUpRight size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal title="新建提示词配方" eyebrow="NEW RECIPE" onClose={() => setShowCreate(false)}>
          <div className="form-stack">
            <label>
              配方名称
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：白底小家电质感精修"
              />
            </label>
            <label>
              完整提示词
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="描述要保留什么、修改什么，以及理想的材质、光线和构图……"
                rows={7}
              />
            </label>
            <button className="cover-picker" onClick={chooseCover}>
              {cover ? (
                <img src={window.pixelbatch.images.assetUrl(cover)} alt="封面预览" />
              ) : (
                <ImagePlus size={24} />
              )}
              <span>
                <strong>{cover ? '已选择封面图' : '选择封面图（可选）'}</strong>
                <small>用于在提示词库中快速辨认效果</small>
              </span>
            </button>
            <div className="modal-actions">
              <button className="button button--ghost" onClick={() => setShowCreate(false)}>
                取消
              </button>
              <button
                className="button button--accent"
                onClick={create}
                disabled={!title.trim() || !prompt.trim()}
              >
                保存配方
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
