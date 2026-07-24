import type {
  ArchiveRecord, ArchiveStore, Rule, RuleSource, RuleStorage, Session,
  SessionStore, SessionSummary, StorageProvider, TodoItem, TodoStore,
  WorkspaceRecord, WorkspaceStore,
} from 'rem-agent-core/browser';
import { generateId } from 'rem-agent-core/browser';
import { getAll, getAllByIndex, openDatabase, reqPromise, txStore } from './idb.js';
import {
  REM_AGENT_DB_VERSION, STORE_ARCHIVES, STORE_RULES, STORE_SESSIONS,
  STORE_TODOS, STORE_WORKSPACES, upgradeRemAgentDb,
} from './schema.js';

interface SessionRecord {
  sessionId: string;
  workspace: string;
  data: string;
}

function serializeSession(session: Session): string {
  return JSON.stringify(session);
}

function deserializeSession(raw: string): Session {
  const s = JSON.parse(raw) as Session;
  s.createdAt = new Date(s.createdAt);
  s.updatedAt = new Date(s.updatedAt);
  return s;
}

function toSummary(record: SessionRecord): SessionSummary {
  const s = deserializeSession(record.data);
  return {
    sessionId: s.sessionId,
    title: s.metadata?.title as string | undefined,
    pinned: s.metadata?.pinned as boolean | undefined,
    updatedAt: s.updatedAt,
    messageCount: Array.isArray(s.conversation) ? s.conversation.length : 0,
    parentSessionId: s.metadata?.parentSessionId as string | undefined,
  };
}

class IdbSessionStore implements SessionStore {
  private memory = new Map<string, SessionRecord>();

  constructor(private getDb: () => IDBDatabase | null) {}

  async create(workspace: string): Promise<Session> {
    const now = new Date();
    const session: Session = {
      sessionId: generateId(),
      conversation: [],
      currentTurn: 0,
      metadata: { schemaVersion: 2, workspace },
      createdAt: now,
      updatedAt: now,
    };
    await this.save(session);
    return session;
  }

  async load(sessionId: string): Promise<Session | null> {
    const db = this.getDb();
    if (!db) {
      const r = this.memory.get(sessionId);
      return r ? deserializeSession(r.data) : null;
    }
    const r = await reqPromise(txStore(db, STORE_SESSIONS, 'readonly').get(sessionId)) as SessionRecord | undefined;
    return r ? deserializeSession(r.data) : null;
  }

  async save(session: Session): Promise<void> {
    const record: SessionRecord = {
      sessionId: session.sessionId,
      workspace: (session.metadata?.workspace as string | undefined) ?? 'default',
      data: serializeSession(session),
    };
    const db = this.getDb();
    if (!db) {
      this.memory.set(session.sessionId, record);
      return;
    }
    await reqPromise(txStore(db, STORE_SESSIONS, 'readwrite').put(record));
  }

  async delete(sessionId: string): Promise<void> {
    const db = this.getDb();
    if (!db) {
      this.memory.delete(sessionId);
      return;
    }
    await reqPromise(txStore(db, STORE_SESSIONS, 'readwrite').delete(sessionId));
  }

  async listByWorkspace(workspace: string): Promise<SessionSummary[]> {
    const db = this.getDb();
    if (!db) {
      return [...this.memory.values()].filter((r) => r.workspace === workspace).map(toSummary);
    }
    const records = await getAllByIndex<SessionRecord>(db, STORE_SESSIONS, 'workspace', workspace);
    return records.map(toSummary);
  }

  async listAll(): Promise<SessionSummary[]> {
    const db = this.getDb();
    if (!db) {
      return [...this.memory.values()].map(toSummary);
    }
    const records = await getAll<SessionRecord>(db, STORE_SESSIONS);
    return records.map(toSummary);
  }
}

class IdbRuleStorage implements RuleStorage {
  private memory: Array<Rule & { id?: number }> = [];

  constructor(private getDb: () => IDBDatabase | null) {}

  async loadAll(): Promise<Rule[]> {
    const db = this.getDb();
    if (!db) return [...this.memory];
    return getAll<Rule>(db, STORE_RULES);
  }

  async loadBySource(source: RuleSource): Promise<Rule[]> {
    const db = this.getDb();
    if (!db) return this.memory.filter((r) => r.source === source);
    return getAllByIndex<Rule>(db, STORE_RULES, 'source', source);
  }

  async saveApproved(rule: Omit<Rule, 'source'>): Promise<void> {
    const record = { ...rule, source: 'approved' as const };
    const db = this.getDb();
    if (!db) {
      this.memory.push(record);
      return;
    }
    await reqPromise(txStore(db, STORE_RULES, 'readwrite').add(record));
  }
}

class IdbTodoStore implements TodoStore {
  private memory = new Map<string, TodoItem[]>();

  constructor(private getDb: () => IDBDatabase | null) {}

  async getBySession(sessionId: string): Promise<TodoItem[]> {
    const db = this.getDb();
    if (!db) return this.memory.get(sessionId) ?? [];
    const r = await reqPromise(txStore(db, STORE_TODOS, 'readonly').get(sessionId)) as { todos: TodoItem[] } | undefined;
    return r?.todos ?? [];
  }

  async replaceForSession(sessionId: string, todos: TodoItem[]): Promise<TodoItem[]> {
    const db = this.getDb();
    if (!db) {
      this.memory.set(sessionId, todos);
      return todos;
    }
    await reqPromise(txStore(db, STORE_TODOS, 'readwrite').put({ sessionId, todos }));
    return todos;
  }
}

class IdbArchiveStore implements ArchiveStore {
  private memory = new Map<string, ArchiveRecord>();

  constructor(private getDb: () => IDBDatabase | null) {}

  private static revive(record: ArchiveRecord): ArchiveRecord {
    return { ...record, compressedAt: new Date(record.compressedAt) };
  }

  async save(record: ArchiveRecord): Promise<void> {
    const db = this.getDb();
    if (!db) {
      this.memory.set(record.id, record);
      return;
    }
    await reqPromise(txStore(db, STORE_ARCHIVES, 'readwrite').put(record));
  }

  async get(id: string): Promise<ArchiveRecord | null> {
    const db = this.getDb();
    if (!db) {
      const r = this.memory.get(id);
      return r ? IdbArchiveStore.revive(r) : null;
    }
    const r = await reqPromise(txStore(db, STORE_ARCHIVES, 'readonly').get(id)) as ArchiveRecord | undefined;
    return r ? IdbArchiveStore.revive(r) : null;
  }

  async listBySession(sessionId: string): Promise<ArchiveRecord[]> {
    const db = this.getDb();
    const list = db
      ? await getAllByIndex<ArchiveRecord>(db, STORE_ARCHIVES, 'sessionId', sessionId)
      : [...this.memory.values()].filter((r) => r.sessionId === sessionId);
    return list.map(IdbArchiveStore.revive);
  }

  async getLatest(sessionId: string): Promise<ArchiveRecord | null> {
    const list = await this.listBySession(sessionId);
    if (list.length === 0) return null;
    return list.reduce((a, b) => (a.version >= b.version ? a : b));
  }
}

class IdbWorkspaceStore implements WorkspaceStore {
  private memory = new Map<string, WorkspaceRecord>();

  constructor(private getDb: () => IDBDatabase | null) {}

  async list(): Promise<WorkspaceRecord[]> {
    const db = this.getDb();
    if (!db) return [...this.memory.values()];
    return getAll<WorkspaceRecord>(db, STORE_WORKSPACES);
  }

  async add(path: string): Promise<WorkspaceRecord> {
    const record: WorkspaceRecord = { path, createdAt: Date.now() };
    const db = this.getDb();
    if (!db) {
      this.memory.set(path, record);
      return record;
    }
    await reqPromise(txStore(db, STORE_WORKSPACES, 'readwrite').put(record));
    return record;
  }

  async remove(path: string): Promise<void> {
    const db = this.getDb();
    if (!db) {
      this.memory.delete(path);
      return;
    }
    await reqPromise(txStore(db, STORE_WORKSPACES, 'readwrite').delete(path));
  }
}

export class IndexedDBStorageProvider implements StorageProvider {
  private db: IDBDatabase | null = null;
  private getDb = () => this.db;

  readonly sessionStore = new IdbSessionStore(this.getDb);
  readonly ruleStore = new IdbRuleStorage(this.getDb);
  readonly todoStore = new IdbTodoStore(this.getDb);
  readonly archiveStore = new IdbArchiveStore(this.getDb);
  readonly workspaceStore = new IdbWorkspaceStore(this.getDb);

  constructor(private dbName = 'rem-agent') {}

  async init(): Promise<void> {
    try {
      this.db = await openDatabase(this.dbName, REM_AGENT_DB_VERSION, upgradeRemAgentDb);
    } catch (err) {
      // 隐私模式等场景下降级为内存存储，不阻断使用
      console.warn('[rem] IndexedDB unavailable, falling back to in-memory storage:', err);
      this.db = null;
    }
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }
}
