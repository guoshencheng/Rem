import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderManager } from '../src/provider-manager.js';

describe('ProviderManager', () => {
  beforeEach(() => {
    ProviderManager.resetInstance();
  });

  it('returns the same instance', async () => {
    const a = await ProviderManager.getInstance();
    const b = await ProviderManager.getInstance();
    expect(a).toBe(b);
  });

  it('provides required providers after init', async () => {
    const pm = await ProviderManager.getInstance();
    expect(pm.require('session')).toBeDefined();
    expect(pm.require('tool')).toBeDefined();
    expect(pm.require('memory')).toBeDefined();
    expect(pm.require('compressor')).toBeDefined();
    expect(pm.require('error')).toBeDefined();
  });

  it('exposes model and behavior config', async () => {
    const pm = await ProviderManager.getInstance();
    const behavior = pm.getBehaviorConfig();
    expect(behavior.name).toBe('Rem Agent');
    expect(behavior.maxTurns).toBe(60);

    const model = pm.getModelConfig();
    expect(model.provider).toBe('openai');
  });
});
