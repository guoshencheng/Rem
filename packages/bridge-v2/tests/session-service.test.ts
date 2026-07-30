import { describe, expect, it } from 'vitest';
import type { AgentDI, Session, SessionSummary } from 'rem-agent-core';
import type { Message, Usage } from '@earendil-works/pi-ai';
import { SessionService } from '../src/session-service.js';

const usage: Usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function makeSession(sessionId: string): Session {
  return { sessionId, conversation: [], currentTurn: 0, metadata: { schemaVersion: 2 }, createdAt: new Date(), updatedAt: new Date() };
}

/** 最小内存 SessionProvider + storage fake */
function createFakeDI() {
  const sessions = new Map<string, Session>();
  const appended: Array<{ sessionId: string; message: Message; messageId: string }> = [];
  const di = {
    sessionProvider: {
      create: async () => { const s = makeSession(`gen-${sessions.size + 1}`); sessions.set(s.sessionId, s); return s; },
      load: async (id: string) => sessions.get(id) ?? null,
      save: async (s: Session) => { sessions.set(s.sessionId, s); },
      delete: async (id: string) => { sessions.delete(id); },
      list: async () => [] as SessionSummary[],
      appendMessage: async (s: Session, message: Message, messageId: string) => {
        s.conversation.push(message);
        appended.push({ sessionId: s.sessionId, message, messageId });
      },
    },
    storage: {
      sessionStore: { listByWorkspace: async () => [] as SessionSummary[] },
      archiveStore: { getLatest: async () => null },
    },
  } as unknown as AgentDI;
  return { di, sessions, appended };
}

describe('SessionService', () => {
  it('loadOrCreate：不存在则创建并写 metadata.workspace', async () => {
    const { di } = createFakeDI();
    const svc = new SessionService(di);
    const created = await svc.loadOrCreate('s-new', 'ws-a');
    expect(created.metadata.workspace).toBe('ws-a');
    const loaded = await svc.loadOrCreate('s-new', 'ws-a');
    expect(loaded).toBe(created);
  });

  it('handleAgentEvent message-persist → appendMessage 落盘', async () => {
    const { di, appended } = createFakeDI();
    const svc = new SessionService(di);
    await svc.loadOrCreate('s-1', 'default');
    const message = { role: 'user', content: 'hi', timestamp: Date.now() } as Message;
    await svc.handleAgentEvent('s-1', { type: 'message-persist', message, messageId: 'm-1' });
    expect(appended).toEqual([{ sessionId: 's-1', message, messageId: 'm-1' }]);
  });

  it('handleAgentEvent usage → tokenUsageHistory + messageTokenUsage', async () => {
    const { di, sessions } = createFakeDI();
    const svc = new SessionService(di);
    await svc.loadOrCreate('s-1', 'default');
    await svc.handleAgentEvent('s-1', { type: 'usage', usage, assistantMessageId: 'm-1' });
    const s = sessions.get('s-1')!;
    expect((s.metadata.tokenUsageHistory as unknown[]).length).toBe(1);
    expect((s.metadata.messageTokenUsage as Record<string, Usage>)['m-1'].totalTokens).toBe(2);
  });

  it('handleAgentEvent session-title / finish → title + currentTurn', async () => {
    const { di, sessions } = createFakeDI();
    const svc = new SessionService(di);
    await svc.loadOrCreate('s-1', 'default');
    await svc.handleAgentEvent('s-1', { type: 'session-title', title: 'T' });
    await svc.handleAgentEvent('s-1', { type: 'finish', output: { content: '', completed: true } });
    const s = sessions.get('s-1')!;
    expect(s.metadata.title).toBe('T');
    expect(s.currentTurn).toBe(1);
  });

  it('createChildSession 写 parent 元数据', async () => {
    const { di } = createFakeDI();
    const svc = new SessionService(di);
    const child = await svc.createChildSession({ parentSessionId: 'p', parentToolCallId: 'tc', workspace: 'w', title: 't' });
    expect(child.metadata.parentSessionId).toBe('p');
    expect(child.metadata.parentToolCallId).toBe('tc');
    expect(child.metadata.workspace).toBe('w');
  });

  it('落盘失败不抛出（best-effort，记日志）', async () => {
    const { di } = createFakeDI();
    di.sessionProvider.appendMessage = async () => { throw new Error('db down'); };
    const svc = new SessionService(di);
    await svc.loadOrCreate('s-1', 'default');
    await expect(
      svc.handleAgentEvent('s-1', { type: 'message-persist', message: {} as Message, messageId: 'm' }),
    ).resolves.toBeUndefined();
  });
});
