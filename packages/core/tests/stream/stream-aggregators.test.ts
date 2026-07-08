import { describe, it, expect } from 'vitest';
import { aggregateUsage } from '../../src/stream/stream-aggregators.js';
import type { AgentStreamChunk } from '../../src/types.js';

describe('aggregateUsage', () => {
  it('sums usage chunks', () => {
    const chunks: AgentStreamChunk[] = [
      { type: 'usage', inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      { type: 'usage', inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    ];
    const result = aggregateUsage(chunks);
    expect(result.inputTokens).toBe(120);
    expect(result.outputTokens).toBe(60);
    expect(result.totalTokens).toBe(180);
  });

  it('returns zero for no usage chunks', () => {
    const result = aggregateUsage([]);
    expect(result.totalTokens).toBe(0);
  });
});
