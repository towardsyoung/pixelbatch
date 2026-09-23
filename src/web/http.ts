import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload)
  })
  response.end(payload)
}

export async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 1_000_000) throw new HttpError(413, '请求过大。')
    chunks.push(buffer)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, '请求不是有效的 JSON。')
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, '请求格式不正确。')
  }
  return value as Record<string, unknown>
}

export async function readForm(request: IncomingMessage): Promise<FormData> {
  const declared = Number(request.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > 400 * 1024 * 1024) {
    throw new HttpError(413, '上传内容过大。')
  }
  const headers = new Headers()
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers.set(key, value)
    else if (Array.isArray(value)) headers.set(key, value.join(', '))
  }
  const init = {
    method: 'POST',
    headers,
    body: Readable.toWeb(request) as ReadableStream,
    duplex: 'half'
  } as RequestInit
  return new Request('http://127.0.0.1/upload', init).formData()
}
