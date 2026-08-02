import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { MessageDelivery } from '../src/orchestration/delivery-model.js';
import { SqliteAgentThreadStore } from '../src/plugins/storage/sqlite/agent-thread-store.js';
import { SqliteMessageDeliveryStore } from '../src/plugins/storage/sqlite/message-delivery-store.js';
import { SqliteOrchestrationStore } from '../src/plugins/storage/sqlite/orchestration-store.js';
import { SqliteSchemaManager } from '../src/plugins/storage/sqlite/schema.js';
import { SqliteSessionStore } from '../src/plugins/storage/sqlite/session-store.js';

describe('SqliteOrchestrationStore', () => {
  it('rolls back the Message and full Delivery batch on conflict', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    new SqliteSchemaManager(db).migrate();
    const sessions = new SqliteSessionStore(db);
    const session = await sessions.create('ws');
    const now = new Date();
    await new SqliteAgentThreadStore(db).save({ agentThreadId: 'thread', sessionId: session.sessionId,
      agentId: 'default', role: 'primary', lifecycle: 'persistent', createdAt: now, updatedAt: now });
    const base: MessageDelivery = { deliveryId: 'd1', sessionId: session.sessionId, kind: 'message',
      batchId: 'batch', messageId: 'message', rootUserMessageId: 'message', targetAgentThreadId: 'thread',
      status: 'queued', attempt: 0, depth: 0, createdAt: now, updatedAt: now };
    const entry = { id: 'entry', sessionId: session.sessionId, parentId: null, type: 'message' as const,
      payload: { messageId: 'message', message: { role: 'user' as const, content: 'hello', timestamp: 1 } },
      timestamp: 1 };

    await expect(new SqliteOrchestrationStore(db).appendMessageWithDeliveries(
      entry, [base, { ...base, deliveryId: 'd2' }],
    )).rejects.toThrow();

    expect(await sessions.listEntries(session.sessionId)).toEqual([]);
    expect(await sessions.getActiveLeafId(session.sessionId)).toBeNull();
    expect(await new SqliteMessageDeliveryStore(db).listByRoot(session.sessionId, 'message')).toEqual([]);
  });
});
