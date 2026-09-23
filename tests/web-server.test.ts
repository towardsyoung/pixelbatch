import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../src/main/database'
import { createLocalSecretStore } from '../src/main/secret-store'
import { createWebApp, type WebApp } from '../src/web/server'
import type { ModelConfig } from '../src/shared/types'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

describe('local secret store', () => {
  it('round-trips an API key without Electron safeStorage', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'pixelbatch-secret-'))
    const database = new AppDatabase(join(dataDir, 'pixelbatch.sqlite'), createLocalSecretStore())
    try {
      const saved = database.saveModel({
        name: '测试模型',
        provider: 'openai',
        baseUrl: 'https://example.test/v1',
        apiKey: 'sk-test',
        model: 'gpt-image-2',
        enabled: true,
        isDefault: false
      })
      expect(database.getModel(saved.id)?.apiKey).toBe('sk-test')
      expect(database.listModels().find((model) => model.id === saved.id)?.apiKey).toBe('')
    } finally {
      database.close()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})

describe('web server', () => {
  let base = ''
  let dataDir = ''
  let app: WebApp | undefined
  let revealed: string[] = []
  let closeServer: (() => Promise<void>) | undefined

  afterEach(async () => {
    app?.close()
    if (closeServer) await closeServer()
    if (dataDir) rmSync(dataDir, { recursive: true, force: true })
    app = undefined
    closeServer = undefined
    dataDir = ''
  })

  async function start(): Promise<void> {
    revealed = []
    dataDir = mkdtempSync(join(tmpdir(), 'pixelbatch-web-'))
    app = createWebApp({
      dataDir,
      revealFile: (filePath) => revealed.push(filePath)
    })
    const server = createServer((request, response) => {
      void app?.handle(request, response)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('测试服务没有端口')
    base = `http://127.0.0.1:${address.port}`
    closeServer = () => new Promise((resolve) => server.close(() => resolve()))
  }

  it('serves seeded models, uploads an image, and hides API keys', async () => {
    await start()
    const models = await readJson<ModelConfig[]>(await fetch(`${base}/api/models`))
    expect(models.map((model) => model.name)).toEqual([
      'OpenAI · GPT Image 2',
      'Google · Nano Banana 2'
    ])

    const body = new FormData()
    body.append('files', new File([PNG], '商品主图.png', { type: 'image/png' }))
    body.append('files', new File(['hello'], 'notes.txt', { type: 'text/plain' }))
    const uploaded = await readJson<{ paths: string[] }>(
      await fetch(`${base}/api/images/upload`, { method: 'POST', body })
    )
    expect(uploaded.paths).toHaveLength(1)
    expect(uploaded.paths[0]).toContain('商品主图.png')

    const asset = await fetch(`${base}/api/assets?path=${encodeURIComponent(uploaded.paths[0] ?? '')}`)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await asset.arrayBuffer())).toEqual(PNG)

    const saved = await readJson<ModelConfig>(
      await fetch(`${base}/api/models`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: '自建模型',
          provider: 'openai',
          baseUrl: 'https://example.test/v1',
          apiKey: 'sk-live',
          model: 'gpt-image-2',
          enabled: true,
          isDefault: false
        })
      })
    )
    expect(saved.apiKey).toBe('')
    expect(saved.apiKeyConfigured).toBe(true)

    const prompt = await readJson<{ id: string; title: string }>(
      await fetch(`${base}/api/prompts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: '棚拍',
          prompt: '校正白平衡',
          coverPath: uploaded.paths[0],
          source: 'manual'
        })
      })
    )
    expect(prompt.title).toBe('棚拍')
    const removed = await fetch(`${base}/api/prompts/${prompt.id}`, { method: 'DELETE' })
    expect(removed.status).toBe(200)
  })

  it('rejects images outside the workspace and can reveal an uploaded file', async () => {
    await start()
    const outside = join(tmpdir(), `pixelbatch-outside-${Date.now()}.png`)
    writeFileSync(outside, PNG)
    try {
      const blocked = await fetch(`${base}/api/assets?path=${encodeURIComponent(outside)}`)
      expect(blocked.status).toBe(403)

      const missing = await fetch(`${base}/api/tasks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          imagePaths: [outside],
          prompt: '提亮',
          modelConfigId: 'missing',
          operation: 'ai-retouch'
        })
      })
      expect(missing.status).toBe(403)

      const uploaded = await readJson<{ paths: string[] }>(
        await fetch(`${base}/api/images/upload`, {
          method: 'POST',
          body: fileForm('inside.png')
        })
      )
      const reveal = await fetch(`${base}/api/system/reveal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: uploaded.paths[0] })
      })
      expect(reveal.status).toBe(200)
      expect(revealed.map((filePath) => realpathSync(filePath))).toEqual([
        realpathSync(uploaded.paths[0] ?? '')
      ])

      const refused = await fetch(`${base}/api/system/reveal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: outside })
      })
      expect(refused.status).toBe(403)
      expect(revealed).toHaveLength(1)
    } finally {
      rmSync(outside, { force: true })
    }
  })

  it('queues a task and records the missing API key failure', async () => {
    await start()
    const models = await readJson<ModelConfig[]>(await fetch(`${base}/api/models`))
    const uploaded = await readJson<{ paths: string[] }>(
      await fetch(`${base}/api/images/upload`, {
        method: 'POST',
        body: fileForm('queue.png')
      })
    )
    const created = await readJson<{ id: string }>(
      await fetch(`${base}/api/tasks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          imagePaths: uploaded.paths,
          prompt: '保持主体，校正白平衡',
          modelConfigId: models[0]?.id,
          operation: 'ai-retouch'
        })
      })
    )

    let error = ''
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const task = await readJson<{ status: string; items?: Array<{ error: string | null }> }>(
        await fetch(`${base}/api/tasks/${created.id}`)
      )
      if (task.status === 'failed') {
        error = task.items?.[0]?.error ?? ''
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
    expect(error).toContain('API Key')

    const removed = await readJson<{ deletedIds: string[] }>(
      await fetch(`${base}/api/tasks/remove`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [created.id] })
      })
    )
    expect(removed.deletedIds).toEqual([created.id])
    const remaining = await readJson<Array<{ id: string }>>(await fetch(`${base}/api/tasks`))
    expect(remaining.some((task) => task.id === created.id)).toBe(false)
  })
})

function fileForm(name: string): FormData {
  const body = new FormData()
  body.append('files', new File([PNG], name, { type: 'image/png' }))
  return body
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? response.statusText)
  return payload
}
