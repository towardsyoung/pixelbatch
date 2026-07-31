import {
  ArrowRight,
  Check,
  Files,
  FolderOpen,
  ImagePlus,
  Library,
  Sparkles,
  Trash2,
  WandSparkles
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ModelConfig, PromptPreset } from '../../../shared/types'

interface WorkspaceProps {
  models: ModelConfig[]
  prompts: PromptPreset[]
  defaultPrompt: string
  onCreateTask: (input: {
    name?: string
    imagePaths: string[]
    prompt: string
    modelConfigId: string
  }) => Promise<void>
  onOpenPrompts: () => void
}

export function Workspace({
  models,
  prompts,
  defaultPrompt,
  onCreateTask,
  onOpenPrompts
}: WorkspaceProps) {
  const [images, setImages] = useState<string[]>([])
  const [batchName, setBatchName] = useState('')
  const [batchNameEdited, setBatchNameEdited] = useState(false)
  const [prompt, setPrompt] = useState(defaultPrompt)
  const [modelId, setModelId] = useState(
    () => models.find((model) => model.isDefault)?.id ?? models[0]?.id ?? ''
  )
  const [submitting, setSubmitting] = useState(false)

  const activeModels = useMemo(() => models.filter((model) => model.enabled), [models])
  const recentPrompts = prompts.slice(0, 3)

  async function addFiles() {
    const selected = await window.pixelbatch.images.pickFiles()
    setImages((current) => [...new Set([...current, ...selected])])
  }

  async function addFolder() {
    const selected = await window.pixelbatch.images.pickFolder()
    if (!selected) return
    setImages((current) => [...new Set([...current, ...selected.imagePaths])])
    if (!batchNameEdited || !batchName.trim()) setBatchName(selected.name)
  }

  async function submit() {
    if (!images.length || !prompt.trim() || !modelId) return
    setSubmitting(true)
    try {
      await onCreateTask({
        name: batchName.trim() || undefined,
        imagePaths: images,
        prompt: prompt.trim(),
        modelConfigId: modelId
      })
      setImages([])
      setBatchName('')
      setBatchNameEdited(false)
      setPrompt('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page workspace-page">
      <header className="page-heading">
        <div className="page-heading__copy">
          <div className="eyebrow">CREATE / 批量创作</div>
          <p>导入商品图，写下统一要求，选择模型。剩下的交给本机任务队列。</p>
        </div>
        <span className="page-heading__meta">AI RETOUCH · BATCH READY</span>
      </header>

      <div className="workspace-grid">
        <section className="panel import-panel">
          <div className="panel-heading">
            <div>
              <span className="step-index">STEP 01</span>
              <h2>导入商品图</h2>
            </div>
            {images.length > 0 && <span className="count-chip">{images.length} 张</span>}
          </div>

          {images.length === 0 ? (
            <div className="dropzone">
              <div className="dropzone__glyph">
                <ImagePlus size={30} strokeWidth={1.6} />
              </div>
              <h3>从一张开始，也可以整批导入</h3>
              <p>支持 PNG、JPG、JPEG、WEBP；文件夹只读取当前层级。</p>
              <div className="dropzone__actions">
                <button className="button button--ink" onClick={addFiles}>
                  <Files size={16} /> 选择多张图片
                </button>
                <button className="button button--ghost" onClick={addFolder}>
                  <FolderOpen size={16} /> 选择文件夹
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="image-strip">
                {images.slice(0, 8).map((path, index) => (
                  <div className="image-tile" key={path}>
                    <img src={window.pixelbatch.images.assetUrl(path)} alt={`待处理图片 ${index + 1}`} />
                    <button
                      aria-label="移除图片"
                      onClick={() => setImages((current) => current.filter((item) => item !== path))}
                    >
                      <Trash2 size={13} />
                    </button>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                  </div>
                ))}
                {images.length > 8 && <div className="image-overflow">+{images.length - 8}</div>}
              </div>
              <div className="inline-actions">
                <button className="text-button" onClick={addFiles}>
                  <ImagePlus size={15} /> 继续添加
                </button>
                <button
                  className="text-button muted"
                  onClick={() => {
                    setImages([])
                    if (!batchNameEdited) setBatchName('')
                  }}
                >
                  清空全部
                </button>
              </div>
            </>
          )}
        </section>

        <section className="panel recipe-panel">
          <div className="panel-heading">
            <div>
              <span className="step-index">STEP 02</span>
              <h2>定义修图配方</h2>
            </div>
            <WandSparkles size={22} />
          </div>

          <label className="field-label" htmlFor="batch-name">
            批次名称
            <span className="field-hint">便于在任务队列中查找，可随时修改</span>
          </label>
          <div className="batch-name-editor">
            <input
              id="batch-name"
              value={batchName}
              onChange={(event) => {
                setBatchName(event.target.value)
                setBatchNameEdited(true)
              }}
              placeholder={
                images.length
                  ? `${images[0]?.split(/[\\/]/).pop() ?? '新任务'}${images.length > 1 ? ` 等 ${images.length} 张` : ''}`
                  : '例如：7 月夏季新品主图'
              }
              maxLength={120}
            />
            <span>{batchName.length || '自动'} / 120</span>
          </div>

          <label className="field-label" htmlFor="prompt">
            修图要求
            <button className="field-action" onClick={onOpenPrompts}>
              <Library size={14} /> 从提示词库选择
            </button>
          </label>
          <div className="prompt-editor">
            <textarea
              id="prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="例如：保持商品主体、包装文字和品牌标识完全不变。清理表面灰尘与细小划痕，校正白平衡，增强材质细节，呈现自然棚拍质感……"
              maxLength={4000}
            />
            <span>{prompt.length} / 4000</span>
          </div>

          {recentPrompts.length > 0 && !prompt && (
            <div className="quick-prompts">
              <span>最近使用</span>
              {recentPrompts.map((preset) => (
                <button key={preset.id} onClick={() => setPrompt(preset.prompt)}>
                  <Sparkles size={13} /> {preset.title}
                </button>
              ))}
            </div>
          )}

          <label className="field-label" htmlFor="model">
            处理模型
          </label>
          <div className="model-picker">
            {activeModels.map((model) => (
              <button
                key={model.id}
                className={modelId === model.id ? 'is-active' : ''}
                onClick={() => setModelId(model.id)}
              >
                <span className={`provider-dot provider-dot--${model.provider}`} />
                <span>
                  <strong>{model.name}</strong>
                  <small>{model.model}</small>
                </span>
                {modelId === model.id && <Check size={16} />}
              </button>
            ))}
          </div>

          <div className="submit-row">
            <div className="submit-summary">
              <span>{images.length || '—'} 张图片</span>
              <i />
              <span>AI 修图</span>
            </div>
            <button
              className="button button--accent button--large"
              disabled={!images.length || !prompt.trim() || !modelId || submitting}
              onClick={submit}
            >
              {submitting ? '正在创建…' : '创建处理任务'}
              <ArrowRight size={18} />
            </button>
          </div>
        </section>
      </div>

      <footer className="workflow-note">
        <span>当前版本</span>
        <strong>AI 修图</strong>
        <i />
        <span>下一阶段</span>
        <em>智能抠图</em>
        <em>批量换背景</em>
      </footer>
    </div>
  )
}
