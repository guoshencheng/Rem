import { describe, expect, it, vi } from 'vitest';
import type { REMAgent } from '../src/agent/rem-agent.js';
import type { REMAgentEvent } from '../src/agent/agent-event.js';
import { AgentRunDriver } from '../src/agent/agent-run-driver.js';
import { EventQueue } from '../src/agent/event-queue.js';
import { emptyUsage } from '../src/agent/token-usage/index.js';
import { SessionRuntime } from '../src/session/runtime.js';
import type { SessionUsecase } from '../src/session/session-usecase.js';

describe('AgentRunDriver', () => {
  it('串行持久化内部事件并发布公开终态', async () => {
    const persistAgentEvent = vi.fn(async () => {});
    const published: Array<{ type: string }> = [];
    const driver = new AgentRunDriver({
      sessionUsecase: { persistAgentEvent } as unknown as SessionUsecase,
      publish: (event) => published.push(event),
    });
    const runtime = new SessionRuntime({ sessionId: 's-1', workspace: 'ws', agentThreadId: 't-1' });
    runtime.startRun();
    const queue = new EventQueue<REMAgentEvent>();
    const driving = driver.drive(runtime, { agentId: 'root' } as REMAgent, queue);
    queue.push({
      type: 'message-persist', messageId: 'm-1',
      message: { role: 'user', content: 'hi', timestamp: 1 } as never,
    });
    queue.push({ type: 'usage', usage: emptyUsage() });
    queue.push({ type: 'todo-updated', sessionId: 's-1', todos: [] });
    queue.push({ type: 'finish', output: { content: 'done', completed: true } });
    queue.finish();
    await driving;

    expect(persistAgentEvent).toHaveBeenCalledTimes(3);
    expect(published.map((event) => event.type)).toEqual([
      'usage-change', 'todo-updated', 'activity-change', 'chunk', 'session-end',
    ]);
    expect(runtime.status).toBe('idle');
  });

  it('持久化失败会中断 Agent、标记 Runtime error 并发布错误', async () => {
    const publish = vi.fn();
    const interrupt = vi.fn();
    const driver = new AgentRunDriver({
      sessionUsecase: {
        persistAgentEvent: vi.fn(async () => { throw new Error('disk failed'); }),
      } as unknown as SessionUsecase,
      publish,
    });
    const runtime = new SessionRuntime({ sessionId: 's-1', workspace: 'ws', agentThreadId: 't-1' });
    runtime.getOrCreateRootAgent(() => ({ interrupt } as unknown as REMAgent));
    runtime.startRun();
    const queue = new EventQueue<REMAgentEvent>();
    queue.push({
      type: 'message-persist', messageId: 'm-1',
      message: { role: 'user', content: 'hi', timestamp: 1 } as never,
    });
    queue.finish();
    await driver.drive(runtime, runtime.rootAgent!, queue);
    expect(interrupt).toHaveBeenCalledOnce();
    expect(runtime.status).toBe('error');
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session-error', error: 'disk failed',
    }));
  });
});
