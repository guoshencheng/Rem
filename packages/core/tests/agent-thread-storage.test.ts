import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, SqliteSchemaManager } from '../src/plugins/storage/sqlite/schema.js';
import { SESSION_DDL } from '../src/plugins/storage/sqlite/schema/session-ddl.js';
import { SqliteSessionStore } from '../src/plugins/storage/sqlite/session-store.js';
import { SqliteAgentThreadStore } from '../src/plugins/storage/sqlite/agent-thread-store.js';

describe('AgentThread SQLite store', () => {
  it('roundtrips config agent ids and enforces persistent uniqueness', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    new SqliteSchemaManager(db).migrate();
    const sessions = new SqliteSessionStore(db);
    const threads = new SqliteAgentThreadStore(db);
    const session = await sessions.create('ws');
    const now = new Date();
    await threads.save({
      agentThreadId: 't-1', sessionId: session.sessionId, agentId: 'default',
      role: 'primary', lifecycle: 'persistent', createdAt: now, updatedAt: now,
    });
    expect((await threads.get('t-1'))?.agentId).toBe('default');
    await expect(threads.save({
      agentThreadId: 't-2', sessionId: session.sessionId, agentId: 'default',
      role: 'member', lifecycle: 'persistent', createdAt: now, updatedAt: now,
    })).rejects.toThrow();
    await sessions.delete(session.sessionId);
    expect(await threads.listBySession(session.sessionId)).toEqual([]);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
      .map(({ name }) => name);
    expect(tables).not.toContain('agent_profiles');
    expect(tables).toContain('message_deliveries');
  });

  it('migrates v10 profile ids to v11 config agent ids', () => {
    const db = new Database(':memory:');
    db.exec(SESSION_DDL);
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      INSERT INTO schema_version VALUES (10);
      CREATE TABLE agent_profiles (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, system_prompt TEXT,
        model_json TEXT, tool_policy_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE agent_threads (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, agent_profile_id TEXT NOT NULL,
        role TEXT NOT NULL, lifecycle TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO sessions (id, workspace, created_at, updated_at) VALUES ('s', 'ws', '2026-01-01', '2026-01-01');
      INSERT INTO agent_profiles VALUES ('default-primary', 'Default', NULL, NULL, NULL, '2026-01-01', '2026-01-01');
      INSERT INTO agent_profiles VALUES ('custom', 'Custom', NULL, NULL, NULL, '2026-01-01', '2026-01-01');
      INSERT INTO agent_threads VALUES ('t1', 's', 'default-primary', 'primary', 'persistent', '2026-01-01', '2026-01-01');
      INSERT INTO agent_threads VALUES ('t2', 's', 'custom', 'delegated', 'one-shot', '2026-01-01', '2026-01-01');
    `);

    new SqliteSchemaManager(db).migrate();

    expect(db.prepare('SELECT version FROM schema_version').get()).toEqual({ version: CURRENT_SCHEMA_VERSION });
    expect(db.prepare('SELECT id, agent_id FROM agent_threads ORDER BY id').all()).toEqual([
      { id: 't1', agent_id: 'default' },
      { id: 't2', agent_id: 'custom' },
    ]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'agent_profiles'").get()).toBeUndefined();
  });
});
