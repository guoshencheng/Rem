import { describe, expect, it } from 'vitest';
import type { MessageDelivery } from '../src/orchestration/delivery-model.js';
import { createAgentSystem } from '../src/system/create-agent-system.js';
import { createFakeAssembly } from './helpers/fake-di.js';

describe('multi-agent recovery', () => {
  it('marks processing Deliveries interrupted on startup without invoking a model', async () => {
    const assembly = await createFakeAssembly();
    const first = createAgentSystem(assembly);
    const session = await first.createSession({ workspace: 'ws' });
    const now = new Date();
    await assembly.di.storage.agentThreadStore.save({ agentThreadId: 'thread', sessionId: session.sessionId,
      agentId: 'default', role: 'primary', lifecycle: 'persistent', createdAt: now, updatedAt: now });
    const delivery: MessageDelivery = { deliveryId: 'delivery', sessionId: session.sessionId, kind: 'message',
      batchId: 'batch', messageId: 'message', rootUserMessageId: 'root', targetAgentThreadId: 'thread',
      status: 'queued', attempt: 0, depth: 0, createdAt: now, updatedAt: now };
    await assembly.di.storage.messageDeliveryStore.createBatch([delivery]);
    await assembly.di.storage.messageDeliveryStore.claim(delivery.deliveryId);

    const restarted = createAgentSystem(assembly);
    await restarted.getSession(session.sessionId);

    expect((await assembly.di.storage.messageDeliveryStore.get(delivery.deliveryId))?.status)
      .toBe('interrupted');
  });
});
