import { describe, it, expect } from 'vitest';
import { createProviderManager } from '../src/provider-manager.js';
import type { ToolProvider } from '../src/sdk/tool-provider.js';
import type { LoopStrategy } from '../src/sdk/loop-strategy.js';
import type { ReasonProvider } from '../src/sdk/reason-provider.js';
import type { ExecuteProvider } from '../src/sdk/execute-provider.js';
import type { ContextProvider } from '../src/sdk/context-provider.js';

describe('ProviderManager', () => {
  it('creates a new instance via factory function', async () => {
    const pm = await createProviderManager();
    expect(pm).toBeDefined();
  });

  it('provides required providers after init', async () => {
    const pm = await createProviderManager();
    expect(pm.require('session')).toBeDefined();
    expect(pm.require('tool')).toBeDefined();
    expect(pm.require('context')).toBeDefined();
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

  it('initializes without MCP by default', async () => {
    const pm = await createProviderManager();
    const toolProvider = pm.require<ToolProvider>('tool');
    expect(toolProvider.getToolSet()).toHaveProperty('read');
  });

  it('resolves loopStrategy, reason, execute, context providers', async () => {
    const pm = await createProviderManager();
    expect(pm.require<LoopStrategy>('loopStrategy')).toBeDefined();
    expect(pm.require<ReasonProvider>('reason')).toBeDefined();
    expect(pm.require<ExecuteProvider>('execute')).toBeDefined();
    expect(pm.require<ContextProvider>('context')).toBeDefined();
  });
});
