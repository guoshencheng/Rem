import { describe, it, expect } from 'vitest';
import type { SessionSummary, BusEvent } from '../src/types.js';
import type { LanguageModelUsage } from 'rem-agent-core';

describe('Bridge types', () => {
  it('SessionSummary can carry tokenUsage', () => {
    const usage: LanguageModelUsage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
    const summary: SessionSummary = {
      sessionId: 's1',
      updatedAt: Date.now(),
      messageCount: 2,
      tokenUsage: usage,
    };
    expect(summary.tokenUsage?.totalTokens).toBe(15);
  });

  it('BusEvent accepts usage-change', () => {
    const usage: LanguageModelUsage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
    const event: BusEvent = { workspace: 'default', sessionId: 's1', type: 'usage-change', usage };
    expect(event.type).toBe('usage-change');
  });
});
