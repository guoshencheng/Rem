import { describe, it, expect } from 'vitest';
import type { SessionSummary, BusEvent } from '../src/types.js';
import type { Usage } from 'rem-agent-core';

const baseUsage: Usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

describe('Bridge types', () => {
  it('SessionSummary can carry tokenUsage', () => {
    const usage: Usage = { ...baseUsage };
    const summary: SessionSummary = {
      sessionId: 's1',
      updatedAt: Date.now(),
      messageCount: 2,
      tokenUsage: usage,
    };
    expect(summary.tokenUsage?.totalTokens).toBe(15);
  });

  it('BusEvent accepts usage-change', () => {
    const usage: Usage = { ...baseUsage };
    const event: BusEvent = { workspace: 'default', sessionId: 's1', type: 'usage-change', usage };
    expect(event.type).toBe('usage-change');
  });
});
