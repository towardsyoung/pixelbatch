import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { ModelConfig } from '../shared/types'

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

function providerError(status: number, body: string): Error {
  let message = body
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }
    message = parsed.error?.message ?? parsed.message ?? body
  } catch {
    // Keep the service's plain-text response.
  }
  return new Error(`图片服务请求失败 (${status})：${message.slice(0, 500)}`)
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
