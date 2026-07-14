import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { StorageProvider } from '../../../sdk/storage-provider.js';
import { SqliteSchemaManager } from './schema.js';
import { SqliteSessionStore } from './session-store.js';
import { SqliteRuleStore } from './rule-store.js';
import { SqliteTodoStore } from './todo-store.js';
import { SqliteArchiveStore } from './archive-store.js';
import { SqliteWorkspaceStore } from './workspace-store.js';
import { StorageError, wrapSqliteError } from './errors.js';

export interface SqliteStorageProviderOptions {
  dbPath: string;
}

export class SqliteStorageProvider implements StorageProvider {
  private db: Database.Database | undefined;
  private _sessionStore: SqliteSessionStore | undefined;
  private _ruleStore: SqliteRuleStore | undefined;
  private _todoStore: SqliteTodoStore | undefined;
  private _archiveStore: SqliteArchiveStore | undefined;
  private _workspaceStore: SqliteWorkspaceStore | undefined;

  constructor(private options: SqliteStorageProviderOptions) {}

  async init(): Promise<void> {
    try {
      mkdirSync(dirname(this.options.dbPath), { recursive: true });
      this.db = new Database(this.options.dbPath);
      this.db.pragma('journal_mode = WAL');
      new SqliteSchemaManager(this.db).migrate();
      this._sessionStore = new SqliteSessionStore(this.db);
      this._ruleStore = new SqliteRuleStore(this.db);
      this._todoStore = new SqliteTodoStore(this.db);
      this._archiveStore = new SqliteArchiveStore(this.db);
      this._workspaceStore = new SqliteWorkspaceStore(this.db);
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw wrapSqliteError(
        err,
        'DB_OPEN',
        `Failed to open SQLite database at ${this.options.dbPath}`
      );
    }
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = undefined;
    this._sessionStore = undefined;
    this._ruleStore = undefined;
    this._todoStore = undefined;
    this._archiveStore = undefined;
    this._workspaceStore = undefined;
  }

  get sessionStore(): SqliteSessionStore {
    if (!this._sessionStore) throw new StorageError('DB_OPEN', 'StorageProvider not initialized');
    return this._sessionStore;
  }

  get ruleStore(): SqliteRuleStore {
    if (!this._ruleStore) throw new StorageError('DB_OPEN', 'StorageProvider not initialized');
    return this._ruleStore;
  }

  get todoStore(): SqliteTodoStore {
    if (!this._todoStore) throw new StorageError('DB_OPEN', 'StorageProvider not initialized');
    return this._todoStore;
  }

  get archiveStore(): SqliteArchiveStore {
    if (!this._archiveStore) throw new StorageError('DB_OPEN', 'StorageProvider not initialized');
    return this._archiveStore;
  }

  get workspaceStore(): SqliteWorkspaceStore {
    if (!this._workspaceStore) throw new StorageError('DB_OPEN', 'StorageProvider not initialized');
    return this._workspaceStore;
  }
}
