import { describe, it, expect } from 'vitest';
import type { AgentStreamChunk } from '../src/types.js';

describe('AgentStreamChunk usage', () => {
  it('accepts usage chunk', () => {
    const chunk: AgentStreamChunk = {
      type: 'usage',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      inputTokenDetails: { cacheReadTokens: 30, cacheWriteTokens: 10, noCacheTokens: 60 },
      outputTokenDetails: { textTokens: 40, reasoningTokens: 10 },
    };
    expect(chunk.type).toBe('usage');
    expect(chunk.totalTokens).toBe(150);
  });
});
