import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { MessageDelivery } from '../src/orchestration/delivery-model.js';
import { SqliteAgentThreadStore } from '../src/plugins/storage/sqlite/agent-thread-store.js';
import { SqliteMessageDeliveryStore } from '../src/plugins/storage/sqlite/message-delivery-store.js';
import { SqliteSchemaManager } from '../src/plugins/storage/sqlite/schema.js';
import { SqliteSessionStore } from '../src/plugins/storage/sqlite/session-store.js';

async function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  new SqliteSchemaManager(db).migrate();
  const sessions = new SqliteSessionStore(db);
  const threads = new SqliteAgentThreadStore(db);
  const session = await sessions.create('ws');
  const now = new Date();
  await threads.save({ agentThreadId: 'thread', sessionId: session.sessionId, agentId: 'default',
    role: 'primary', lifecycle: 'persistent', createdAt: now, updatedAt: now });
  return { db, session, store: new SqliteMessageDeliveryStore(db) };
}

function delivery(sessionId: string, id: string, batchId = id): MessageDelivery {
  const now = new Date();
  return { deliveryId: id, sessionId, kind: 'message', batchId, messageId: `m-${id}`,
    rootUserMessageId: 'root', targetAgentThreadId: 'thread', status: 'queued', attempt: 0,
    depth: 0, createdAt: now, updatedAt: now };
}

describe('SqliteMessageDeliveryStore', () => {
  it('claims at most one Delivery per target Thread and guards terminal transitions', async () => {
    const { session, store } = await fixture();
    await store.createBatch([delivery(session.sessionId, 'd1'), delivery(session.sessionId, 'd2')]);
    expect(await store.claim('d1')).toBe(true);
    expect(await store.claim('d2')).toBe(false);
    await store.complete('d1');
    expect(await store.claim('d2')).toBe(true);
    await store.fail('d2', 'failed');
    await expect(store.complete('d2')).rejects.toThrow('Invalid Delivery transition');
    expect((await store.listByRoot(session.sessionId, 'root')).map((item) => item.status))
      .toEqual(['completed', 'failed']);
  });

  it('interrupts roots and recovers processing Deliveries without replay', async () => {
    const { session, store } = await fixture();
    await store.createBatch([delivery(session.sessionId, 'd1'), delivery(session.sessionId, 'd2')]);
    await store.claim('d1');
    expect(await store.interruptRoot(session.sessionId, 'root')).toBe(2);
    expect(await store.listQueued(session.sessionId, 'root')).toEqual([]);
    await store.createBatch([delivery(session.sessionId, 'd3')]);
    await store.claim('d3');
    expect(await store.recoverProcessing()).toBe(1);
    expect((await store.get('d3'))?.status).toBe('interrupted');
  });
});
