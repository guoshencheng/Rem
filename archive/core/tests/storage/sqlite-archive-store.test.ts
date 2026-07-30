import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteArchiveStore } from '../../src/plugins/storage/sqlite/archive-store.js';
import { SqliteSchemaManager } from '../../src/plugins/storage/sqlite/schema.js';
import type { ArchiveRecord } from '../../src/sdk/storage-provider.js';

describe('SqliteArchiveStore', () => {
  let db: Database.Database;
  let store: SqliteArchiveStore;

  beforeEach(() => {
    db = new Database(':memory:');
    new SqliteSchemaManager(db).migrate();
    // Insert a session row so FK constraint is satisfied
    db.prepare(
      `INSERT INTO sessions (id, workspace, title, pinned, current_turn, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('session-1', 'default', null, 0, 0, '{}', '2026-07-14T00:00:00.000Z', '2026-07-14T00:00:00.000Z');
    store = new SqliteArchiveStore(db);
  });

  afterEach(() => {
    db.close();
  });

  const sampleRecord: ArchiveRecord = {
    id: 'archive-1',
    sessionId: 'session-1',
    compressedAt: new Date('2026-07-14T00:00:00Z'),
    version: 1,
    conversationSnapshot: [
      { id: 'msg-1', role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ],
    summary: '## Objective\n- test',
  };

  it('saves and retrieves an archive', async () => {
    await store.save(sampleRecord);
    const got = await store.get('archive-1');
    expect(got).not.toBeNull();
    expect(got?.summary).toBe('## Objective\n- test');
    expect(got?.conversationSnapshot).toHaveLength(1);
  });

  it('lists archives by session ordered by version', async () => {
    await store.save({ ...sampleRecord, id: 'a1', version: 1 });
    await store.save({ ...sampleRecord, id: 'a2', version: 2 });
    const list = await store.listBySession('session-1');
    expect(list).toHaveLength(2);
    expect(list[0].version).toBe(1);
    expect(list[1].version).toBe(2);
  });

  it('returns latest archive', async () => {
    await store.save({ ...sampleRecord, id: 'a1', version: 1 });
    await store.save({ ...sampleRecord, id: 'a2', version: 2 });
    const latest = await store.getLatest('session-1');
    expect(latest?.version).toBe(2);
  });

  it('returns null for missing archive', async () => {
    const got = await store.get('nonexistent');
    expect(got).toBeNull();
  });

  it('returns null for latest on empty session', async () => {
    const latest = await store.getLatest('session-empty');
    expect(latest).toBeNull();
  });
});
