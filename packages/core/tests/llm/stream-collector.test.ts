import { describe, it, expect } from 'vitest';
import { StreamCollector } from '../../src/llm/stream-collector.js';

describe('StreamCollector', () => {
  it('preserves input and output token details from usage chunks', () => {
    const collector = new StreamCollector();
    collector.feed({ type: 'text', text: 'hello' });
    collector.feed({
      type: 'usage',
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      inputTokenDetails: { noCacheTokens: 70, cacheReadTokens: 30 },
      outputTokenDetails: { textTokens: 15, reasoningTokens: 5 },
    });

    const result = collector.result();
    expect(result.usage.inputTokenDetails).toEqual({ noCacheTokens: 70, cacheReadTokens: 30 });
    expect(result.usage.outputTokenDetails).toEqual({ textTokens: 15, reasoningTokens: 5 });
  });

  it('overwrites details when multiple usage chunks are fed', () => {
    const collector = new StreamCollector();
    collector.feed({
      type: 'usage',
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      inputTokenDetails: { noCacheTokens: 10, cacheReadTokens: 0 },
    });
    collector.feed({
      type: 'usage',
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
      inputTokenDetails: { noCacheTokens: 10, cacheReadTokens: 10 },
    });

    const result = collector.result();
    expect(result.usage.inputTokens).toBe(20);
    expect(result.usage.inputTokenDetails).toEqual({ noCacheTokens: 10, cacheReadTokens: 10 });
  });
});
