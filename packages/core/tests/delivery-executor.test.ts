import { describe, expect, it, vi } from 'vitest';
import type { Message } from '@earendil-works/pi-ai';
import { AgentThreadDeliveryExecutor } from '../src/orchestration/delivery-executor.js';
import type { MessageDelivery } from '../src/orchestration/delivery-model.js';
import type { DiscussionRuntime } from '../src/orchestration/discussion-runtime.js';
import type { AgentThreadRuntime } from '../src/session/agent-thread-runtime.js';

const now = new Date();

function makeDelivery(): MessageDelivery {
  return {
    deliveryId: 'd1', sessionId: 's1', kind: 'message', batchId: 'b1', messageId: 'm1',
    rootUserMessageId: 'r1', targetAgentThreadId: 't1', status: 'processing', attempt: 1,
    depth: 1, createdAt: now, updatedAt: now,
  };
}

function makeRuntime() {
  const continueFn = vi.fn(() => (async function* () {})());
  const agent = { syncTranscript: vi.fn(), continue: continueFn };
  const runtime = { agent, enqueue: (run: () => Promise<unknown>) => run() };
  return { runtime: runtime as unknown as AgentThreadRuntime, agent };
}

const userMessage = { role: 'user', content: 'hi', timestamp: 1 } as Message;
const assistantMessage = {
  role: 'assistant', api: 'test', provider: 'test', model: 'test',
  content: [{ type: 'text', text: 'done' }], stopReason: 'stop', timestamp: 2,
} as unknown as Message;

describe('AgentThreadDeliveryExecutor', () => {
  const discussion = {} as DiscussionRuntime;

  it('drives agent.continue when transcript ends with new user input', async () => {
    const { runtime, agent } = makeRuntime();
    const drive = vi.fn(async () => {});
    const executor = new AgentThreadDeliveryExecutor({
      getRuntime: async () => runtime,
      projectTranscript: async () => [userMessage],
      eventDriver: { drive } as never,
    });
    await executor.execute(makeDelivery(), discussion);
    expect(agent.syncTranscript).toHaveBeenCalledWith([userMessage]);
    expect(agent.continue).toHaveBeenCalledOnce();
    expect(drive).toHaveBeenCalledOnce();
  });

  it('skips execution when transcript already ends with own assistant message', async () => {
    const { runtime, agent } = makeRuntime();
    const drive = vi.fn(async () => {});
    const executor = new AgentThreadDeliveryExecutor({
      getRuntime: async () => runtime,
      projectTranscript: async () => [userMessage, assistantMessage],
      eventDriver: { drive } as never,
    });
    await executor.execute(makeDelivery(), discussion);
    expect(agent.continue).not.toHaveBeenCalled();
    expect(drive).not.toHaveBeenCalled();
  });
});
