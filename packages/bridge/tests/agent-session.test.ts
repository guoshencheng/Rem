import { describe, it, expect } from 'vitest';
import { AgentSessionManager } from '../src/agent-session.js';

describe('AgentSessionManager.listSessions tokenUsage', () => {
  it('includes tokenUsage from messageTokenUsage metadata', async () => {
    const sessionProvider = {
      list: async () => [
        { sessionId: 's1', title: 'Test', updatedAt: new Date(), messageCount: 2 },
      ],
      load: async (sessionId: string) => ({
        sessionId,
        metadata: {
          messageTokenUsage: {
            msg1: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            msg2: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
          },
        },
        conversation: [],
        currentTurn: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    } as any;

    const manager = new AgentSessionManager(sessionProvider, {} as any);
    const list = await manager.listSessions();

    expect(list).toHaveLength(1);
    expect(list[0].tokenUsage?.totalTokens).toBe(45);
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
