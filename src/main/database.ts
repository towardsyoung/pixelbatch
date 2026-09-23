import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { SecretStore } from './secret-store'
import { SqliteDatabase } from './sqlite'
import type {
  CreatePromptInput,
  CreateTaskInput,
  ImageTask,
  ModelConfig,
  PromptPreset,
  SaveModelInput,
  TaskItem,
  TaskItemStatus
} from '../shared/types'
import { resolveUniqueTaskName } from '../shared/task-name'
import { deriveTaskStatus } from '../shared/task-utils'

type DbRow = Record<string, unknown>

const TASK_SELECT_COLUMNS = `
  t.id, t.name, t.operation, t.prompt, t.model_config_id,
  COALESCE(NULLIF(m.name, ''), t.model_name) AS model_name,
  t.status, t.created_at, t.updated_at
`

export class AppDatabase {
  private readonly db: SqliteDatabase

  constructor(
    path: string,
    private readonly secrets: SecretStore
  ) {
    this.db = new SqliteDatabase(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()
    this.seedModels()
    this.recoverInterruptedTasks()
  }

  close(): void {
    this.db.close()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS model_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        operation TEXT NOT NULL,
        prompt TEXT NOT NULL,
        model_config_id TEXT NOT NULL,
        model_name TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_items (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        input_path TEXT NOT NULL,
        output_path TEXT,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS prompt_presets (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        cover_path TEXT,
        before_path TEXT,
        after_path TEXT,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_task_items_task ON task_items(task_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_prompts_created ON prompt_presets(created_at DESC);
    `)
    this.detachTaskModelForeignKey()
  }

  private detachTaskModelForeignKey(): void {
    const foreignKeys = this.db.prepare('PRAGMA foreign_key_list(tasks)').all() as DbRow[]
    const columns = this.db.prepare('PRAGMA table_info(tasks)').all() as DbRow[]
    const hasModelForeignKey = foreignKeys.some((row) => row.table === 'model_configs')
    const hasModelName = columns.some((row) => row.name === 'model_name')
    if (!hasModelForeignKey && hasModelName) return

    const modelName = hasModelName ? "NULLIF(t.model_name, '')" : 'NULL'
    this.db.exec('PRAGMA foreign_keys = OFF')
    this.db.exec(`
      CREATE TABLE tasks_migrated (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        operation TEXT NOT NULL,
        prompt TEXT NOT NULL,
        model_config_id TEXT NOT NULL,
        model_name TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO tasks_migrated
        (id, name, operation, prompt, model_config_id, model_name, status, created_at, updated_at)
      SELECT t.id, t.name, t.operation, t.prompt, t.model_config_id,
             COALESCE(${modelName}, m.name, ''),
             t.status, t.created_at, t.updated_at
      FROM tasks t
      LEFT JOIN model_configs m ON m.id = t.model_config_id;
      DROP TABLE tasks;
      ALTER TABLE tasks_migrated RENAME TO tasks;
      CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);
    `)
    this.db.exec('PRAGMA foreign_keys = ON')
  }

  private seedModels(): void {
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM model_configs').get() as {
      count: number
    }
    if (count.count > 0) return

    const now = new Date().toISOString()
    const insert = this.db.prepare(`
      INSERT INTO model_configs
      (id, name, provider, base_url, api_key, model, enabled, is_default, created_at, updated_at)
      VALUES (@id, @name, @provider, @baseUrl, '', @model, 1, @isDefault, @now, @now)
    `)
    insert.run({
      id: randomUUID(),
      name: 'OpenAI · GPT Image 2',
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-image-2',
      isDefault: 1,
      now
    })
    insert.run({
      id: randomUUID(),
      name: 'Google · Nano Banana 2',
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-3.1-flash-image',
      isDefault: 0,
      now
    })
  }

  private recoverInterruptedTasks(): void {
    const now = new Date().toISOString()
    this.db
      .prepare("UPDATE task_items SET status = 'queued', updated_at = ? WHERE status = 'running'")
      .run(now)
    this.db
      .prepare("UPDATE tasks SET status = 'queued', updated_at = ? WHERE status = 'running'")
      .run(now)
  }

  listModels(): ModelConfig[] {
    const rows = this.db
      .prepare('SELECT * FROM model_configs ORDER BY is_default DESC, created_at ASC')
      .all() as DbRow[]
    return rows.map((row) => this.mapModel(row, false))
  }

  getModel(id: string): ModelConfig | null {
    const row = this.db.prepare('SELECT * FROM model_configs WHERE id = ?').get(id) as
      | DbRow
      | undefined
    return row ? this.mapModel(row) : null
  }

  saveModel(input: SaveModelInput): ModelConfig {
    const id = input.id ?? randomUUID()
    const now = new Date().toISOString()
    const existing = input.id ? this.getModel(input.id) : null
    const apiKey =
      input.apiKey === undefined || input.apiKey === '' ? existing?.apiKey ?? '' : input.apiKey

    const transaction = this.db.transaction(() => {
      if (input.isDefault) {
        this.db.prepare('UPDATE model_configs SET is_default = 0').run()
      }
      this.db
        .prepare(
          `INSERT INTO model_configs
           (id, name, provider, base_url, api_key, model, enabled, is_default, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             provider = excluded.provider,
             base_url = excluded.base_url,
             api_key = excluded.api_key,
             model = excluded.model,
             enabled = excluded.enabled,
             is_default = excluded.is_default,
             updated_at = excluded.updated_at`
        )
        .run(
          id,
          input.name,
          input.provider,
          input.baseUrl.replace(/\/+$/, ''),
          this.protectSecret(apiKey),
          input.model,
          Number(input.enabled),
          Number(input.isDefault),
          existing?.createdAt ?? now,
          now
        )
    })
    transaction()
    return this.getModel(id)!
  }

  removeModel(id: string): void {
    const active = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM tasks t
         JOIN task_items i ON i.task_id = t.id
         WHERE t.model_config_id = ? AND i.status = 'running'`
      )
      .get(id) as { count: number }
    if (active.count > 0) {
      throw new Error('有任务正在使用这个模型，请等它处理完再删除。')
    }
    const model = this.getModel(id)
    if (!model) throw new Error('找不到这个模型。')
    if (model.isDefault) throw new Error('默认模型不能删除，请先设置其他默认模型。')

    const queued = this.db
      .prepare("SELECT id FROM tasks WHERE model_config_id = ? AND status = 'queued'")
      .all(id) as DbRow[]
    const transaction = this.db.transaction(() => {
      const now = new Date().toISOString()
      this.db
        .prepare(
          `UPDATE task_items
           SET status = 'failed', error = '模型已被删除。', updated_at = ?
           WHERE status = 'queued'
             AND task_id IN (SELECT id FROM tasks WHERE model_config_id = ?)`
        )
        .run(now, id)
      for (const row of queued) this.refreshTaskStatus(String(row.id))
      this.db.prepare('DELETE FROM model_configs WHERE id = ?').run(id)
    })
    transaction()
  }

  createTask(input: CreateTaskInput): ImageTask {
    const id = randomUUID()
    const now = new Date().toISOString()
    const requestedName =
      input.name?.trim() ||
      `${basename(input.imagePaths[0] ?? '新任务')}${input.imagePaths.length > 1 ? ` 等 ${input.imagePaths.length} 张` : ''}`
    const name = this.uniqueTaskName(requestedName)

    const model = this.getModel(input.modelConfigId)
    if (!model) throw new Error('找不到这个模型。')

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO tasks
           (id, name, operation, prompt, model_config_id, model_name, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`
        )
        .run(id, name, input.operation, input.prompt, input.modelConfigId, model.name, now, now)

      const insertItem = this.db.prepare(
        `INSERT INTO task_items
         (id, task_id, input_path, output_path, status, error, created_at, updated_at)
         VALUES (?, ?, ?, NULL, 'queued', NULL, ?, ?)`
      )
      for (const path of input.imagePaths) {
        insertItem.run(randomUUID(), id, path, now, now)
      }
    })
    transaction()
    return this.getTask(id)!
  }

  renameTask(id: string, name: string): ImageTask {
    if (!this.getTask(id)) throw new Error('找不到这个任务批次。')
    const nextName = this.uniqueTaskName(name, id)
    this.db
      .prepare('UPDATE tasks SET name = ?, updated_at = ? WHERE id = ?')
      .run(nextName, new Date().toISOString(), id)
    return this.getTask(id)!
  }

  listTasks(): ImageTask[] {
    const rows = this.db
      .prepare(
        `SELECT ${TASK_SELECT_COLUMNS},
          COUNT(i.id) AS total,
          SUM(CASE WHEN i.status = 'completed' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN i.status = 'failed' THEN 1 ELSE 0 END) AS failed
         FROM tasks t
         LEFT JOIN model_configs m ON m.id = t.model_config_id
         LEFT JOIN task_items i ON i.task_id = t.id
         GROUP BY t.id
         ORDER BY t.created_at DESC`
      )
      .all() as DbRow[]
    return rows.map((row) => this.mapTask(row))
  }

  getTask(id: string): ImageTask | null {
    const row = this.db
      .prepare(
        `SELECT ${TASK_SELECT_COLUMNS},
          COUNT(i.id) AS total,
          SUM(CASE WHEN i.status = 'completed' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN i.status = 'failed' THEN 1 ELSE 0 END) AS failed
         FROM tasks t
         LEFT JOIN model_configs m ON m.id = t.model_config_id
         LEFT JOIN task_items i ON i.task_id = t.id
         WHERE t.id = ?
         GROUP BY t.id`
      )
      .get(id) as DbRow | undefined
    if (!row) return null
    const task = this.mapTask(row)
    task.items = (
      this.db.prepare('SELECT * FROM task_items WHERE task_id = ? ORDER BY created_at').all(id) as DbRow[]
    ).map((item) => this.mapTaskItem(item))
    return task
  }

  getRunnableItems(taskId: string): TaskItem[] {
    return (
      this.db
        .prepare("SELECT * FROM task_items WHERE task_id = ? AND status = 'queued' ORDER BY created_at")
        .all(taskId) as DbRow[]
    ).map((row) => this.mapTaskItem(row))
  }

  updateItem(
    id: string,
    status: TaskItemStatus,
    outputPath: string | null = null,
    error: string | null = null
  ): void {
    const row = this.db.prepare('SELECT task_id FROM task_items WHERE id = ?').get(id) as
      | { task_id: string }
      | undefined
    if (!row) return
    const now = new Date().toISOString()
    this.db
      .prepare(
        'UPDATE task_items SET status = ?, output_path = ?, error = ?, updated_at = ? WHERE id = ?'
      )
      .run(status, outputPath, error, now, id)
    this.refreshTaskStatus(row.task_id)
  }

  removeTasks(ids: string[]): Array<{ taskId: string; paths: string[] }> {
    const removed: Array<{ taskId: string; paths: string[] }> = []
    const transaction = this.db.transaction(() => {
      for (const id of ids) {
        const task = this.getTask(id)
        if (!task || task.status === 'running') continue
        removed.push({
          taskId: task.id,
          paths: (task.items ?? []).flatMap((item) => (item.outputPath ? [item.outputPath] : []))
        })
        this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
      }
    })
    transaction()
    return removed
  }

  failQueuedItems(taskId: string, message: string): void {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `UPDATE task_items
         SET status = 'failed', error = ?, updated_at = ?
         WHERE task_id = ? AND status = 'queued'`
      )
      .run(message, now, taskId)
    this.refreshTaskStatus(taskId)
  }

  retryTask(id: string): void {
    const now = new Date().toISOString()
    this.db
      .prepare(
        "UPDATE task_items SET status = 'queued', error = NULL, updated_at = ? WHERE task_id = ? AND status = 'failed'"
      )
      .run(now, id)
    this.refreshTaskStatus(id)
  }

  private refreshTaskStatus(taskId: string): void {
    const rows = this.db.prepare('SELECT status FROM task_items WHERE task_id = ?').all(taskId) as {
      status: TaskItemStatus
    }[]
    const status = deriveTaskStatus(rows.map((row) => row.status))
    this.db
      .prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), taskId)
  }

  listPrompts(): PromptPreset[] {
    return (
      this.db.prepare('SELECT * FROM prompt_presets ORDER BY created_at DESC').all() as DbRow[]
    ).map((row) => this.mapPrompt(row))
  }

  createPrompt(input: CreatePromptInput): PromptPreset {
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO prompt_presets
         (id, title, prompt, cover_path, before_path, after_path, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.title.trim(),
        input.prompt.trim(),
        input.coverPath ?? null,
        input.beforePath ?? null,
        input.afterPath ?? null,
        input.source,
        new Date().toISOString()
      )
    return this.mapPrompt(
      this.db.prepare('SELECT * FROM prompt_presets WHERE id = ?').get(id) as DbRow
    )
  }

  removePrompt(id: string): void {
    this.db.prepare('DELETE FROM prompt_presets WHERE id = ?').run(id)
  }

  private uniqueTaskName(name: string, excludeId?: string): string {
    return resolveUniqueTaskName(
      name,
      (candidate) => {
        const row = excludeId
          ? this.db
              .prepare('SELECT 1 FROM tasks WHERE name = ? COLLATE NOCASE AND id != ?')
              .get(candidate, excludeId)
          : this.db.prepare('SELECT 1 FROM tasks WHERE name = ? COLLATE NOCASE').get(candidate)
        return Boolean(row)
      },
      { randomSuffix: () => randomUUID().slice(0, 4).toUpperCase() }
    )
  }

  private protectSecret(value: string): string {
    return this.secrets.protect(value)
  }

  private unprotectSecret(value: string): string {
    return this.secrets.unprotect(value)
  }

  private mapModel(row: DbRow, includeSecret = true): ModelConfig {
    const protectedKey = String(row.api_key)
    return {
      id: String(row.id),
      name: String(row.name),
      provider: row.provider as ModelConfig['provider'],
      baseUrl: String(row.base_url),
      apiKey: includeSecret ? this.unprotectSecret(protectedKey) : '',
      apiKeyConfigured: Boolean(protectedKey),
      model: String(row.model),
      enabled: Boolean(row.enabled),
      isDefault: Boolean(row.is_default),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private mapTask(row: DbRow): ImageTask {
    return {
      id: String(row.id),
      name: String(row.name),
      operation: row.operation as ImageTask['operation'],
      prompt: String(row.prompt),
      modelConfigId: String(row.model_config_id),
      modelName: String(row.model_name),
      status: row.status as ImageTask['status'],
      total: Number(row.total ?? 0),
      completed: Number(row.completed ?? 0),
      failed: Number(row.failed ?? 0),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private mapTaskItem(row: DbRow): TaskItem {
    return {
      id: String(row.id),
      taskId: String(row.task_id),
      inputPath: String(row.input_path),
      outputPath: row.output_path ? String(row.output_path) : null,
      status: row.status as TaskItemStatus,
      error: row.error ? String(row.error) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private mapPrompt(row: DbRow): PromptPreset {
    return {
      id: String(row.id),
      title: String(row.title),
      prompt: String(row.prompt),
      coverPath: row.cover_path ? String(row.cover_path) : null,
      beforePath: row.before_path ? String(row.before_path) : null,
      afterPath: row.after_path ? String(row.after_path) : null,
      source: row.source as PromptPreset['source'],
      createdAt: String(row.created_at)
    }
  }
}
