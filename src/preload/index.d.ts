import type { AppApi } from '../shared/types'

declare global {
  interface Window {
    pixelbatch: AppApi
  }
}

export {}
