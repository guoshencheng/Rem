import { describe, it, expect } from 'vitest';
import { emptyUsage, addUsage, computeCacheStats, computeCacheRatio, formatUsage } from '../src/token-usage.js';
import type { Usage } from '@earendil-works/pi-ai';

const baseUsage = (overrides?: Partial<Usage>): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  ...overrides,
});

describe('emptyUsage', () => {
  it('returns zeroed usage', () => {
    const result = emptyUsage();
    expect(result.input).toBe(0);
    expect(result.output).toBe(0);
    expect(result.cacheRead).toBe(0);
    expect(result.cacheWrite).toBe(0);
    expect(result.totalTokens).toBe(0);
    expect(result.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
  });
});

describe('addUsage', () => {
  it('adds two usages', () => {
    const a = baseUsage({
      input: 10,
      output: 20,
      cacheRead: 3,
      cacheWrite: 2,
      totalTokens: 30,
      cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
    });
    const b = baseUsage({
      input: 5,
      output: 10,
      cacheRead: 1,
      cacheWrite: 2,
      totalTokens: 15,
      cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1, total: 4 },
    });
    const result = addUsage(a, b);
    expect(result.input).toBe(15);
    expect(result.output).toBe(30);
    expect(result.cacheRead).toBe(4);
    expect(result.cacheWrite).toBe(4);
    expect(result.totalTokens).toBe(45);
    expect(result.cost).toEqual({ input: 2, output: 3, cacheRead: 4, cacheWrite: 5, total: 14 });
  });

  it('handles undefined reasoning', () => {
    const a: Usage = { ...baseUsage({ input: 10, output: 20, totalTokens: 30 }) };
    const b: Usage = { ...baseUsage({ input: 5, output: 10, totalTokens: 15 }) };
    const result = addUsage(a, b);
    expect(result.input).toBe(15);
    expect(result.output).toBe(30);
    expect(result.totalTokens).toBe(45);
  });
});

describe('computeCacheStats', () => {
  it('extracts cache numbers', () => {
    const usage = baseUsage({ input: 100, output: 50, cacheRead: 30, cacheWrite: 10, totalTokens: 150 });
    expect(computeCacheStats(usage)).toEqual({ cacheRead: 30, cacheWrite: 10, noCache: 60 });
  });

  it('defaults missing cache to zero', () => {
    const usage = baseUsage({ input: 100, output: 50, totalTokens: 150 });
    expect(computeCacheStats(usage)).toEqual({ cacheRead: 0, cacheWrite: 0, noCache: 100 });
  });
});

describe('computeCacheRatio', () => {
  it('returns cache tokens divided by total tokens', () => {
    const usage = baseUsage({ input: 100, output: 100, cacheRead: 30, cacheWrite: 10, totalTokens: 200 });
    expect(computeCacheRatio(usage)).toBe(0.2);
  });

  it('defaults missing cache to zero', () => {
    const usage = baseUsage({ input: 100, output: 50, totalTokens: 150 });
    expect(computeCacheRatio(usage)).toBe(0);
  });

  it('returns zero when total tokens is zero', () => {
    const usage = baseUsage({ cacheRead: 5 });
    expect(computeCacheRatio(usage)).toBe(0);
  });
});

describe('formatUsage', () => {
  it('formats total tokens', () => {
    expect(formatUsage(baseUsage({ input: 100, output: 50, totalTokens: 150 }))).toContain('150');
  });
});
