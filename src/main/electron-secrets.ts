import { safeStorage } from 'electron'
import type { SecretStore } from './secret-store'

export function createElectronSecretStore(): SecretStore {
  return {
    protect(value: string): string {
      if (!value) return ''
      if (safeStorage.isEncryptionAvailable()) {
        return `safe:${safeStorage.encryptString(value).toString('base64')}`
      }
      return `local:${Buffer.from(value).toString('base64')}`
    },
    unprotect(value: string): string {
      if (!value) return ''
      const separator = value.indexOf(':')
      if (separator === -1) return value
      const kind = value.slice(0, separator)
      const encoded = value.slice(separator + 1)
      if (kind === 'safe') return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
      if (kind === 'local') return Buffer.from(encoded, 'base64').toString()
      return value
    }
  }
}
