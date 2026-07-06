import { describe, it, expect } from 'vitest';
import { createProviderManager } from '../src/provider-manager.js';
import type { ToolProvider } from '../src/sdk/tool-provider.js';

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

  it('registers read_skill builtin tool after init', async () => {
    const pm = await createProviderManager();
    const toolProvider = pm.require<ToolProvider>('tool');
    const toolSet = toolProvider.getToolSet();

    expect(toolSet).toHaveProperty('read_skill');
    expect(toolSet.read_skill.description).toContain('SKILL.md');
    expect(toolSet.read_skill.parameters.properties).toHaveProperty('name');
  });
});
