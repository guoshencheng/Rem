import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { SqliteSchemaManager } from '../../src/storage/schema.js';
import { SqliteSessionStore } from '../../src/storage/sqlite/session-store.js';
import type { ModelMessage } from '../../../src/types.js';

describe('SqliteSessionStore', () => {
  let dir: string;
  let db: Database.Database;
  let store: SqliteSessionStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sqlite-session-test-'));
    db = new Database(join(dir, 'test.db'));
    new SqliteSchemaManager(db).migrate();
    store = new SqliteSessionStore(db);
  });

  afterEach(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('should create a session with default workspace', async () => {
    const session = await store.create('default');
    expect(session.sessionId).toBeDefined();
    expect(session.conversation).toEqual([]);
    expect(session.currentTurn).toBe(0);
    expect(session.metadata).toEqual({ workspace: 'default' });
  });

  it('should save and load a session with messages', async () => {
    const session = await store.create('default');
    session.metadata.title = 'Test';
    session.metadata.pinned = true;
    session.currentTurn = 1;
    const msg: ModelMessage = {
      id: 'm1',
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    };
    session.conversation.push(msg);

    await store.save(session);
    const loaded = await store.load(session.sessionId);

    expect(loaded).not.toBeNull();
    expect(loaded!.metadata.title).toBe('Test');
    expect(loaded!.metadata.pinned).toBe(true);
    expect(loaded!.currentTurn).toBe(1);
    expect(loaded!.conversation).toHaveLength(1);
    expect(loaded!.conversation[0].content).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('should return null for non-existent session', async () => {
    const loaded = await store.load('nonexistent');
    expect(loaded).toBeNull();
  });

  it('should delete a session', async () => {
    const session = await store.create('default');
    await store.delete(session.sessionId);
    const loaded = await store.load(session.sessionId);
    expect(loaded).toBeNull();
  });

  it('should list sessions by workspace sorted by updatedAt desc', async () => {
    const a = await store.create('ws1');
    a.metadata.title = 'A';
    await store.save(a);
    await new Promise((r) => setTimeout(r, 20));

    const b = await store.create('ws1');
    b.metadata.title = 'B';
    await store.save(b);
    await new Promise((r) => setTimeout(r, 20));

    const c = await store.create('ws2');
    c.metadata.title = 'C';
    await store.save(c);

    const list = await store.listByWorkspace('ws1');
    expect(list).toHaveLength(2);
    expect(list[0].title).toBe('B');
    expect(list[1].title).toBe('A');
  });

  it('should keep message order and ids after save', async () => {
    const session = await store.create('default');
    const m1: ModelMessage = { id: 'id-1', role: 'user', content: [{ type: 'text', text: 'first' }] };
    const m2: ModelMessage = { id: 'id-2', role: 'assistant', content: [{ type: 'text', text: 'second' }] };
    session.conversation.push(m1, m2);
    await store.save(session);

    const loaded = await store.load(session.sessionId);
    expect(loaded!.conversation[0].id).toBe('id-1');
    expect(loaded!.conversation[1].id).toBe('id-2');
  });
});
