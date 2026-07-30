import { describe, expect, it } from 'vitest';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { BusEvent } from 'rem-agent-core';
import { AgentService } from '../src/agent-service.js';
import { REMSession } from '../src/rem-session.js';
import type { SessionService } from '../src/session-service.js';
import { createBridgeTestAgent } from './helpers/test-agent.js';

function doneAssistant(text: string): AssistantMessage {
  return {
    role: 'assistant', api: 'openai-completions', provider: 'mock', model: 'm',
    content: [{ type: 'text', text }],
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop', timestamp: Date.now(),
  } as AssistantMessage;
}

function todoWriteAssistant(): AssistantMessage {
  return {
    role: 'assistant', api: 'openai-completions', provider: 'mock', model: 'm',
    content: [{
      type: 'toolCall', id: 'tc-todo', name: 'todowrite',
      arguments: { todos: [{ content: 'task a', status: 'in_progress', priority: 'high' }] },
    }],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'toolUse', timestamp: Date.now(),
  } as unknown as AssistantMessage;
}

function setup() {
  const busEvents: BusEvent[] = [];
  const persisted: string[] = [];
  const sessionService = {
    handleAgentEvent: async (_sid: string, event: { type: string }) => { persisted.push(event.type); },
  } as unknown as SessionService;
  const remSession = new REMSession({ sessionId: 's-1', workspace: 'default', publish: (e) => busEvents.push(e) });
  const service = new AgentService({ sessionService, publish: (e) => busEvents.push(e) });
  return { busEvents, persisted, remSession, service };
}

describe('AgentService', () => {
  it('run：三路分发（状态/落盘/总线），root finish 结束 run', async () => {
    const { busEvents, persisted, remSession, service } = setup();
    remSession.startRun();
    const agent = await createBridgeTestAgent({
      agentId: 'root', sessionId: 's-1',
      script: [todoWriteAssistant(), doneAssistant('hi')],
    });

    service.run(remSession, agent, { content: 'hi' });
    await agent.output;
    // 等 drive 循环消费完
    await new Promise((r) => setTimeout(r, 10));

    expect(persisted).toContain('message-persist');
    expect(persisted).toContain('usage');
    expect(persisted).toContain('finish');
    // message-persist / usage / todo-updated 是内部事件，不作为 chunk 上总线
    const chunkTypes = busEvents.filter((e) => e.type === 'chunk').map((e) => e.chunk.type);
    expect(chunkTypes).not.toContain('message-persist');
    expect(chunkTypes).not.toContain('usage');
    expect(chunkTypes).not.toContain('todo-updated');
    // todo_write 的 meta 事件转成 todo-updated BusEvent
    const todoEvent = busEvents.find((e) => e.type === 'todo-updated');
    expect(todoEvent).toMatchObject({ sessionId: 's-1', todos: [{ content: 'task a' }] });
    expect(busEvents.some((e) => e.type === 'usage-change')).toBe(true);
    expect(busEvents.some((e) => e.type === 'session-end')).toBe(true);
    expect(remSession.status).toBe('idle');
    expect(remSession.tokenUsage.totalTokens).toBe(2);
  });

  it('listen：子 Agent 结束后发 child-agent-update', async () => {
    const { busEvents, remSession, service } = setup();
    remSession.startRun();
    const child = await createBridgeTestAgent({
      agentId: 'root.delegate-0', sessionId: 'child-s', summary: 'task x',
      script: [doneAssistant('child done')],
    });
    child.parentToolCallId = 'tc-1';

    // 模拟 delegate executor 已启动 child.run
    const drain = (async () => { for await (const _ of child.run({ content: 'x' })) {} })();
    service.listen(remSession, child);
    await drain;
    await new Promise((r) => setTimeout(r, 10));

    const update = busEvents.find((e) => e.type === 'child-agent-update');
    expect(update).toMatchObject({ childSessionId: 'child-s', toolCallId: 'tc-1', status: 'completed', summary: 'task x' });
    // 子 Agent finish 不结束 session run
    expect(remSession.status).toBe('running');
  });
});
