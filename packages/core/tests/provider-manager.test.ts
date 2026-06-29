import { describe, it, expect } from 'vitest';
import { createProviderManager } from '../src/provider-manager.js';

describe('ProviderManager', () => {
  it('creates a new instance via factory function', async () => {
    const pm = await createProviderManager();
    expect(pm).toBeDefined();
  });

  it('provides required providers after init', async () => {
    const pm = await createProviderManager();
    expect(pm.require('session')).toBeDefined();
    expect(pm.require('tool')).toBeDefined();
    expect(pm.require('memory')).toBeDefined();
    expect(pm.require('compressor')).toBeDefined();
    expect(pm.require('error')).toBeDefined();
  });

  it('exposes model and behavior config', async () => {
    const pm = await createProviderManager();
    const behavior = pm.getBehaviorConfig();
    expect(behavior.name).toBe('Rem Agent');
    expect(behavior.maxTurns).toBe(60);

    const model = pm.getModelConfig();
    expect(model.provider).toBe('openai');
  });
});
