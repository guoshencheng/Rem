import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { SqliteSchemaManager } from '../src/plugins/storage/sqlite/schema.js';
import { SqliteSessionStore } from '../src/plugins/storage/sqlite/session-store.js';
import { SqliteAgentProfileStore } from '../src/plugins/storage/sqlite/agent-profile-store.js';
import { SqliteAgentThreadStore } from '../src/plugins/storage/sqlite/agent-thread-store.js';

describe('AgentProfile/AgentThread SQLite stores', () => {
  it('roundtrip、primary 唯一、Session 级联与 Profile restrict', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    new SqliteSchemaManager(db).migrate();
    const sessions = new SqliteSessionStore(db);
    const profiles = new SqliteAgentProfileStore(db);
    const threads = new SqliteAgentThreadStore(db);
    const session = await sessions.create('ws');
    const now = new Date();
    await profiles.save({ agentProfileId: 'p-1', name: 'Coder', createdAt: now, updatedAt: now });
    await threads.save({
      agentThreadId: 't-1', sessionId: session.sessionId, agentProfileId: 'p-1',
      role: 'primary', lifecycle: 'persistent', createdAt: now, updatedAt: now,
    });
    expect((await profiles.get('p-1'))?.name).toBe('Coder');
    expect((await threads.listBySession(session.sessionId))[0].agentThreadId).toBe('t-1');
    await expect(threads.save({
      agentThreadId: 't-2', sessionId: session.sessionId, agentProfileId: 'p-1',
      role: 'primary', lifecycle: 'persistent', createdAt: now, updatedAt: now,
    })).rejects.toThrow();
    await expect(profiles.delete('p-1')).rejects.toThrow();
    await sessions.delete(session.sessionId);
    expect(await threads.listBySession(session.sessionId)).toEqual([]);
    await profiles.delete('p-1');
    expect(await profiles.get('p-1')).toBeNull();
  });
});
