import { describe, expect, it } from 'vitest';
import type { Session } from '../src/session/model.js';
import type { SessionRuntime } from '../src/session/runtime.js';
import type { AgentCoordinator } from '../src/orchestration/agent-coordinator-types.js';
import { resolveSessionMode, AgentCoordinatorResolver } from '../src/orchestration/coordinator-resolver.js';

function fakeSession(mode: unknown): Session {
  return { sessionId: 's1', metadata: { mode } } as unknown as Session;
}

function fakeCoordinator(mode: 'single' | 'multi-agent'): AgentCoordinator {
  return {
    mode,
    createRuntime: async () => { throw new Error('unused'); },
    send: async () => {},
    interrupt: async () => {},
    recoverProcessing: async () => 0,
  };
}

describe('resolveSessionMode', () => {
  it('multi-agent metadata 解析为 multi-agent，其余归一化为 single', () => {
    expect(resolveSessionMode(fakeSession('multi-agent'))).toBe('multi-agent');
    expect(resolveSessionMode(fakeSession('single'))).toBe('single');
    expect(resolveSessionMode(fakeSession(undefined))).toBe('single');
  });
});

describe('AgentCoordinatorResolver', () => {
  it('按 Session metadata 与 Runtime mode 分发', () => {
    const single = fakeCoordinator('single');
    const multi = fakeCoordinator('multi-agent');
    const resolver = new AgentCoordinatorResolver([single, multi]);
    expect(resolver.forSession(fakeSession('single'))).toBe(single);
    expect(resolver.forSession(fakeSession('multi-agent'))).toBe(multi);
    expect(resolver.forRuntime({ mode: 'multi-agent' } as SessionRuntime)).toBe(multi);
    expect(resolver.forRuntime({ mode: 'single' } as SessionRuntime)).toBe(single);
  });

  it('未注册的 mode 抛出错误', () => {
    const resolver = new AgentCoordinatorResolver([fakeCoordinator('single')]);
    expect(() => resolver.forSession(fakeSession('multi-agent')))
      .toThrow('No AgentCoordinator registered for mode: multi-agent');
  });

  it('all() 返回全部已注册 coordinator', () => {
    const resolver = new AgentCoordinatorResolver([fakeCoordinator('single'), fakeCoordinator('multi-agent')]);
    const modes = [...resolver.all()].map((c) => c.mode).sort();
    expect(modes).toEqual(['multi-agent', 'single']);
  });
});
