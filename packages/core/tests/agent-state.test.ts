import { describe, it, expect, vi } from 'vitest';
import { AgentState } from '../src/agent-state.js';
import type { LanguageModelUsage } from '../src/types.js';
import type { TokenUsageDetail } from '../src/token-usage.js';

describe('AgentState usage-change', () => {
  it('publishes usage-change event', () => {
    const agentState = new AgentState();
    const listener = vi.fn();
    agentState.subscribe(listener);

    const usage: LanguageModelUsage = { inputTokens: 10, outputTokens: 20, totalTokens: 30 };
    agentState.publishUsageChange('default', 's1', usage);

    expect(listener).toHaveBeenCalledWith({
      workspace: 'default',
      sessionId: 's1',
      type: 'usage-change',
      usage,
    });
  });

  it('restores token usage from history', () => {
    const agentState = new AgentState();
    const history: TokenUsageDetail[] = [
      {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        runAt: new Date(),
        turns: [],
      },
      {
        inputTokens: 20,
        outputTokens: 10,
        totalTokens: 30,
        runAt: new Date(),
        turns: [],
      },
    ];
    agentState.restoreTokenUsage('s1', history);
    expect(agentState.get('s1')?.tokenUsage.totalTokens).toBe(45);
  });
});
