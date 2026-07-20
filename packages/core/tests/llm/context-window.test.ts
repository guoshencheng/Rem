import { describe, it, expect } from 'vitest';
import { resolveContextWindow, computeWindowRatio } from '../../src/llm/context-window.js';
import type { Models, Usage } from '@earendil-works/pi-ai';

function fakeModels(entries: Record<string, number>): Models {
  return {
    getModel: (provider: string, id: string) => {
      const contextWindow = entries[`${provider}:${id}`];
      return contextWindow ? ({ contextWindow } as never) : undefined;
    },
  } as unknown as Models;
}

describe('resolveContextWindow', () => {
  it('returns pi-ai metadata value for known model', () => {
    const models = fakeModels({ 'openai:gpt-4o': 128_000 });
    expect(resolveContextWindow('openai', 'gpt-4o', {}, models)).toBe(128_000);
  });

  it('falls back to default for unknown model', () => {
    const models = fakeModels({});
    expect(resolveContextWindow('openai', 'unknown-model', {}, models)).toBe(1_000_000);
  });

  it('falls back to default without models', () => {
    expect(resolveContextWindow('openai', 'gpt-4o', {})).toBe(1_000_000);
  });

  it('respects env override over metadata', () => {
    const env = { MAX_CONTEXT_TOKENS: '64000' };
    const models = fakeModels({ 'openai:gpt-4o': 128_000 });
    expect(resolveContextWindow('openai', 'gpt-4o', env, models)).toBe(64_000);
  });

  it('respects per-model env override', () => {
    const env = { OPENAI_GPT_4O_MAX_CONTEXT_TOKENS: '64000' };
    const models = fakeModels({ 'openai:gpt-4o': 128_000 });
    expect(resolveContextWindow('openai', 'gpt-4o', env, models)).toBe(64_000);
  });

  it('ignores invalid env and falls back to metadata', () => {
    const env = { MAX_CONTEXT_TOKENS: 'not-a-number' };
    const models = fakeModels({ 'openai:gpt-4o': 128_000 });
    expect(resolveContextWindow('openai', 'gpt-4o', env, models)).toBe(128_000);
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
