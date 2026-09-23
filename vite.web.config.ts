import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve('src/renderer'),
  envDir: resolve('.'),
  appType: 'spa',
  plugins: [
    react(),
    {
      name: 'pixelbatch-web-csp',
      transformIndexHtml(html) {
        return html
          .replace("script-src 'self'", "script-src 'self' 'unsafe-inline' 'unsafe-eval'")
          .replace("img-src 'self' pixelbatch: data:", "img-src 'self' pixelbatch: data: blob:")
      }
    }
  ],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  server: {
    middlewareMode: true,
    fs: {
      allow: [resolve('.')]
    }
  }
})
