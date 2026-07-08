import { describe, it, expect } from 'vitest';
import { AgentSessionManager } from '../src/agent-session.js';

describe('AgentSessionManager.listSessions tokenUsage', () => {
  it('preserves inputTokenDetails when computing total tokenUsage', async () => {
    const sessionProvider = {
      list: async () => [
        { sessionId: 's1', title: 'Test', updatedAt: new Date(), messageCount: 2 },
      ],
      load: async (sessionId: string) => ({
        sessionId,
        metadata: {
          messageTokenUsage: {
            msg1: {
              inputTokens: 100,
              outputTokens: 20,
              totalTokens: 120,
              inputTokenDetails: { noCacheTokens: 70, cacheReadTokens: 30 },
            },
            msg2: {
              inputTokens: 50,
              outputTokens: 10,
              totalTokens: 60,
              inputTokenDetails: { noCacheTokens: 40, cacheReadTokens: 10 },
            },
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
    expect(list[0].tokenUsage?.inputTokenDetails).toEqual({
      noCacheTokens: 110,
      cacheReadTokens: 40,
      cacheWriteTokens: 0,
    });
  });

  it('restores tokenUsage per message from metadata', async () => {
    const sessionProvider = {
      list: async () => [],
      load: async (sessionId: string) => ({
        sessionId,
        metadata: {
          messageTokenUsage: {
            msg1: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
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
});
