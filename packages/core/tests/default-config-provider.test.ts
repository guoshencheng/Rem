import { describe, expect, it } from 'vitest';
import { DefaultConfigProvider } from '../src/plugins/config/default/index.js';
import { createDefaultAgentPaths } from '../src/infrastructure/config/paths.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const paths = createDefaultAgentPaths({
  agentDir: '/tmp/rem-agent-test-nonexistent',
  homeAgentDir: '/tmp/rem-agent-test-nonexistent-home',
  env: {},
});

describe('DefaultConfigProvider', () => {
  it('throws when reading config before initialization', () => {
    const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv });
    expect(() => provider.getConfig()).toThrow('DefaultConfigProvider must be initialized');
  });

  it('resolves default model config from provider env fallbacks', () => {
    const provider = new DefaultConfigProvider({
      env: { OPENAI_MODEL: 'gpt-env' } as NodeJS.ProcessEnv,
      paths,
    });
    const model = provider.getModelConfig();
    expect(model.provider).toBe('openai');
    expect(model.model).toBe('gpt-env');
  });

  it('forWorkspace returns a cached scoped provider', () => {
    const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv, paths });
    const scoped = provider.forWorkspace('/tmp/rem-agent-test-nonexistent-ws');
    expect(scoped).toBe(provider.forWorkspace('/tmp/rem-agent-test-nonexistent-ws'));
  });

  it('resolves only omitted agent ids to the default agent', () => {
    const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv, paths });
    expect(provider.resolveAgent().id).toBe('default');
    expect(provider.resolveAgent('').id).toBe('default');
    expect(() => provider.resolveAgent('missing')).toThrow('Unknown agent: missing');
  });

  it('uses stable orchestration defaults', () => {
    const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv, paths });
    expect(provider.getOrchestrationConfig()).toEqual({
      maxAgentRuns: 20,
      maxMessages: 50,
      maxDepth: 8,
      timeoutMs: 300_000,
      maxTokens: 200_000,
      maxParallelAgents: 4,
    });
  });

  it('listTeams returns configured teams with organizer and members', () => {
    const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv, paths });
    expect(provider.listTeams()).toEqual([]);
  });

  it('strictly resolves explicit named models while omitted uses the active model', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rem-config-model-'));
    await writeFile(join(dir, 'config.json'), JSON.stringify({ activeModel: 'active', models: {
      active: { provider: 'openai', model: 'active-model' }, named: { provider: 'anthropic', model: 'named-model' },
    }, model: { provider: 'openai', model: 'fallback' } }));
    const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv,
      paths: createDefaultAgentPaths({ agentDir: dir, homeAgentDir: dir, env: {} }) });
    expect(provider.getModelConfig().model).toBe('active-model');
    expect(provider.getModelConfig('named')).toMatchObject({ provider: 'anthropic', model: 'named-model' });
    expect(() => provider.getModelConfig('missing')).toThrow('Unknown model: missing');
    expect(() => provider.getModelConfig('__proto__')).toThrow('Unknown model: __proto__');
    expect(() => provider.getModelConfig('constructor')).toThrow('Unknown model: constructor');
  });
});
