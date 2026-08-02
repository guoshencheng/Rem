import { describe, expect, it, vi } from 'vitest';
import type { REMAgent } from '../src/agent/rem-agent.js';
import { SessionRuntime } from '../src/session/runtime.js';
import { SessionAlreadyRunningError } from '../src/system/errors.js';

describe('SessionRuntime', () => {
  it('只创建一个 root Agent，并协调 run 与 interrupt', () => {
    const agent = { interrupt: vi.fn() } as unknown as REMAgent;
    const runtime = new SessionRuntime({
      sessionId: 's-1', workspace: 'ws', agentThreadId: 't-1', rootAgent: agent,
    });

    expect(runtime.rootAgent).toBe(agent);
    expect(runtime.threadRuntimes.get('t-1')?.agent).toBe(agent);
    runtime.startRun();
    expect(() => runtime.startRun()).toThrow(SessionAlreadyRunningError);
    runtime.interrupt();
    expect(agent.interrupt).toHaveBeenCalledOnce();
    runtime.finishRun();
    expect(runtime.status).toBe('idle');
  });

  it('失败后允许开始新 run', () => {
    const runtime = new SessionRuntime({
      sessionId: 's-1', workspace: 'ws', agentThreadId: 't-1',
      rootAgent: { interrupt: vi.fn() } as unknown as REMAgent,
    });
    runtime.startRun();
    runtime.failRun();
    expect(runtime.status).toBe('error');
    expect(() => runtime.startRun()).not.toThrow();
  });

  it('allows only one active Discussion', () => {
    const runtime = new SessionRuntime({ sessionId: 's', workspace: 'ws', agentThreadId: 't',
      rootAgent: { interrupt: vi.fn() } as unknown as REMAgent, mode: 'multi-agent' });
    const config = { maxAgentRuns: 20, maxMessages: 50, maxDepth: 8, timeoutMs: 300_000,
      maxTokens: 200_000, maxParallelAgents: 4 };
    runtime.startDiscussion('root', config);
    expect(() => runtime.startDiscussion('other', config)).toThrow(SessionAlreadyRunningError);
    runtime.finishDiscussion();
    expect(() => runtime.startDiscussion('other', config)).not.toThrow();
  });
});
