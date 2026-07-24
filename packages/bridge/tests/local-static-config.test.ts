import { describe, it, expect } from 'vitest';
import { StaticConfigProvider } from '../src/local/static-config-provider.js';
import { NoopCompressor } from '../src/local/noop-compressor.js';

describe('StaticConfigProvider', () => {
  it('resolves model config with apiKey', () => {
    const cp = new StaticConfigProvider({ provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: 'sk-x' });
    const mc = cp.getModelConfig();
    expect(mc.provider).toBe('anthropic');
    expect(mc.apiKey).toBe('sk-x');
    expect(cp.getMcpConfig()).toEqual({});
    expect(cp.getBehaviorConfig().maxTurns).toBeGreaterThan(0);
    expect(cp.resolveAgent().name).toBeTruthy();
  });
});

describe('NoopCompressor', () => {
  it('never compresses', async () => {
    const c = new NoopCompressor();
    expect(c.shouldCompress({} as never)).toBe(false);
    expect(await c.compress([1, 2] as never)).toEqual([1, 2]);
  });
});
