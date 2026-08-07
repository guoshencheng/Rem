import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, SqliteSchemaManager } from '../src/plugins/storage/sqlite/schema.js';
import { runMigrations } from '../src/plugins/storage/sqlite/schema/migrations.js';
import { migrateAgentIdentity } from '../src/plugins/storage/sqlite/schema/agent-identity-migration.js';
import { SESSION_DDL } from '../src/plugins/storage/sqlite/schema/session-ddl.js';

const columnsOf = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

const tableNames = (db: Database.Database) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);

const setupVersionDb = (version: number) => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');
  db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version);
  return db;
};

describe('runMigrations', () => {
  it('migrates from version 1 (triggers all migrations v2 through v11)', () => {
    const db = setupVersionDb(1);
    // Create pre-v2 state: sessions + messages only, no newer columns
    // Also create session_entries manually since v9 migration expects it (it's normally created by SESSION_DDL)
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, workspace TEXT NOT NULL, title TEXT,
        pinned INTEGER NOT NULL DEFAULT 0, current_turn INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
        content_json TEXT NOT NULL, sequence INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE session_entries (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, parent_id TEXT,
        type TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL
      );
    `);

    runMigrations(db, 1);

    const tables = tableNames(db);
    expect(tables).toContain('todos');
    expect(tables).toContain('archived_messages');
    expect(tables).toContain('agent_threads');
    expect(tables).toContain('message_deliveries');

    const todoCols = columnsOf(db, 'todos');
    expect(todoCols).toContain('todos_json');
    expect(todoCols).toContain('session_id');

    const msgCols = columnsOf(db, 'messages');
    expect(msgCols).toContain('tool_call_id');
    expect(msgCols).toContain('tool_name');

    const sessionCols = columnsOf(db, 'sessions');
    expect(sessionCols).toContain('active_leaf_id');
  });

  it('migrates from version 9 (triggers v10, v11 only)', () => {
    const db = setupVersionDb(9);
    // Create pre-v9 state: sessions with active_leaf_id (added in v9), messages with tool_call_id/tool_name (added in v8)
    // session_entries table already exists (it's created by current DDL but v9 migration only inserts into it)
    db.exec(SESSION_DDL);
    // v10/v11 don't need any special pre-conditions other than sessions+agent_threads+session_entries existing

    runMigrations(db, 9);

    const tables = tableNames(db);
    expect(tables).toContain('agent_threads');
    expect(tables).toContain('message_deliveries');
  });

  it('migrates from version 10 (triggers v11 only — agent identity migration with profile remapping)', () => {
    const db = setupVersionDb(10);
    db.exec(SESSION_DDL);
    // Old agent_threads table with agent_profile_id column (pre-v11 shape)
    db.exec(`
      CREATE TABLE agent_threads (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, agent_id TEXT NOT NULL,
        agent_profile_id TEXT NOT NULL, role TEXT NOT NULL, lifecycle TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `);
    db.exec(`INSERT INTO sessions (id, workspace, title, pinned, current_turn, metadata_json, created_at, updated_at)
      VALUES ('s1', 'ws', NULL, 0, 0, '{}', '2024-01-01', '2024-01-01')`);
    db.exec(`INSERT INTO agent_threads (id, session_id, agent_id, agent_profile_id, role, lifecycle, created_at, updated_at)
      VALUES ('at1', 's1', 'ag1', 'default-primary', 'primary', 'ephemeral', '2024-01-01', '2024-01-01')`);
    db.exec(`INSERT INTO agent_threads (id, session_id, agent_id, agent_profile_id, role, lifecycle, created_at, updated_at)
      VALUES ('at2', 's1', 'ag2', 'custom-profile', 'worker', 'persistent', '2024-01-01', '2024-01-01')`);

    runMigrations(db, 10);

    const atCols = columnsOf(db, 'agent_threads');
    expect(atCols).not.toContain('agent_profile_id');
    expect(atCols).toContain('agent_id');

    const row1 = db.prepare('SELECT agent_id FROM agent_threads WHERE id = ?').get('at1') as { agent_id: string };
    expect(row1.agent_id).toBe('default');

    const row2 = db.prepare('SELECT agent_id FROM agent_threads WHERE id = ?').get('at2') as { agent_id: string };
    expect(row2.agent_id).toBe('custom-profile');

    const tables = tableNames(db);
    expect(tables).toContain('message_deliveries');
  });

  it('v5 rebuild: drops todos without position column and rebuilds with id', () => {
    const db = setupVersionDb(4);
    // Create tables in pre-v5 shape: messages without tool_call_id/tool_name, sessions without active_leaf_id
    // Also need session_entries for later v9 migrations
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, workspace TEXT NOT NULL, title TEXT,
        pinned INTEGER NOT NULL DEFAULT 0, current_turn INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
        content_json TEXT NOT NULL, sequence INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE session_entries (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, parent_id TEXT,
        type TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL
      );
    `);
    // Create todos WITHOUT position column (simulates it was created by a newer DDL prematurely)
    db.exec(`
      CREATE TABLE todos (
        session_id TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL,
        priority TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, content)
      );
    `);

    runMigrations(db, 4);

    // After v5+v6 consecutive migrations, todos should have todos_json shape
    const todoCols = columnsOf(db, 'todos');
    expect(todoCols).toContain('todos_json');
  });

  it('v5 with existing position column skips drop but still rebuilds', () => {
    const db = setupVersionDb(4);
    // Create tables in pre-v5 shape
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, workspace TEXT NOT NULL, title TEXT,
        pinned INTEGER NOT NULL DEFAULT 0, current_turn INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
        content_json TEXT NOT NULL, sequence INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE session_entries (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, parent_id TEXT,
        type TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL
      );
    `);
    // Create todos WITH position column (correct v2 shape)
    db.exec(`
      CREATE TABLE todos (
        session_id TEXT NOT NULL, position INTEGER NOT NULL, content TEXT NOT NULL,
        status TEXT NOT NULL, priority TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, position)
      );
      INSERT INTO todos (session_id, position, content, status, priority, created_at, updated_at)
        VALUES ('s_test', 0, 'test', 'pending', 'high', '2024-01-01', '2024-01-01');
    `);

    runMigrations(db, 4);

    const todoCols = columnsOf(db, 'todos');
    expect(todoCols).toContain('todos_json');
  });

  it('v9 migration: converts messages to session_entries for existing sessions', () => {
    const db = setupVersionDb(8);
    db.exec(SESSION_DDL);
    // sessions created by SESSION_DDL has active_leaf_id. Remove it to simulate pre-v9.
    db.exec('ALTER TABLE sessions DROP COLUMN active_leaf_id');
    // messages created by SESSION_DDL has tool_call_id and tool_name since v8 added them.
    // Insert test data: one session with messages
    db.exec(`
      INSERT INTO sessions (id, workspace, title, pinned, current_turn, metadata_json, created_at, updated_at)
        VALUES ('s1', 'ws', NULL, 0, 0, '{}', '2024-01-01', '2024-01-01');
      INSERT INTO messages (id, session_id, role, content_json, tool_call_id, tool_name, sequence, created_at)
        VALUES ('m1', 's1', 'user', '"hello"', NULL, NULL, 1, '2024-01-01');
      INSERT INTO messages (id, session_id, role, content_json, tool_call_id, tool_name, sequence, created_at)
        VALUES ('m2', 's1', 'assistant', '"world"', NULL, NULL, 2, '2024-01-01');
      INSERT INTO messages (id, session_id, role, content_json, tool_call_id, tool_name, sequence, created_at)
        VALUES ('m3', 's1', 'toolResult', '"result_json"', 'tc_1', 'my_tool', 3, '2024-01-01');
    `);

    runMigrations(db, 8);

    const sessionCols = columnsOf(db, 'sessions');
    expect(sessionCols).toContain('active_leaf_id');

    const entries = db.prepare('SELECT * FROM session_entries WHERE session_id = ? ORDER BY rowid').all('s1') as any[];
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].type).toBe('message');

    const leafId = db.prepare('SELECT active_leaf_id FROM sessions WHERE id = ?').get('s1') as { active_leaf_id: string | null };
    expect(leafId.active_leaf_id).toBe(entries[entries.length - 1].id);
  });

  it('v9 migration: handles sessions with no messages gracefully', () => {
    const db = setupVersionDb(8);
    db.exec(SESSION_DDL);
    db.exec('ALTER TABLE sessions DROP COLUMN active_leaf_id');
    db.exec(`INSERT INTO sessions (id, workspace, title, pinned, current_turn, metadata_json, created_at, updated_at)
      VALUES ('empty', 'ws', NULL, 0, 0, '{}', '2024-01-01', '2024-01-01')`);

    runMigrations(db, 8);

    const entries = db.prepare('SELECT COUNT(*) as cnt FROM session_entries WHERE session_id = ?').get('empty') as { cnt: number };
    expect(entries.cnt).toBe(0);
  });

  it('idempotent: running runMigrations twice does not error', () => {
    const db = setupVersionDb(9);
    db.exec(SESSION_DDL);

    runMigrations(db, 9);
    // Second run with same version should be safe (ALTER TABLE IF NOT EXISTS patterns, CREATE TABLE IF NOT EXISTS)
    // Re-set version to 9
    db.prepare('UPDATE schema_version SET version = 9').run();
    runMigrations(db, 9);

    // Verify tables still exist
    const tables = tableNames(db);
    expect(tables).toContain('agent_threads');
    expect(tables).toContain('message_deliveries');
  });
});

// ── migrateAgentIdentity (direct export) ─────────────────────────────────────

describe('migrateAgentIdentity', () => {
  it('no agent_profile_id column => only creates delivery tables', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = OFF');
    db.exec(SESSION_DDL);
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_threads (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, agent_id TEXT NOT NULL,
        role TEXT NOT NULL, lifecycle TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `);

    migrateAgentIdentity(db);

    const tables = tableNames(db);
    expect(tables).toContain('message_deliveries');
  });

  it('with agent_profile_id column rebuilds agent tables and drops agent_profiles', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = OFF');
    db.exec(SESSION_DDL);
    db.exec(`
      CREATE TABLE agent_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE agent_threads (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, agent_id TEXT NOT NULL,
        agent_profile_id TEXT NOT NULL, role TEXT NOT NULL, lifecycle TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `);
    db.exec(`INSERT INTO sessions (id, workspace, created_at, updated_at) VALUES ('s1', 'ws', '2024-01-01', '2024-01-01')`);
    db.exec(`INSERT INTO agent_threads (id, session_id, agent_id, agent_profile_id, role, lifecycle, created_at, updated_at)
      VALUES ('at1', 's1', 'ag1', 'default-primary', 'primary', 'ephemeral', '2024-01-01', '2024-01-01')`);

    migrateAgentIdentity(db);

    const atCols = columnsOf(db, 'agent_threads');
    expect(atCols).not.toContain('agent_profile_id');
    expect(atCols).toContain('agent_id');

    const row = db.prepare('SELECT agent_id FROM agent_threads WHERE id = ?').get('at1') as { agent_id: string };
    expect(row.agent_id).toBe('default');

    const tables = tableNames(db);
    expect(tables).toContain('message_deliveries');
    expect(tables).not.toContain('agent_profiles');
  });
});

// ── SqliteSchemaManager ──────────────────────────────────────────────────────

describe('SqliteSchemaManager', () => {
  it('throws on unsupported schema version (> CURRENT)', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');
    db.prepare('INSERT INTO schema_version (version) VALUES (999)').run();
    const manager = new SqliteSchemaManager(db);
    expect(() => manager.migrate()).toThrow('Unsupported schema version: 999');
  });

  it('handles version 10 special case (pre-migrates v11 before running current DDLs)', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = OFF');
    db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');
    db.prepare('INSERT INTO schema_version (version) VALUES (10)').run();

    // Set up tables as they would exist in a v10 database (after current DDLs ran in a previous session)
    // current SESSION_DDL + old agent_threads shape
    db.exec(SESSION_DDL);
    db.exec(`
      CREATE TABLE agent_threads (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, agent_id TEXT NOT NULL,
        agent_profile_id TEXT NOT NULL, role TEXT NOT NULL, lifecycle TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `);
    db.exec(`INSERT INTO sessions (id, workspace, title, pinned, current_turn, metadata_json, created_at, updated_at)
      VALUES ('s1', 'ws', NULL, 0, 0, '{}', '2024-01-01', '2024-01-01')`);
    db.exec(`INSERT INTO agent_threads (id, session_id, agent_id, agent_profile_id, role, lifecycle, created_at, updated_at)
      VALUES ('at1', 's1', 'ag1', 'default-primary', 'primary', 'ephemeral', '2024-01-01', '2024-01-01')`);

    const manager = new SqliteSchemaManager(db);
    manager.migrate();

    const version = (db.prepare('SELECT version FROM schema_version').get() as { version: number });
    expect(version.version).toBe(CURRENT_SCHEMA_VERSION);
    const atCols = columnsOf(db, 'agent_threads');
    expect(atCols).not.toContain('agent_profile_id');
  });

  it('fresh migrate on :memory: sets version and creates all tables', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = OFF');
    new SqliteSchemaManager(db).migrate();
    const row = db.prepare('SELECT version FROM schema_version').get() as { version: number };
    expect(row.version).toBe(CURRENT_SCHEMA_VERSION);
    const tables = tableNames(db);
    for (const t of ['sessions', 'messages', 'todos', 'archived_messages', 'workspaces', 'session_entries', 'agent_threads', 'message_deliveries']) {
      expect(tables).toContain(t);
    }
  });

  it('idempotent: re-migrate on already current schema does not corrupt', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = OFF');
    const mgr = new SqliteSchemaManager(db);
    mgr.migrate();
    db.prepare("INSERT INTO workspaces (path, created_at) VALUES ('/tmp/ws', 1)").run();
    mgr.migrate();
    const ws = db.prepare('SELECT path FROM workspaces').all() as { path: string }[];
    expect(ws).toEqual([{ path: '/tmp/ws' }]);
    const version = (db.prepare('SELECT version FROM schema_version').get() as { version: number });
    expect(version.version).toBe(CURRENT_SCHEMA_VERSION);
  });
});
