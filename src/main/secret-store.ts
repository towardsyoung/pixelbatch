export interface SecretStore {
  protect(value: string): string
  unprotect(value: string): string
}

export function createLocalSecretStore(): SecretStore {
  return {
    protect(value: string): string {
      if (!value) return ''
      return `local:${Buffer.from(value).toString('base64')}`
    },
    unprotect(value: string): string {
      if (!value) return ''
      const separator = value.indexOf(':')
      if (separator === -1) return value
      const kind = value.slice(0, separator)
      const encoded = value.slice(separator + 1)
      if (kind === 'local') return Buffer.from(encoded, 'base64').toString()
      if (kind === 'safe') {
        throw new Error('这个 API Key 由桌面版系统密钥保护，Web 版无法读取。请在 Web 版重新保存。')
      }
      return value
    }
  }
}
