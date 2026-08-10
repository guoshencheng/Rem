import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { StorageProvider } from '../../../sdk/storage-provider.js';
import { SqliteSchemaManager } from './schema.js';
import { SqliteSessionStore } from './session-store.js';
import { SqliteTodoStore } from './todo-store.js';
import { SqliteArchiveStore } from './archive-store.js';
import { SqliteWorkspaceStore } from './workspace-store.js';
import { StorageError, wrapSqliteError } from './errors.js';
import { SqliteAgentThreadStore } from './agent-thread-store.js';
import { SqliteMessageDeliveryStore } from './message-delivery-store.js';
import { SqliteOrchestrationStore } from './orchestration-store.js';
import { SqliteRuntimeStore } from './runtime-store.js';

export interface SqliteStorageProviderOptions { dbPath: string }

export class SqliteStorageProvider implements StorageProvider {
  private db: Database.Database | undefined;
  private _sessionStore: SqliteSessionStore | undefined;
  private _todoStore: SqliteTodoStore | undefined;
  private _archiveStore: SqliteArchiveStore | undefined;
  private _workspaceStore: SqliteWorkspaceStore | undefined;
  private _agentThreadStore: SqliteAgentThreadStore | undefined;
  private _messageDeliveryStore: SqliteMessageDeliveryStore | undefined;
  private _orchestrationStore: SqliteOrchestrationStore | undefined;
  private _runtimeStore: SqliteRuntimeStore | undefined;

  constructor(private options: SqliteStorageProviderOptions) {
    this.open();
  }

  private open(): void {
    try {
      mkdirSync(dirname(this.options.dbPath), { recursive: true });
      this.db = new Database(this.options.dbPath);
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('journal_mode = WAL');
      new SqliteSchemaManager(this.db).migrate();
      this._sessionStore = new SqliteSessionStore(this.db);
      this._todoStore = new SqliteTodoStore(this.db);
      this._archiveStore = new SqliteArchiveStore(this.db);
      this._workspaceStore = new SqliteWorkspaceStore(this.db);
      this._agentThreadStore = new SqliteAgentThreadStore(this.db);
      this._messageDeliveryStore = new SqliteMessageDeliveryStore(this.db);
      this._orchestrationStore = new SqliteOrchestrationStore(this.db);
      this._runtimeStore = new SqliteRuntimeStore(this.db);
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw wrapSqliteError(
        err,
        'DB_OPEN',
        `Failed to open SQLite database at ${this.options.dbPath}`
      );
    }
  }

  async init(): Promise<void> {
    if (this.db) return;
    this.open();
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = undefined;
    this._sessionStore = undefined;
    this._todoStore = undefined;
    this._archiveStore = undefined;
    this._workspaceStore = undefined;
    this._agentThreadStore = undefined;
    this._messageDeliveryStore = undefined;
    this._orchestrationStore = undefined;
    this._runtimeStore = undefined;
  }

  get sessionStore(): SqliteSessionStore {
    if (!this._sessionStore) throw new StorageError('DB_OPEN', 'StorageProvider not initialized');
    return this._sessionStore;
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

  get agentThreadStore(): SqliteAgentThreadStore {
    if (!this._agentThreadStore) throw new StorageError('DB_OPEN', 'StorageProvider not initialized');
    return this._agentThreadStore;
  }

  get messageDeliveryStore(): SqliteMessageDeliveryStore {
    if (!this._messageDeliveryStore) throw new StorageError('DB_OPEN', 'StorageProvider not initialized');
    return this._messageDeliveryStore;
  }

  get orchestrationStore(): SqliteOrchestrationStore {
    if (!this._orchestrationStore) throw new StorageError('DB_OPEN', 'StorageProvider not initialized');
    return this._orchestrationStore;
  }

  get runtimeStore(): SqliteRuntimeStore {
    if (!this._runtimeStore) throw new StorageError('DB_OPEN', 'StorageProvider not initialized');
    return this._runtimeStore;
  }

  clean() {
    this.db?.close();
  }
}
