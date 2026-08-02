import { describe, expect, it, vi } from 'vitest';
import type { REMAgent } from '../src/agent/rem-agent.js';
import { AgentThreadRuntime } from '../src/session/agent-thread-runtime.js';

const thread = { agentThreadId: 't', sessionId: 's', agentId: 'a', role: 'member' as const,
  lifecycle: 'persistent' as const, createdAt: new Date(), updatedAt: new Date() };

describe('AgentThreadRuntime', () => {
  it('serializes runs FIFO and continues after rejection', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const runtime = new AgentThreadRuntime(thread, { interrupt: vi.fn() } as unknown as REMAgent);
    const first = runtime.enqueue(async () => { order.push('first:start'); await gate; throw new Error('failed'); });
    const second = runtime.enqueue(async () => { order.push('second'); return 2; });
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['first:start']);
    release();
    await expect(first).rejects.toThrow('failed');
    await expect(second).resolves.toBe(2);
    expect(order).toEqual(['first:start', 'second']);
    expect(runtime.status).toBe('idle');
  });
});
