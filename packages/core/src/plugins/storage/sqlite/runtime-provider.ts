import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RuntimeStorageProvider } from '../../../sdk/runtime-storage-provider.js';
import { StorageError, wrapSqliteError } from './errors.js';
import { SqliteRuntimeStore } from './runtime-store.js';
import { SqliteSchemaManager } from './schema.js';

export interface SqliteRuntimeStorageProviderOptions { dbPath: string }

/** SQLite provider for the Runtime stack; it owns only Runtime tables and repositories. */
export class SqliteRuntimeStorageProvider implements RuntimeStorageProvider {
  private db?: Database.Database;
  private store?: SqliteRuntimeStore;

  constructor(private readonly options: SqliteRuntimeStorageProviderOptions) {
    this.open();
  }

  async init(): Promise<void> {
    if (!this.db) this.open();
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = undefined;
    this.store = undefined;
  }

  async checkHealth(): Promise<void> {
    if (!this.db || !this.store) throw new StorageError('DB_OPEN', 'Runtime storage provider not initialized');
    try { this.db.prepare('SELECT 1').get(); }
    catch (error) { throw wrapSqliteError(error, 'DB_OPEN', 'Runtime storage health check failed'); }
  }

  get runtimeStore(): SqliteRuntimeStore {
    if (!this.store) throw new StorageError('DB_OPEN', 'RuntimeStorageProvider not initialized');
    return this.store;
  }

  private open(): void {
    try {
      mkdirSync(dirname(this.options.dbPath), { recursive: true });
      const db = new Database(this.options.dbPath);
      db.pragma('foreign_keys = ON');
      db.pragma('journal_mode = WAL');
      new SqliteSchemaManager(db).migrate();
      this.db = db;
      this.store = new SqliteRuntimeStore(db);
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw wrapSqliteError(error, 'DB_OPEN', `Failed to open Runtime SQLite database at ${this.options.dbPath}`);
    }
  }
}
