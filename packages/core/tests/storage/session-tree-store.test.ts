import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteSchemaManager } from '../../src/plugins/storage/sqlite/schema.js';
import { SqliteSessionStore } from '../../src/plugins/storage/sqlite/session-store.js';
import type { SessionTreeEntry } from '../../src/session-tree/types.js';

const setup = async () => {
  const db = new Database(':memory:');
  new SqliteSchemaManager(db).migrate();
  const store = new SqliteSessionStore(db);
  const session = await store.create('default');
  return { store, session };
};

const msgEntry = (id: string, sessionId: string, parentId: string | null, text: string): SessionTreeEntry => ({
  id, sessionId, parentId, type: 'message',
  payload: { message: { role: 'user', content: text, timestamp: 1 }, messageId: id },
  timestamp: Date.now(),
});

describe('SqliteSessionStore tree entries', () => {
  it('appendEntry advances the active leaf', async () => {
    const { store, session } = await setup();
    await store.appendEntry(msgEntry('e1', session.sessionId, null, 'a'));
    expect(await store.getActiveLeafId(session.sessionId)).toBe('e1');
    await store.appendEntry(msgEntry('e2', session.sessionId, 'e1', 'b'));
    expect(await store.getActiveLeafId(session.sessionId)).toBe('e2');
  });

  it('load rebuilds conversation from the leaf chain', async () => {
    const { store, session } = await setup();
    await store.appendEntry(msgEntry('e1', session.sessionId, null, 'a'));
    await store.appendEntry(msgEntry('e2', session.sessionId, 'e1', 'b'));
    const loaded = await store.load(session.sessionId);
    expect(loaded!.conversation.map((m) => m.content)).toEqual(['a', 'b']);
  });

  it('save no longer rewrites messages and preserves entries', async () => {
    const { store, session } = await setup();
    await store.appendEntry(msgEntry('e1', session.sessionId, null, 'a'));
    const loaded = await store.load(session.sessionId);
    loaded!.metadata.title = 't';
    await store.save(loaded!);
    expect((await store.listEntries(session.sessionId))).toHaveLength(1);
    expect((await store.load(session.sessionId))!.metadata.title).toBe('t');
  });
});
