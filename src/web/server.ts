import { randomUUID } from 'node:crypto'
import { createReadStream, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { isImageFileName } from '../shared/images'
import type {
  CreatePromptInput,
  CreateTaskInput,
  ImageTask,
  SaveModelInput,
  TestModelInput
} from '../shared/types'
import { AppDatabase } from '../main/database'
import { copyResultsToDirectory, nextAvailablePath } from '../main/export-results'
import { testModelConfiguration } from '../main/providers'
import { removeTasksAndFiles } from '../main/remove-tasks'
import { createLocalSecretStore } from '../main/secret-store'
import { TaskRunner } from '../main/task-runner'
import { imageContentType, resolveInsideRoot, revealInFileManager, safeDirectoryName, sanitizeFileName } from './files'
import { HttpError, asRecord, readForm, readJson, sendJson } from './http'

const MAX_IMAGE_BYTES = 50 * 1024 * 1024
const MAX_UPLOADS = 200

export interface WebAppOptions {
  dataDir?: string
  revealFile?: (filePath: string) => void
}

export interface WebApp {
  dataDir: string
  handle(request: IncomingMessage, response: ServerResponse): Promise<void>
  close(): void
}

export function createWebApp(options: WebAppOptions = {}): WebApp {
  const dataDir = options.dataDir ?? join(process.cwd(), 'data', 'web')
  const uploadsDir = join(dataDir, 'uploads')
  const outputDir = join(dataDir, 'output')
  const exportsDir = join(dataDir, 'exports')
  mkdirSync(uploadsDir, { recursive: true })
  mkdirSync(outputDir, { recursive: true })
  mkdirSync(exportsDir, { recursive: true })

  const database = new AppDatabase(join(dataDir, 'pixelbatch.sqlite'), createLocalSecretStore())
  const subscribers = new Set<ServerResponse>()
  const taskRunner = new TaskRunner(database, outputDir, (task) => {
    const payload = `event: task\ndata: ${JSON.stringify(task)}\n\n`
    for (const subscriber of subscribers) subscriber.write(payload)
  })
  for (const task of database.listTasks()) {
    if (task.status === 'queued' || task.status === 'running') taskRunner.enqueue(task.id)
  }

  const revealFile = options.revealFile ?? revealInFileManager

  function requireImage(filePath: string): string {
    if (!isImageFileName(filePath)) throw new HttpError(400, '无效的图片路径。')
    return resolveInsideRoot(dataDir, filePath)
  }

  function requireOptionalImage(filePath: string | null | undefined): string | null {
    if (!filePath) return null
    requireImage(filePath)
    return filePath
  }

  async function uploadImages(request: IncomingMessage): Promise<{ paths: string[] }> {
    const form = await readForm(request)
    const files = form.getAll('files').filter((entry): entry is File => typeof entry !== 'string')
    if (files.length > MAX_UPLOADS) throw new HttpError(400, `一次最多上传 ${MAX_UPLOADS} 张图片。`)

    const batchDir = join(uploadsDir, randomUUID())
    mkdirSync(batchDir, { recursive: true })
    const paths: string[] = []
    for (const file of files) {
      const fileName = sanitizeFileName(file.name)
      if (!isImageFileName(fileName)) continue
      if (file.size > MAX_IMAGE_BYTES) throw new HttpError(413, `图片 ${fileName} 超过 50MB。`)
      const destination = nextAvailablePath(batchDir, fileName)
      await writeFile(destination, Buffer.from(await file.arrayBuffer()))
      paths.push(destination)
    }
    if (paths.length === 0) throw new HttpError(400, '请至少选择一张图片。')
    return { paths }
  }

  function createTask(input: CreateTaskInput): ImageTask {
    if (!Array.isArray(input.imagePaths) || input.imagePaths.length === 0) {
      throw new HttpError(400, '请至少导入一张图片。')
    }
    if (typeof input.prompt !== 'string' || !input.prompt.trim()) {
      throw new HttpError(400, '请填写修图要求。')
    }
    for (const imagePath of input.imagePaths) {
      if (typeof imagePath !== 'string') throw new HttpError(400, '无效的图片路径。')
      requireImage(imagePath)
    }
    const task = database.createTask({ ...input, prompt: input.prompt.trim() })
    taskRunner.enqueue(task.id)
    return task
  }

  async function exportCompleted(id: string) {
    const task = database.getTask(id)
    if (!task) throw new HttpError(404, '找不到这个任务批次。')
    const outputPaths =
      task?.items
        ?.filter((item) => item.status === 'completed' && item.outputPath)
        .map((item) => item.outputPath!) ?? []
    if (outputPaths.length === 0) throw new HttpError(400, '当前任务还没有可另存的成功结果。')
    for (const outputPath of outputPaths) requireImage(outputPath)

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const directory = join(exportsDir, `${safeDirectoryName(task?.name ?? 'export')}-${stamp}`)
    mkdirSync(directory, { recursive: true })
    const count = await copyResultsToDirectory(outputPaths, directory)
    return { canceled: false, directory, count }
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    try {
      if (await route(request, response, url)) return
      sendJson(response, 404, { error: '找不到这个接口。' })
    } catch (error) {
      if (response.headersSent) {
        response.destroy()
        return
      }
      const message = error instanceof Error ? error.message : '服务器错误'
      const status = error instanceof HttpError ? error.status : 400
      sendJson(response, status, { error: message })
    }
  }

  async function route(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL
  ): Promise<boolean> {
    const { pathname } = url

    if (pathname === '/api/events' && request.method === 'GET') {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
      response.write(': connected\n\n')
      subscribers.add(response)
      request.on('close', () => subscribers.delete(response))
      return true
    }

    if (pathname === '/api/images/upload' && request.method === 'POST') {
      sendJson(response, 200, await uploadImages(request))
      return true
    }

    if (pathname === '/api/assets' && request.method === 'GET') {
      const filePath = url.searchParams.get('path')
      if (!filePath) throw new HttpError(400, '无效的图片路径。')
      const resolved = requireImage(filePath)
      const stream = createReadStream(resolved)
      stream.on('error', () => {
        if (!response.headersSent) sendJson(response, 404, { error: '找不到这张图片。' })
        else response.destroy()
      })
      response.writeHead(200, {
        'content-type': imageContentType(resolved),
        'cache-control': 'private, max-age=3600'
      })
      stream.pipe(response)
      return true
    }

    if (pathname === '/api/tasks' && request.method === 'GET') {
      sendJson(response, 200, database.listTasks())
      return true
    }

    if (pathname === '/api/tasks/remove' && request.method === 'POST') {
      const body = asRecord(await readJson(request))
      const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string') : []
      sendJson(
        response,
        200,
        await removeTasksAndFiles({ database, taskRunner, outputRoot: outputDir, ids })
      )
      return true
    }

    if (pathname === '/api/tasks' && request.method === 'POST') {
      const body = asRecord(await readJson(request))
      sendJson(
        response,
        200,
        createTask({
          name: typeof body.name === 'string' ? body.name : undefined,
          imagePaths: Array.isArray(body.imagePaths) ? body.imagePaths.filter((item) => typeof item === 'string') : [],
          prompt: typeof body.prompt === 'string' ? body.prompt : '',
          modelConfigId: typeof body.modelConfigId === 'string' ? body.modelConfigId : '',
          operation: 'ai-retouch'
        })
      )
      return true
    }

    const taskExport = pathname.match(/^\/api\/tasks\/([^/]+)\/export$/)
    if (taskExport && request.method === 'POST') {
      sendJson(response, 200, await exportCompleted(decodeURIComponent(taskExport[1] ?? '')))
      return true
    }

    const taskCancel = pathname.match(/^\/api\/tasks\/([^/]+)\/cancel$/)
    if (taskCancel && request.method === 'POST') {
      const id = decodeURIComponent(taskCancel[1] ?? '')
      const task = database.getTask(id)
      if (!task) throw new HttpError(404, '找不到这个任务批次。')
      const waiting = database.getRunnableItems(id).length > 0
      const running = task.items?.some((item) => item.status === 'running') || taskRunner.isRunning(id)
      if (!waiting && !running) throw new HttpError(400, '这个任务没有可取消的图片。')
      taskRunner.cancel(id)
      sendJson(response, 200, { ok: true })
      return true
    }

    const taskRetry = pathname.match(/^\/api\/tasks\/([^/]+)\/retry$/)
    if (taskRetry && request.method === 'POST') {
      const id = decodeURIComponent(taskRetry[1] ?? '')
      if (!database.getTask(id)) throw new HttpError(404, '找不到这个任务批次。')
      database.retryTask(id)
      taskRunner.enqueue(id)
      sendJson(response, 200, { ok: true })
      return true
    }

    const taskItem = pathname.match(/^\/api\/tasks\/([^/]+)$/)
    if (taskItem && request.method === 'GET') {
      sendJson(response, 200, database.getTask(decodeURIComponent(taskItem[1] ?? '')))
      return true
    }

    if (taskItem && request.method === 'PATCH') {
      const body = asRecord(await readJson(request))
      const name = typeof body.name === 'string' ? body.name : ''
      if (!name.trim()) throw new HttpError(400, '批次名称不能为空。')
      sendJson(response, 200, database.renameTask(decodeURIComponent(taskItem[1] ?? ''), name))
      return true
    }

    if (pathname === '/api/prompts' && request.method === 'GET') {
      sendJson(response, 200, database.listPrompts())
      return true
    }

    if (pathname === '/api/prompts' && request.method === 'POST') {
      const body = asRecord(await readJson(request))
      const input: CreatePromptInput = {
        title: typeof body.title === 'string' ? body.title : '',
        prompt: typeof body.prompt === 'string' ? body.prompt : '',
        coverPath: requireOptionalImage(typeof body.coverPath === 'string' ? body.coverPath : null),
        beforePath: requireOptionalImage(typeof body.beforePath === 'string' ? body.beforePath : null),
        afterPath: requireOptionalImage(typeof body.afterPath === 'string' ? body.afterPath : null),
        source: body.source === 'task' ? 'task' : 'manual'
      }
      if (!input.title.trim() || !input.prompt.trim()) {
        throw new HttpError(400, '请填写提示词标题和内容。')
      }
      sendJson(response, 200, database.createPrompt(input))
      return true
    }

    const promptItem = pathname.match(/^\/api\/prompts\/([^/]+)$/)
    if (promptItem && request.method === 'DELETE') {
      database.removePrompt(decodeURIComponent(promptItem[1] ?? ''))
      sendJson(response, 200, { ok: true })
      return true
    }

    if (pathname === '/api/models' && request.method === 'GET') {
      sendJson(response, 200, database.listModels())
      return true
    }

    if (pathname === '/api/models/test' && request.method === 'POST') {
      const body = asRecord(await readJson(request))
      const input: TestModelInput = {
        id: typeof body.id === 'string' ? body.id : undefined,
        name: typeof body.name === 'string' ? body.name : undefined,
        provider: body.provider === 'gemini' ? 'gemini' : 'openai',
        baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : '',
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
        model: typeof body.model === 'string' ? body.model : ''
      }
      sendJson(response, 200, await testModelConfiguration(input, (id) => database.getModel(id)))
      return true
    }

    if (pathname === '/api/models' && request.method === 'POST') {
      const body = asRecord(await readJson(request))
      const input: SaveModelInput = {
        id: typeof body.id === 'string' ? body.id : undefined,
        name: typeof body.name === 'string' ? body.name : '',
        provider: body.provider === 'gemini' ? 'gemini' : 'openai',
        baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : '',
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
        model: typeof body.model === 'string' ? body.model : '',
        enabled: Boolean(body.enabled),
        isDefault: Boolean(body.isDefault)
      }
      if (!input.name.trim() || !input.baseUrl.trim() || !input.model.trim()) {
        throw new HttpError(400, '请完整填写模型名称、地址和模型名。')
      }
      const saved = database.saveModel(input)
      sendJson(response, 200, { ...saved, apiKey: '' })
      return true
    }

    const modelItem = pathname.match(/^\/api\/models\/([^/]+)$/)
    if (modelItem && request.method === 'DELETE') {
      database.removeModel(decodeURIComponent(modelItem[1] ?? ''))
      sendJson(response, 200, { ok: true })
      return true
    }

    if (pathname === '/api/system/reveal' && request.method === 'POST') {
      const body = asRecord(await readJson(request))
      const filePath = typeof body.path === 'string' ? body.path : ''
      const resolved = requireImage(filePath)
      revealFile(resolved)
      sendJson(response, 200, { ok: true })
      return true
    }

    return false
  }

  return {
    dataDir,
    handle,
    close() {
      for (const subscriber of subscribers) subscriber.end()
      subscribers.clear()
      database.close()
    }
  }
}
