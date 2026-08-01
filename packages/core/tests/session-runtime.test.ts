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
});
