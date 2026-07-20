import { describe, it, expect, vi } from 'vitest';
import { AgentState } from '../src/agent-state.js';
import type { Usage } from '@earendil-works/pi-ai';
import type { TokenUsageDetail } from '../src/token-usage.js';

const baseUsage = (totalTokens: number, input = 0, output = 0): Usage => ({
  input,
  output,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

describe('AgentState usage-change', () => {
  it('publishes usage-change event', () => {
    const agentState = new AgentState();
    const listener = vi.fn();
    agentState.subscribe(listener);

    const usage = baseUsage(30, 10, 20);
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
      { ...baseUsage(15, 10, 5), runAt: new Date(), turns: [] },
      { ...baseUsage(30, 20, 10), runAt: new Date(), turns: [] },
    ];
    agentState.restoreTokenUsage('s1', history);
    expect(agentState.get('s1')?.tokenUsage.totalTokens).toBe(45);
  });
});
