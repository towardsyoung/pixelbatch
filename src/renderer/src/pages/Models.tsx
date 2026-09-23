import { Check, KeyRound, PlugZap, Plus, Server, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { ModelConfig, ProviderType, SaveModelInput, TestModelInput } from '../../../shared/types'
import { Modal } from '../components/Modal'

interface ModelsProps {
  models: ModelConfig[]
  onSave: (input: SaveModelInput) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onTest: (input: TestModelInput) => Promise<void>
}

const emptyModel: SaveModelInput = {
  name: '',
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: '',
  enabled: true,
  isDefault: false
}

export function Models({ models, onSave, onRemove, onTest }: ModelsProps) {
  const [editing, setEditing] = useState<SaveModelInput | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)

  function edit(model: ModelConfig) {
    setEditing({
      id: model.id,
      name: model.name,
      provider: model.provider,
      baseUrl: model.baseUrl,
      apiKey: '',
      model: model.model,
      enabled: model.enabled,
      isDefault: model.isDefault
    })
  }

  function changeProvider(provider: ProviderType) {
    if (!editing) return
    setEditing({
      ...editing,
      provider,
      baseUrl:
        provider === 'openai'
          ? 'https://api.openai.com/v1'
          : 'https://generativelanguage.googleapis.com/v1beta',
      model: provider === 'openai' ? 'gpt-image-2' : 'gemini-3.1-flash-image'
    })
  }

  async function save() {
    if (!editing) return
    await onSave(editing)
    setEditing(null)
  }

  async function test(input: TestModelInput, key: string) {
    setTestingId(key)
    try {
      await onTest(input)
    } finally {
      setTestingId(null)
    }
  }

  return (
    <div className="page models-page">
      <header className="page-heading">
        <div className="page-heading__copy">
          <div className="eyebrow">CONNECTIONS / 模型设置</div>
          <p>集中管理服务地址、模型名称和本机密钥，不影响已有任务与配方。</p>
        </div>
        <button className="button button--accent" onClick={() => setEditing({ ...emptyModel })}>
          <Plus size={16} /> 添加模型
        </button>
      </header>

      <div className="security-note">
        <ShieldCheck size={20} />
        <div>
          <strong>密钥仅保存在这台电脑</strong>
          <p>优先使用系统安全存储加密；仅在调用所选模型服务时用于认证。</p>
        </div>
      </div>

      <div className="model-cards">
        {models.map((model) => (
          <article className={`model-card ${model.enabled ? '' : 'is-disabled'}`} key={model.id}>
            <div className="model-card__top">
              <span className={`model-logo model-logo--${model.provider}`}>
                {model.provider === 'openai' ? 'O' : 'G'}
              </span>
              <div>
                <h2>{model.name}</h2>
                <p>{model.provider === 'openai' ? 'OpenAI 兼容接口' : 'Google Gemini API'}</p>
              </div>
              {model.isDefault && (
                <span className="default-chip">
                  <Check size={12} /> 默认
                </span>
              )}
            </div>
            <dl>
              <div>
                <dt>MODEL</dt>
                <dd>{model.model}</dd>
              </div>
              <div>
                <dt>ENDPOINT</dt>
                <dd>{model.baseUrl}</dd>
              </div>
              <div>
                <dt>KEY</dt>
                <dd className={model.apiKeyConfigured ? 'has-key' : 'no-key'}>
                  <KeyRound size={13} /> {model.apiKeyConfigured ? '已配置' : '未配置'}
                </dd>
              </div>
            </dl>
            <footer>
              <span className={model.enabled ? 'connection-on' : 'connection-off'}>
                <i /> {model.enabled ? '已启用' : '已停用'}
              </span>
              <div>
                {!model.isDefault && (
                  <button
                    className="icon-button icon-button--danger"
                    onClick={() => onRemove(model.id)}
                    aria-label="删除模型"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
                <button
                  className="button button--ghost"
                  disabled={testingId === model.id}
                  onClick={() =>
                    void test(
                      {
                        id: model.id,
                        name: model.name,
                        provider: model.provider,
                        baseUrl: model.baseUrl,
                        model: model.model
                      },
                      model.id
                    )
                  }
                >
                  <PlugZap size={14} /> {testingId === model.id ? '测试中…' : '测试连接'}
                </button>
                <button className="button button--ghost" onClick={() => edit(model)}>
                  编辑配置
                </button>
              </div>
            </footer>
          </article>
        ))}
      </div>

      <section className="adapter-note">
        <Server size={22} />
        <div>
          <h3>可扩展适配器</h3>
          <p>
            任务队列只依赖统一的图片编辑接口。新增模型提供方时，只需实现 edit 方法并注册 provider，
            无需改动任务、提示词库或结果查看模块。
          </p>
        </div>
      </section>

      {editing && (
        <Modal
          title={editing.id ? '编辑模型配置' : '添加模型配置'}
          eyebrow="MODEL ADAPTER"
          onClose={() => setEditing(null)}
        >
          <div className="form-stack">
            <div className="provider-tabs">
              <button
                className={editing.provider === 'openai' ? 'is-active' : ''}
                onClick={() => changeProvider('openai')}
              >
                OpenAI / 兼容
              </button>
              <button
                className={editing.provider === 'gemini' ? 'is-active' : ''}
                onClick={() => changeProvider('gemini')}
              >
                Google Gemini
              </button>
            </div>
            <label>
              显示名称
              <input
                value={editing.name}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                placeholder="团队能看懂的名称"
              />
            </label>
            <label>
              API Base URL
              <input
                value={editing.baseUrl}
                onChange={(event) => setEditing({ ...editing, baseUrl: event.target.value })}
              />
            </label>
            <label>
              模型名称
              <input
                value={editing.model}
                onChange={(event) => setEditing({ ...editing, model: event.target.value })}
              />
            </label>
            <label>
              API Key
              <input
                type="password"
                value={editing.apiKey}
                onChange={(event) => setEditing({ ...editing, apiKey: event.target.value })}
                placeholder={editing.id ? '留空则保持当前密钥' : '输入服务商 API Key'}
              />
            </label>
            <div className="toggle-row">
              <label>
                <input
                  type="checkbox"
                  checked={editing.enabled}
                  onChange={(event) => setEditing({ ...editing, enabled: event.target.checked })}
                />
                <span>启用此模型</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={editing.isDefault}
                  onChange={(event) => setEditing({ ...editing, isDefault: event.target.checked })}
                />
                <span>设为默认模型</span>
              </label>
            </div>
            <div className="modal-actions">
              <button
                className="button button--ghost modal-actions__test"
                disabled={
                  testingId === 'draft' || !editing.baseUrl.trim() || !editing.model.trim()
                }
                onClick={() =>
                  void test(
                    {
                      id: editing.id,
                      name: editing.name,
                      provider: editing.provider,
                      baseUrl: editing.baseUrl,
                      apiKey: editing.apiKey,
                      model: editing.model
                    },
                    'draft'
                  )
                }
              >
                <PlugZap size={14} /> {testingId === 'draft' ? '测试中…' : '测试连接'}
              </button>
              <button className="button button--ghost" onClick={() => setEditing(null)}>
                取消
              </button>
              <button
                className="button button--accent"
                onClick={save}
                disabled={!editing.name.trim() || !editing.baseUrl.trim() || !editing.model.trim()}
              >
                保存配置
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
