import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../src/main/database'
import { createLocalSecretStore } from '../src/main/secret-store'
import { SqliteDatabase } from '../src/main/sqlite'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('remove model', () => {
  it('deletes a model that only has finished tasks and keeps the task name', () => {
    const database = openDatabase()
    const model = nonDefaultModel(database)
    const task = database.createTask({
      imagePaths: ['/tmp/goods.png'],
      prompt: '已完成的批次',
      modelConfigId: model.id,
      operation: 'ai-retouch'
    })
    const item = database.getTask(task.id)?.items?.[0]
    if (!item) throw new Error('缺少任务图片')
    database.updateItem(item.id, 'completed', '/tmp/goods-out.png')

    database.removeModel(model.id)

    expect(database.getModel(model.id)).toBeNull()
    expect(database.listTasks().find((entry) => entry.id === task.id)?.modelName).toBe(model.name)
    database.close()
  })

  it('fails a waiting task when its model is deleted', () => {
    const database = openDatabase()
    const model = nonDefaultModel(database)
    const task = database.createTask({
      imagePaths: ['/tmp/waiting.png'],
      prompt: '还在排队',
      modelConfigId: model.id,
      operation: 'ai-retouch'
    })

    database.removeModel(model.id)

    const stored = database.getTask(task.id)
    expect(stored?.status).toBe('failed')
    expect(stored?.items?.[0]?.error).toBe('模型已被删除。')
    database.close()
  })

  it('keeps a model that a running task still uses', () => {
    const database = openDatabase()
    const model = nonDefaultModel(database)
    const task = database.createTask({
      imagePaths: ['/tmp/running.png'],
      prompt: '处理中',
      modelConfigId: model.id,
      operation: 'ai-retouch'
    })
    const item = database.getTask(task.id)?.items?.[0]
    if (!item) throw new Error('缺少任务图片')
    database.updateItem(item.id, 'running')

    expect(() => database.removeModel(model.id)).toThrow('有任务正在使用这个模型')
    expect(database.getModel(model.id)?.name).toBe(model.name)
    database.close()
  })

  it('opens an older database that still has the model foreign key', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pixelbatch-model-'))
    directories.push(directory)
    const path = join(directory, 'pixelbatch.sqlite')
    const legacy = new SqliteDatabase(path)
    legacy.exec(`
      CREATE TABLE model_configs (
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
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        operation TEXT NOT NULL,
        prompt TEXT NOT NULL,
        model_config_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(model_config_id) REFERENCES model_configs(id)
      );
      CREATE TABLE task_items (
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
      INSERT INTO model_configs
        (id, name, provider, base_url, api_key, model, enabled, is_default, created_at, updated_at)
      VALUES
        ('model-1', '旧模型', 'openai', 'https://example.test/v1', '', 'gpt-image-2', 1, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO tasks
        (id, name, operation, prompt, model_config_id, status, created_at, updated_at)
      VALUES
        ('task-1', '历史批次', 'ai-retouch', '提亮', 'model-1', 'completed', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO task_items
        (id, task_id, input_path, output_path, status, error, created_at, updated_at)
      VALUES
        ('item-1', 'task-1', '/tmp/old.png', '/tmp/old-out.png', 'completed', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    `)
    legacy.close()

    const database = new AppDatabase(path, createLocalSecretStore())
    database.removeModel('model-1')
    expect(database.getModel('model-1')).toBeNull()
    expect(database.getTask('task-1')?.modelName).toBe('旧模型')
    database.close()
  })
})

function openDatabase(): AppDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'pixelbatch-model-'))
  directories.push(directory)
  return new AppDatabase(join(directory, 'pixelbatch.sqlite'), createLocalSecretStore())
}

function nonDefaultModel(database: AppDatabase) {
  const model = database.listModels().find((entry) => !entry.isDefault)
  if (!model) throw new Error('缺少可删除的模型')
  return model
}
