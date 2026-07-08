import { describe, it, expect, vi } from 'vitest';
import { AgentSessionManager } from '../src/agent-session.js';

describe('AgentSessionManager.listSessions tokenUsage', () => {
  it('includes tokenUsage from metadata', async () => {
    const sessionProvider = {
      list: async () => [
        { sessionId: 's1', title: 'Test', updatedAt: new Date(), messageCount: 2 },
      ],
      load: async (sessionId: string) => ({
        sessionId,
        metadata: {
          tokenUsageHistory: [
            { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
          ],
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
});
