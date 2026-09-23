export type ProviderFailureKind = 'auth' | 'quota' | 'retryable' | 'fatal'

export const MAX_ITEM_ATTEMPTS = 3
export const RETRY_DELAYS_MS = [1000, 2000]

export class ProviderRequestError extends Error {
  readonly kind: ProviderFailureKind

  constructor(message: string, kind: ProviderFailureKind) {
    super(message)
    this.name = 'ProviderRequestError'
    this.kind = kind
  }
}

export function classifyHttpFailure(status: number, body: string): ProviderFailureKind {
  const text = body.toLowerCase()
  if (
    status === 401 ||
    status === 403 ||
    text.includes('invalid api key') ||
    text.includes('incorrect api key')
  ) {
    return 'auth'
  }
  if (
    status === 402 ||
    text.includes('insufficient_quota') ||
    text.includes('exceeded your current quota') ||
    text.includes('billing') ||
    text.includes('credit balance') ||
    text.includes('余额不足') ||
    text.includes('额度不足')
  ) {
    return 'quota'
  }
  if (status === 408 || status === 429 || status >= 500) return 'retryable'
  return 'fatal'
}

export function providerError(status: number, body: string): ProviderRequestError {
  let message = body
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }
    message = parsed.error?.message ?? parsed.message ?? body
  } catch {
    // Keep the service's plain-text response.
  }
  return new ProviderRequestError(
    `图片服务请求失败 (${status})：${message.slice(0, 500)}`,
    classifyHttpFailure(status, body)
  )
}

export function isRetryableFailure(error: unknown): boolean {
  if (error instanceof ProviderRequestError) return error.kind === 'retryable'
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return true
  return error instanceof TypeError
}

export function isBatchStoppingFailure(error: unknown): boolean {
  return error instanceof ProviderRequestError && (error.kind === 'auth' || error.kind === 'quota')
}

export function decideFailure(error: unknown, attempt: number): 'retry' | 'stop-batch' | 'fail-item' {
  if (isBatchStoppingFailure(error)) return 'stop-batch'
  if (isRetryableFailure(error) && attempt < MAX_ITEM_ATTEMPTS) return 'retry'
  return 'fail-item'
}
