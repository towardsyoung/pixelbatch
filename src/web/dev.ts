import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import type { ServerResponse, IncomingMessage } from 'node:http'
import { resolve } from 'node:path'
import { createServer as createViteServer, type ViteDevServer } from 'vite'
import { createWebApp } from './server'

const host = '127.0.0.1'
const port = readPort()
const web = createWebApp({
  dataDir: process.env.PIXELBATCH_DATA_DIR
})

let vite: ViteDevServer | undefined

const httpServer = createServer((request, response) => {
  void serve(request, response)
})

async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const url = new URL(request.url ?? '/', `http://${host}`)
    if (url.pathname.startsWith('/api/')) {
      await web.handle(request, response)
      return
    }
    if (!vite) {
      response.statusCode = 503
      response.end('Starting')
      return
    }
    vite.middlewares(request, response, () => {
      if (!response.headersSent) {
        response.statusCode = 404
        response.end('Not found')
      }
    })
  } catch (error) {
    if (response.headersSent) return
    response.statusCode = 500
    response.end(error instanceof Error ? error.message : 'Internal error')
  }
}

vite = await createViteServer({
  configFile: resolve('vite.web.config.ts'),
  server: {
    middlewareMode: true,
    hmr: { server: httpServer }
  }
})

httpServer.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${port} 已被占用。可以设置 PIXELBATCH_WEB_PORT 换一个端口。`)
  } else {
    console.error(error)
  }
  shutdown(1)
})

httpServer.listen(port, host, () => {
  const url = `http://${host}:${port}`
  console.log(`PixelBatch web  ${url}`)
  console.log(`数据目录  ${web.dataDir}`)
  openBrowser(url)
})

function readPort(): number {
  const raw = process.env.PIXELBATCH_WEB_PORT
  if (!raw) return 5180
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`PIXELBATCH_WEB_PORT 不是有效端口：${raw}`)
  }
  return value
}

function openBrowser(url: string): void {
  if (process.env.PIXELBATCH_NO_OPEN === '1') return
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  spawn(command, args, { stdio: 'ignore', detached: true }).unref()
}

function shutdown(code: number): void {
  web.close()
  void vite?.close()
  httpServer.close()
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
