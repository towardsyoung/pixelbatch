import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import {
  BrowserWindow,
  app,
  dialog,
  ipcMain,
  net,
  protocol,
  shell
} from 'electron'
import { readdir } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AppDatabase } from './database'
import { copyResultsToDirectory } from './export-results'
import { TaskRunner } from './task-runner'
import type { CreatePromptInput, CreateTaskInput, SaveModelInput } from '../shared/types'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
let mainWindow: BrowserWindow | null = null
let database: AppDatabase
let taskRunner: TaskRunner

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'pixelbatch',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 19 },
    backgroundColor: '#f2f0e9',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function listImagesInFolder(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .map((entry) => join(folder, entry.name))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

function registerIpc(): void {
  ipcMain.handle('images:pick-files', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择商品图片',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('images:pick-folder', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择图片文件夹',
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const folderPath = result.filePaths[0]
    return {
      folderPath,
      name: basename(folderPath),
      imagePaths: await listImagesInFolder(folderPath)
    }
  })

  ipcMain.handle('images:pick-cover', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择封面图',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle('tasks:list', () => database.listTasks())
  ipcMain.handle('tasks:get', (_event, id: string) => database.getTask(id))
  ipcMain.handle('tasks:create', (_event, input: CreateTaskInput) => {
    if (!input.imagePaths.length) throw new Error('请至少导入一张图片。')
    if (!input.prompt.trim()) throw new Error('请填写修图要求。')
    const task = database.createTask(input)
    taskRunner.enqueue(task.id)
    return task
  })
  ipcMain.handle('tasks:rename', (_event, id: string, name: string) => {
    if (!name.trim()) throw new Error('批次名称不能为空。')
    return database.renameTask(id, name)
  })
  ipcMain.handle('tasks:retry', (_event, id: string) => {
    database.retryTask(id)
    taskRunner.enqueue(id)
  })
  ipcMain.handle('tasks:export-completed', async (_event, id: string) => {
    const task = database.getTask(id)
    const outputPaths =
      task?.items
        ?.filter((item) => item.status === 'completed' && item.outputPath)
        .map((item) => item.outputPath!) ?? []
    if (outputPaths.length === 0) throw new Error('当前任务还没有可另存的成功结果。')

    const result = await dialog.showOpenDialog({
      title: `另存 ${outputPaths.length} 张成功结果`,
      buttonLabel: '另存到此处',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) {
      return { canceled: true, directory: null, count: 0 }
    }

    const directory = result.filePaths[0]
    const count = await copyResultsToDirectory(outputPaths, directory)
    return { canceled: false, directory, count }
  })

  ipcMain.handle('prompts:list', () => database.listPrompts())
  ipcMain.handle('prompts:create', (_event, input: CreatePromptInput) =>
    database.createPrompt(input)
  )
  ipcMain.handle('prompts:remove', (_event, id: string) => database.removePrompt(id))

  ipcMain.handle('models:list', () => database.listModels())
  ipcMain.handle('models:save', (_event, input: SaveModelInput) => database.saveModel(input))
  ipcMain.handle('models:remove', (_event, id: string) => database.removeModel(id))

  ipcMain.handle('system:reveal-file', (_event, path: string) => shell.showItemInFolder(path))
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.pixelbatch.desktop')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  database = new AppDatabase(join(app.getPath('userData'), 'pixelbatch.sqlite'))
  taskRunner = new TaskRunner(
    database,
    join(app.getPath('pictures'), 'PixelBatch'),
    (task) => mainWindow?.webContents.send('task:changed', task)
  )
  for (const task of database.listTasks()) {
    if (task.status === 'queued' || task.status === 'running') taskRunner.enqueue(task.id)
  }

  await protocol.handle('pixelbatch', (request) => {
    const url = new URL(request.url)
    const filePath = url.searchParams.get('path')
    if (!filePath || !IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase())) {
      return new Response('Invalid image path', { status: 400 })
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })

  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => database?.close())
