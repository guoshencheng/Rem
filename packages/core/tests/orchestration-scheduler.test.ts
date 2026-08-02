import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { MessageDelivery } from '../src/orchestration/delivery-model.js';
import { MessageDeliveryUsecase } from '../src/orchestration/delivery-usecase.js';
import { DeliveryExecutor } from '../src/orchestration/delivery-executor.js';
import { DiscussionRuntime } from '../src/orchestration/discussion-runtime.js';
import { OrchestrationScheduler } from '../src/orchestration/scheduler.js';
import { SqliteAgentThreadStore } from '../src/plugins/storage/sqlite/agent-thread-store.js';
import { SqliteMessageDeliveryStore } from '../src/plugins/storage/sqlite/message-delivery-store.js';
import { SqliteSchemaManager } from '../src/plugins/storage/sqlite/schema.js';
import { SqliteSessionStore } from '../src/plugins/storage/sqlite/session-store.js';

describe('OrchestrationScheduler', () => {
  it('runs independent members concurrently and creates one requester resume', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    new SqliteSchemaManager(db).migrate();
    const session = await new SqliteSessionStore(db).create('ws');
    const threadStore = new SqliteAgentThreadStore(db);
    const now = new Date();
    for (const [agentThreadId, agentId, role] of [
      ['organizer', 'organizer', 'organizer'], ['architect', 'architect', 'member'], ['reviewer', 'reviewer', 'member'],
    ] as const) {
      await threadStore.save({ agentThreadId, sessionId: session.sessionId, agentId, role,
        lifecycle: 'persistent', createdAt: now, updatedAt: now });
    }
    const deliveries = new MessageDeliveryUsecase(new SqliteMessageDeliveryStore(db));
    await deliveries.createBatch([makeDelivery(session.sessionId, 'initial', 'initial', 'organizer')]);
    let activeMembers = 0;
    let maxConcurrentMembers = 0;
    const executor = new DeliveryExecutor(async (delivery, discussion) => {
      if (delivery.deliveryId === 'initial') {
        await deliveries.createBatch([
          makeDelivery(session.sessionId, 'architect-work', 'member-batch', 'architect', 'organizer'),
          makeDelivery(session.sessionId, 'reviewer-work', 'member-batch', 'reviewer', 'organizer'),
        ]);
      } else if (delivery.kind === 'resume') {
        discussion.requestFinish('organizer', 'final answer');
      } else {
        activeMembers += 1;
        maxConcurrentMembers = Math.max(maxConcurrentMembers, activeMembers);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeMembers -= 1;
      }
    });
    const discussion = new DiscussionRuntime('root', {
      maxAgentRuns: 20, maxMessages: 50, maxDepth: 8, timeoutMs: 300_000,
      maxTokens: 200_000, maxParallelAgents: 2,
    });

    await new OrchestrationScheduler({ deliveries, executor, maxParallelAgents: 2 })
      .drive(session.sessionId, discussion);

    const all = await deliveries.listByRoot(session.sessionId, 'root');
    expect(maxConcurrentMembers).toBe(2);
    expect(all.filter((item) => item.kind === 'resume')).toHaveLength(1);
    expect(all.every((item) => item.status === 'completed')).toBe(true);
    expect(discussion.status).toBe('completed');
    expect(discussion.finishRequest?.answer).toBe('final answer');
  });
});

function makeDelivery(
  sessionId: string,
  deliveryId: string,
  batchId: string,
  targetAgentThreadId: string,
  requestedByAgentThreadId?: string,
): MessageDelivery {
  const now = new Date();
  return { deliveryId, sessionId, kind: 'message', batchId, messageId: batchId,
    rootUserMessageId: 'root', targetAgentThreadId, requestedByAgentThreadId,
    status: 'queued', attempt: 0, depth: requestedByAgentThreadId ? 1 : 0,
    createdAt: now, updatedAt: now };
}
