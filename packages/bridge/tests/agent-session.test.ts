import { describe, it, expect } from 'vitest';
import { AgentSessionManager } from 'rem-agent-core';
import type { Usage } from 'rem-agent-core';

const baseUsage = (overrides?: Partial<Usage>): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  ...overrides,
});

describe('AgentSessionManager.listSessions tokenUsage', () => {
  it('computes total tokenUsage from messageTokenUsage', async () => {
    const sessionProvider = {
      list: async () => [
        { sessionId: 's1', title: 'Test', updatedAt: new Date(), messageCount: 2 },
      ],
      load: async (sessionId: string) => ({
        sessionId,
        metadata: {
          messageTokenUsage: {
            msg1: baseUsage({ input: 100, output: 20, cacheRead: 30, totalTokens: 120 }),
            msg2: baseUsage({ input: 50, output: 10, cacheRead: 10, totalTokens: 60 }),
          },
        },
        conversation: [],
        currentTurn: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    } as any;

    const manager = new AgentSessionManager(sessionProvider, {} as any);
    const list = await manager.listSessions('default');

    expect(list).toHaveLength(1);
    expect(list[0].tokenUsage?.totalTokens).toBe(180);
    expect(list[0].tokenUsage?.input).toBe(150);
    expect(list[0].tokenUsage?.cacheRead).toBe(40);
  });

  it('restores tokenUsage per message from metadata', async () => {
    const sessionProvider = {
      list: async () => [],
      load: async (sessionId: string) => ({
        sessionId,
        metadata: {
          messageTokenUsage: {
            msg1: baseUsage({ input: 10, output: 5, totalTokens: 15 }),
          },
        },
        conversation: [
          { id: 'msg1', role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
        ],
        currentTurn: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    } as any;

    const manager = new AgentSessionManager(sessionProvider, {} as any);
    const messages = await manager.getMessages('s1');

    expect(messages).toHaveLength(1);
    expect(messages[0].tokenUsage?.totalTokens).toBe(15);
  });

  it('passes through user image blocks instead of collapsing to [image]', async () => {
    const sessionProvider = {
      list: async () => [],
      load: async (sessionId: string) => ({
        sessionId,
        metadata: {},
        conversation: [
          {
            id: 'u1',
            role: 'user',
            content: [
              { type: 'text', text: 'look at this' },
              { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
            ],
            timestamp: Date.now(),
          },
        ],
        currentTurn: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    } as any;

    const manager = new AgentSessionManager(sessionProvider, {} as any);
    const messages = await manager.getMessages('s1');

    expect(messages).toHaveLength(1);
    expect(messages[0].parts).toContainEqual({ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' });
    expect(messages[0].parts).toContainEqual({ type: 'text', text: 'look at this' });
  });
});

describe('AgentSessionManager.searchSessions', () => {
  const sessionProvider = {
    list: async () => [
      { sessionId: 's1', title: 'hello world', updatedAt: new Date(1000), messageCount: 1 },
      { sessionId: 's2', title: 'other chat', updatedAt: new Date(2000), messageCount: 1 },
    ],
    load: async (sessionId: string) => ({
      sessionId,
      metadata: {},
      conversation: [],
      currentTurn: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  } as any;

  it('filters by title case-insensitively', async () => {
    const manager = new AgentSessionManager(sessionProvider, { get: () => undefined } as any);
    const results = await manager.searchSessions('default', 'HELLO');
    expect(results).toHaveLength(1);
    expect(results[0].sessionId).toBe('s1');
  });

  it('returns all for empty-ish match', async () => {
    const manager = new AgentSessionManager(sessionProvider, { get: () => undefined } as any);
    const results = await manager.searchSessions('default', 'a');
    expect(results.length).toBeGreaterThan(0);
  });
});
