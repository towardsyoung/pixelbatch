import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { providerError } from './provider-errors'
import type { ModelConfig, ProviderType, TestModelInput, TestModelResult } from '../shared/types'

export interface ImageEditRequest {
  inputPath: string
  prompt: string
}

export interface ImageEditResult {
  data: Buffer
  mimeType: string
}

export interface ImageProvider {
  edit(request: ImageEditRequest): Promise<ImageEditResult>
}

function mimeForPath(path: string): string {
  const extension = extname(path).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  return 'image/png'
}

export function parseOpenAiImageResponse(payload: unknown): ImageEditResult | null {
  const data = (payload as { data?: Array<{ b64_json?: string }> }).data?.[0]?.b64_json
  return data ? { data: Buffer.from(data, 'base64'), mimeType: 'image/png' } : null
}

export function parseGeminiImageResponse(payload: unknown): ImageEditResult | null {
  const candidates = (
    payload as {
      candidates?: Array<{
        content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> }
      }>
    }
  ).candidates
  const part = candidates?.flatMap((candidate) => candidate.content?.parts ?? []).find(
    (item) => item.inlineData?.data
  )
  if (!part?.inlineData?.data) return null
  return {
    data: Buffer.from(part.inlineData.data, 'base64'),
    mimeType: part.inlineData.mimeType ?? 'image/png'
  }
}

class OpenAiImageProvider implements ImageProvider {
  constructor(private readonly config: ModelConfig) {}

  async edit(request: ImageEditRequest): Promise<ImageEditResult> {
    const input = await readFile(request.inputPath)
    const body = new FormData()
    body.append('model', this.config.model)
    body.append('prompt', request.prompt)
    body.append('image', new Blob([input], { type: mimeForPath(request.inputPath) }), 'input.png')
    body.append('size', 'auto')
    body.append('quality', 'auto')

    const response = await fetch(`${this.config.baseUrl.replace(/\/+$/, '')}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
      body,
      signal: AbortSignal.timeout(180_000)
    })
    const text = await response.text()
    if (!response.ok) throw providerError(response.status, text)
    const payload = JSON.parse(text) as {
      data?: Array<{ b64_json?: string; url?: string }>
    }
    const parsed = parseOpenAiImageResponse(payload)
    if (parsed) return parsed

    const url = payload.data?.[0]?.url
    if (url) {
      const imageResponse = await fetch(url, { signal: AbortSignal.timeout(60_000) })
      if (!imageResponse.ok) throw new Error('模型返回了图片地址，但下载失败。')
      return {
        data: Buffer.from(await imageResponse.arrayBuffer()),
        mimeType: imageResponse.headers.get('content-type') ?? 'image/png'
      }
    }
    throw new Error('模型响应中没有可用图片。')
  }
}

class GeminiImageProvider implements ImageProvider {
  constructor(private readonly config: ModelConfig) {}

  async edit(request: ImageEditRequest): Promise<ImageEditResult> {
    const input = await readFile(request.inputPath)
    const baseUrl = this.config.baseUrl.replace(/\/+$/, '')
    const url = `${baseUrl}/models/${encodeURIComponent(this.config.model)}:generateContent?key=${encodeURIComponent(this.config.apiKey)}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: request.prompt },
              {
                inlineData: {
                  mimeType: mimeForPath(request.inputPath),
                  data: input.toString('base64')
                }
              }
            ]
          }
        ],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE']
        }
      }),
      signal: AbortSignal.timeout(180_000)
    })
    const text = await response.text()
    if (!response.ok) throw providerError(response.status, text)
    const result = parseGeminiImageResponse(JSON.parse(text))
    if (!result) throw new Error('模型响应中没有可用图片。')
    return result
  }
}

export function createProvider(config: ModelConfig): ImageProvider {
  if (!config.apiKey) throw new Error(`模型“${config.name}”尚未配置 API Key。`)
  if (config.provider === 'openai') return new OpenAiImageProvider(config)
  if (config.provider === 'gemini') return new GeminiImageProvider(config)
  throw new Error(`不支持的模型提供方：${config.provider satisfies never}`)
}

export async function testModelConnection(
  config: Pick<ModelConfig, 'name' | 'provider' | 'baseUrl' | 'apiKey' | 'model'>
): Promise<string> {
  if (!config.apiKey.trim()) throw new Error(`模型“${config.name}”尚未配置 API Key。`)
  if (!config.baseUrl.trim() || !config.model.trim()) throw new Error('请填写服务地址和模型名称。')
  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  if (config.provider === 'gemini') return testGeminiConnection(baseUrl, config.model, config.apiKey)
  return testOpenAiConnection(baseUrl, config.model, config.apiKey)
}

export async function testModelConfiguration(
  input: TestModelInput,
  loadExisting: (id: string) => ModelConfig | null
): Promise<TestModelResult> {
  const provider: ProviderType = input.provider === 'gemini' ? 'gemini' : 'openai'
  const existing = input.id ? loadExisting(input.id) : null
  const apiKey = input.apiKey?.trim() || existing?.apiKey || ''
  const message = await testModelConnection({
    name: input.name?.trim() || existing?.name || '模型',
    provider,
    baseUrl: input.baseUrl,
    apiKey,
    model: input.model
  })
  return { message }
}

async function testOpenAiConnection(baseUrl: string, model: string, apiKey: string): Promise<string> {
  const headers = { Authorization: `Bearer ${apiKey}` }
  const modelResponse = await requestModelEndpoint(
    `${baseUrl}/models/${encodeURIComponent(model)}`,
    { headers }
  )
  if (modelResponse.ok) return '连接成功，密钥和地址可用。'
  if (modelResponse.status !== 404) {
    throw providerError(modelResponse.status, modelResponse.body)
  }
  const listResponse = await requestModelEndpoint(`${baseUrl}/models`, { headers })
  if (listResponse.ok) {
    throw new Error(`密钥可用，但服务没有找到模型“${model}”。`)
  }
  throw providerError(listResponse.status, listResponse.body)
}

async function testGeminiConnection(baseUrl: string, model: string, apiKey: string): Promise<string> {
  const url = `${baseUrl}/models/${encodeURIComponent(model)}?key=${encodeURIComponent(apiKey)}`
  const response = await requestModelEndpoint(url, { headers: { 'x-goog-api-key': apiKey } })
  if (response.ok) return '连接成功，密钥和地址可用。'
  if (response.status === 404) throw new Error(`服务没有找到模型“${model}”。`)
  throw providerError(response.status, response.body)
}

async function requestModelEndpoint(
  url: string,
  init: { headers: Record<string, string> }
): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const response = await fetch(url, { headers: init.headers, signal: AbortSignal.timeout(20_000) })
    return { ok: response.ok, status: response.status, body: await response.text() }
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error('连接超时，请检查服务地址或网络。')
    }
    throw new Error('无法连接到模型服务，请检查服务地址或网络。')
  }
}
