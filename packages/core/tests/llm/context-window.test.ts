import { describe, it, expect } from 'vitest';
import { resolveContextWindow, computeWindowRatio } from '../../src/llm/context-window.js';
import type { Usage } from '@earendil-works/pi-ai';

describe('resolveContextWindow', () => {
  it('returns built-in value for gpt-4o', () => {
    expect(resolveContextWindow('openai', 'gpt-4o')).toBe(128_000);
  });

  it('returns built-in value for claude-sonnet-4', () => {
    expect(resolveContextWindow('anthropic', 'claude-sonnet-4-20250514')).toBe(200_000);
  });

  it('falls back for unknown model', () => {
    expect(resolveContextWindow('openai', 'unknown-model')).toBe(1_000_000);
  });

  it('respects env override', () => {
    const env = { MAX_CONTEXT_TOKENS: '64000' };
    expect(resolveContextWindow('openai', 'gpt-4o', env)).toBe(64_000);
  });

  it('ignores invalid env and falls back to built-in', () => {
    const env = { MAX_CONTEXT_TOKENS: 'not-a-number' };
    expect(resolveContextWindow('openai', 'gpt-4o', env)).toBe(128_000);
  });
});

describe('computeWindowRatio', () => {
  it('computes ratio', () => {
    const usage: Usage = { input: 10_000, output: 5_000, cacheRead: 0, cacheWrite: 0, totalTokens: 15_000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    expect(computeWindowRatio(usage, 100_000)).toBeCloseTo(0.15);
  });

  it('caps at 1', () => {
    const usage: Usage = { input: 200_000, output: 50_000, cacheRead: 0, cacheWrite: 0, totalTokens: 250_000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    expect(computeWindowRatio(usage, 100_000)).toBe(1);
  });
});
