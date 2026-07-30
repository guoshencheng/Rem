import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteSchemaManager, CURRENT_SCHEMA_VERSION } from '../../src/plugins/storage/sqlite/schema.js';

describe('schema v9 session tree migration', () => {
  it('creates session_entries and active_leaf_id on fresh database', () => {
    const db = new Database(':memory:');
    new SqliteSchemaManager(db).migrate();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain('session_entries');
    const cols = db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain('active_leaf_id');
    expect(CURRENT_SCHEMA_VERSION).toBe(9);
  });

  it('migrates linear messages into a single chain', () => {
    const db = new Database(':memory:');
    new SqliteSchemaManager(db).migrate();
    db.prepare("INSERT INTO sessions (id, workspace, title, pinned, current_turn, metadata_json, created_at, updated_at) VALUES ('s1','default',NULL,0,0,'{}','2026-01-01','2026-01-01')").run();
    const insert = db.prepare("INSERT INTO messages (id, session_id, role, content_json, tool_call_id, tool_name, sequence, created_at) VALUES (?,?,?,?,?,?,?,?)");
    insert.run('m1', 's1', 'user', '"hello"', null, null, 0, '2026-01-01');
    insert.run('m2', 's1', 'assistant', '[]', null, null, 1, '2026-01-01');
    db.prepare('UPDATE schema_version SET version = 8').run();

    new SqliteSchemaManager(db).migrate();

    const entries = db.prepare("SELECT * FROM session_entries WHERE session_id = 's1' ORDER BY created_at, rowid").all() as any[];
    expect(entries).toHaveLength(2);
    expect(entries[0].parent_id).toBeNull();
    expect(entries[1].parent_id).toBe(entries[0].id);
    const session = db.prepare("SELECT active_leaf_id FROM sessions WHERE id = 's1'").get() as any;
    expect(session.active_leaf_id).toBe(entries[1].id);
  });
});
