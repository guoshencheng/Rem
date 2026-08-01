import { describe, expect, it } from 'vitest';
import { SessionUsecase } from '../src/session/session-usecase.js';
import { emptyUsage } from '../src/agent/token-usage/index.js';
import { createFakeAssembly } from './helpers/fake-di.js';

describe('SessionUsecase', () => {
  it('创建、缓存并按 workspace 列出 Session', async () => {
    const { di } = await createFakeAssembly();
    const usecase = new SessionUsecase(di);
    const info = await usecase.create('ws-a');
    const first = await usecase.requireSession(info.sessionId);
    const second = await usecase.requireSession(info.sessionId);
    expect(first).toBe(second);
    expect(first.metadata.workspace).toBe('ws-a');
    expect((await usecase.list('ws-a')).map((item) => item.sessionId)).toContain(info.sessionId);
    expect((await usecase.get(info.sessionId)).workspace).toBe('ws-a');
  });

  it('按 Agent 事件持久化消息、usage、标题与 finish', async () => {
    const { di } = await createFakeAssembly();
    const usecase = new SessionUsecase(di);
    const info = await usecase.create('ws');
    const usage = { ...emptyUsage(), input: 2, output: 3, totalTokens: 5 };
    await usecase.persistAgentEvent(info.sessionId, 't-1', {
      type: 'message-persist',
      messageId: 'm-1',
      message: { role: 'user', content: 'hello', timestamp: 1 } as never,
    });
    await usecase.persistAgentEvent(info.sessionId, 't-1', {
      type: 'usage', usage, assistantMessageId: 'm-2',
    });
    await usecase.persistAgentEvent(info.sessionId, 't-1', { type: 'session-title', title: 'Title' });
    await usecase.persistAgentEvent(info.sessionId, 't-1', {
      type: 'finish', output: { content: 'done', completed: true },
    });

    const session = await usecase.requireSession(info.sessionId);
    expect(session.conversation).toHaveLength(1);
    expect(session.metadata.title).toBe('Title');
    expect(session.metadata.messageTokenUsage).toMatchObject({ 'm-2': { totalTokens: 5 } });
    expect(session.metadata.tokenUsageHistory).toHaveLength(1);
    expect(session.currentTurn).toBe(1);
  });
});
