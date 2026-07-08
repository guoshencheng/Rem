import { describe, it, expect } from 'vitest';
import { emptyUsage, addUsage, computeCacheStats, formatUsage } from '../src/token-usage.js';
import type { LanguageModelUsage } from '../src/types.js';

describe('emptyUsage', () => {
  it('returns zeroed usage', () => {
    const result = emptyUsage();
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.totalTokens).toBe(0);
    expect(result.inputTokenDetails).toEqual({ noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(result.outputTokenDetails).toEqual({ textTokens: 0, reasoningTokens: 0 });
  });
});

describe('addUsage', () => {
  it('adds two usages', () => {
    const a: LanguageModelUsage = {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      inputTokenDetails: { noCacheTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 2 },
      outputTokenDetails: { textTokens: 15, reasoningTokens: 5 },
    };
    const b: LanguageModelUsage = {
      inputTokens: 5,
      outputTokens: 10,
      totalTokens: 15,
      inputTokenDetails: { noCacheTokens: 2, cacheReadTokens: 1, cacheWriteTokens: 2 },
      outputTokenDetails: { textTokens: 8, reasoningTokens: 2 },
    };
    const result = addUsage(a, b);
    expect(result.inputTokens).toBe(15);
    expect(result.outputTokens).toBe(30);
    expect(result.totalTokens).toBe(45);
    expect(result.inputTokenDetails).toEqual({ noCacheTokens: 7, cacheReadTokens: 4, cacheWriteTokens: 4 });
    expect(result.outputTokenDetails).toEqual({ textTokens: 23, reasoningTokens: 7 });
  });

  it('handles undefined details', () => {
    const a: LanguageModelUsage = { inputTokens: 10, outputTokens: 20, totalTokens: 30 };
    const b: LanguageModelUsage = { inputTokens: 5, outputTokens: 10, totalTokens: 15 };
    const result = addUsage(a, b);
    expect(result.inputTokens).toBe(15);
    expect(result.outputTokens).toBe(30);
    expect(result.totalTokens).toBe(45);
  });
});

describe('computeCacheStats', () => {
  it('extracts cache numbers', () => {
    const usage: LanguageModelUsage = {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      inputTokenDetails: { noCacheTokens: 60, cacheReadTokens: 30, cacheWriteTokens: 10 },
    };
    expect(computeCacheStats(usage)).toEqual({ cacheRead: 30, cacheWrite: 10, noCache: 60 });
  });

  it('defaults missing details to zero', () => {
    const usage: LanguageModelUsage = { inputTokens: 100, outputTokens: 50, totalTokens: 150 };
    expect(computeCacheStats(usage)).toEqual({ cacheRead: 0, cacheWrite: 0, noCache: 0 });
  });
});

describe('formatUsage', () => {
  it('formats total tokens', () => {
    expect(formatUsage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 })).toContain('150');
  });
});
