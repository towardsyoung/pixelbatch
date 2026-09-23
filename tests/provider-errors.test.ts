import { afterEach, describe, expect, it, vi } from 'vitest'
import { classifyHttpFailure, decideFailure, ProviderRequestError } from '../src/main/provider-errors'
import { testModelConnection } from '../src/main/providers'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('provider failures', () => {
  it('stops the batch on auth and quota errors', () => {
    expect(classifyHttpFailure(401, '{"error":{"message":"bad key"}}')).toBe('auth')
    expect(classifyHttpFailure(402, 'insufficient_quota')).toBe('quota')
    expect(decideFailure(new ProviderRequestError('nope', 'auth'), 1)).toBe('stop-batch')
    expect(decideFailure(new ProviderRequestError('nope', 'quota'), 2)).toBe('stop-batch')
  })

  it('retries timeouts and server errors twice', () => {
    const timeout = new Error('timed out')
    timeout.name = 'TimeoutError'
    expect(decideFailure(new ProviderRequestError('503', 'retryable'), 1)).toBe('retry')
    expect(decideFailure(new ProviderRequestError('503', 'retryable'), 2)).toBe('retry')
    expect(decideFailure(timeout, 3)).toBe('fail-item')
    expect(decideFailure(new Error('bad image'), 1)).toBe('fail-item')
  })
})

describe('model connection test', () => {
  const model = {
    name: '测试',
    provider: 'openai' as const,
    baseUrl: 'https://example.test/v1',
    apiKey: 'sk-secret',
    model: 'gpt-image-2'
  }

  it('accepts a reachable OpenAI model endpoint', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(String(url))
      return new Response('{}', { status: 200 })
    })
    await expect(testModelConnection(model)).resolves.toContain('连接成功')
    expect(calls[0]).toBe('https://example.test/v1/models/gpt-image-2')
  })

  it('reports a missing model without treating the key as invalid', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const listing = String(url).endsWith('/models')
      return new Response(listing ? '[]' : 'missing', { status: listing ? 200 : 404 })
    })
    await expect(testModelConnection(model)).rejects.toThrow('没有找到模型')
  })

  it('hides the Gemini key when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('connect ECONNREFUSED sk-secret'))))
    await expect(
      testModelConnection({ ...model, provider: 'gemini', apiKey: 'sk-secret' })
    ).rejects.toThrow('无法连接到模型服务')
  })
})
