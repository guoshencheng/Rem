import { describe, it, expect, vi } from 'vitest';
import { DefaultProviderLoader } from '../src/registry/provider-loader.js';
import type {
  ProviderLoaderContext,
  BuiltinProviderResolver,
} from '../src/sdk/provider-loader.js';
import type { MemoryProvider } from '../src/sdk/memory-provider.js';
import { AgentState } from '../src/state.js';

const baseCtx: ProviderLoaderContext = {
  kind: 'memory',
  agentName: 'TestAgent',
  workspaceRoot: '/tmp',
  readOnly: false,
  skillsDir: '/tmp/skills',
  sessionsDir: '/tmp/sessions',
  maxTurns: 10,
};

const builtinResolver: BuiltinProviderResolver = (kind, name) => {
  return new URL(`../src/plugins/${kind}/${name}/index.js`, import.meta.url).href;
};

describe('DefaultProviderLoader', () => {
  it('returns an existing instance as-is', async () => {
    const loader = new DefaultProviderLoader();
    const instance: MemoryProvider = {
      buildContext: vi.fn(),
    };

    const result = await loader.load(instance, baseCtx);
    expect(result).toBe(instance);
  });

  it('loads a builtin provider by name', async () => {
    const loader = new DefaultProviderLoader(builtinResolver);
    const provider = await loader.load('simple', baseCtx);

    expect(provider).toBeDefined();
    const ctx = await provider.buildContext(new AgentState());
    expect(ctx.systemPrompt).toBe('You are TestAgent.');
  });

  it('loads a provider from an absolute path', async () => {
    const loader = new DefaultProviderLoader();
    const path = new URL('./fixtures/custom-memory-provider.js', import.meta.url).href;
    const provider = await loader.load(path, { ...baseCtx, kind: 'memory' });

    expect(provider).toBeDefined();
    const ctx = await provider.buildContext(new AgentState());
    expect(ctx.systemPrompt).toBe('TestAgent: 0 messages');
  });

  it('loads a provider from a ProviderDescriptor with explicit options', async () => {
    const loader = new DefaultProviderLoader();
    const path = new URL('./fixtures/custom-memory-provider.js', import.meta.url).href;
    const provider = await loader.load(
      { module: path, options: { prefix: 'CustomPrefix' } },
      { ...baseCtx, kind: 'memory' },
    );

    const ctx = await provider.buildContext(new AgentState());
    expect(ctx.systemPrompt).toBe('CustomPrefix: 0 messages');
  });

  it('throws for an unknown builtin name', async () => {
    const loader = new DefaultProviderLoader();
    await expect(loader.load('unknown', baseCtx)).rejects.toThrow('Unknown provider');
  });

  it('uses getDefaultOptions when options are omitted', async () => {
    const loader = new DefaultProviderLoader(builtinResolver);
    const provider = await loader.load(
      { module: 'simple' },
      { ...baseCtx, agentName: 'DefaultAgent' },
    );

    const ctx = await provider.buildContext(new AgentState());
    expect(ctx.systemPrompt).toBe('You are DefaultAgent.');
  });
});
