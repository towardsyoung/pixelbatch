import { createRequire } from 'node:module'

// Node 22 prints an experimental warning the first time node:sqlite loads.
const emitWarning = process.emitWarning
process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  const message = typeof warning === 'string' ? warning : warning.message
  if (message.includes('SQLite is an experimental feature')) return
  return Reflect.apply(emitWarning, process, [warning, ...args])
}) as typeof process.emitWarning

interface SqlStatement {
  run(...params: unknown[]): unknown
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

interface SqlConnection {
  exec(sql: string): void
  prepare(sql: string): SqlStatement
  close(): void
}

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => SqlConnection
}

export class SqliteDatabase {
  private readonly db: SqlConnection

  constructor(path: string) {
    this.db = new DatabaseSync(path)
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  pragma(source: string): void {
    this.db.exec(`PRAGMA ${source}`)
  }

  prepare(sql: string): SqlStatement {
    return this.db.prepare(sql)
  }

  transaction<T>(run: () => T): () => T {
    return () => {
      this.db.exec('BEGIN')
      try {
        const result = run()
        this.db.exec('COMMIT')
        return result
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    }
  }

  close(): void {
    this.db.close()
  }
}
