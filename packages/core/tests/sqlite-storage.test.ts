import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, SqliteSchemaManager } from '../src/plugins/storage/sqlite/schema.js';
import { SqliteSessionStore } from '../src/plugins/storage/sqlite/session-store.js';

const createStore = () => {
  const db = new Database(':memory:');
  new SqliteSchemaManager(db).migrate();
  return { db, store: new SqliteSessionStore(db) };
};

describe('SqliteSchemaManager', () => {
  it('migrates a fresh database to the current schema version', () => {
    const db = new Database(':memory:');
    new SqliteSchemaManager(db).migrate();
    const row = db.prepare('SELECT version FROM schema_version').get() as { version: number };
    expect(row.version).toBe(CURRENT_SCHEMA_VERSION);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
    for (const t of ['sessions', 'messages', 'todos', 'archived_messages', 'workspaces', 'session_entries']) {
      expect(tables).toContain(t);
    }
  });

  it('is idempotent and preserves data across re-migrate', () => {
    const { db } = createStore();
    db.prepare("INSERT INTO workspaces (path, created_at) VALUES ('/tmp/ws', 1)").run();
    new SqliteSchemaManager(db).migrate();
    const ws = db.prepare('SELECT path FROM workspaces').all() as { path: string }[];
    expect(ws).toEqual([{ path: '/tmp/ws' }]);
  });
});

describe('SqliteSessionStore', () => {
  it('create/load roundtrip', async () => {
    const { store } = createStore();
    const session = await store.create('ws');
    const loaded = await store.load(session.sessionId);
    expect(loaded?.sessionId).toBe(session.sessionId);
    expect(loaded?.conversation).toEqual([]);
  });

  it('save() persists metadata and reconciles conversation without duplicating entries', async () => {
    const { store } = createStore();
    const session = await store.create('ws');
    session.metadata.title = 't';
    session.conversation = [{ role: 'user', content: 'hi', timestamp: 1 } as never];
    await store.save(session);
    const loaded = await store.load(session.sessionId);
    expect(loaded?.metadata.title).toBe('t');
    expect(loaded?.conversation).toHaveLength(1);
    await store.save(session);
    const again = await store.load(session.sessionId);
    expect(again?.conversation).toHaveLength(1);
  });

  it('listByWorkspace returns summaries and delete removes the session', async () => {
    const { store } = createStore();
    const session = await store.create('ws-a');
    await store.create('ws-b');
    const list = await store.listByWorkspace('ws-a');
    expect(list).toHaveLength(1);
    expect(list[0].sessionId).toBe(session.sessionId);
    await store.delete(session.sessionId);
    expect(await store.load(session.sessionId)).toBeNull();
  });
});
