import { describe, it, expect } from 'vitest';
import { assembleAgentContext } from '../src/agent-context-assembler.js';
import type { AssembleAgentContextOptions } from '../src/agent-context-assembler.js';
import type { StorageProvider } from '../src/sdk/storage-provider.js';

function stubStorageProvider(): StorageProvider {
  return {
    init: async () => {},
    close: async () => {},
    sessionStore: {
      create: async () => { throw new Error('not used'); },
      load: async () => null,
      save: async () => {},
      delete: async () => {},
      listByWorkspace: async () => [],
      listAll: async () => [],
    },
    ruleStore: {
      loadAll: async () => [],
      loadBySource: async () => [],
      saveApproved: async () => {},
    },
    todoStore: {
      getBySession: async () => [],
      replaceForSession: async (_s: string, todos: never[]) => todos,
    },
    archiveStore: {
      save: async () => {},
      get: async () => null,
      listBySession: async () => [],
      getLatest: async () => null,
    },
    workspaceStore: {
      list: async () => [],
      add: async (path: string) => ({ path, createdAt: Date.now() }),
      remove: async () => {},
    },
  };
}

function stubOptions(): AssembleAgentContextOptions {
  return {
    configProvider: {
      getConfig: () => ({ profile: 'coding' }),
      getModelConfig: () => ({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test' }),
      getToolConfig: () => ({}),
      getBehaviorConfig: () => ({ name: 'test', maxTurns: 1 }),
      getCompressionConfig: () => ({ enabled: false, thresholdRatio: 0.8, protectHead: 4, protectTail: 8 }),
      getMcpConfig: () => ({}),
      resolveAgent: () => ({ id: 'default', name: 'test', corePrompt: '' }),
    } as never,
    sessionProvider: {
      create: async () => { throw new Error('not used'); },
      load: async () => null,
      save: async () => {},
      delete: async () => {},
      list: async () => [],
      addMessage: () => { throw new Error('not used'); },
      appendContent: () => {},
    },
    storageProvider: stubStorageProvider(),
    systemPromptAssembler: { assemble: async () => 'system' },
    models: { getModel: () => undefined, stream: () => { throw new Error('not used'); }, complete: () => { throw new Error('not used'); } } as never,
    runtime: { platform: 'test', env: {} },
    mcpManager: { connectAll: async () => [], closeAll: async () => {} } as never,
  };
}

describe('assembleAgentContext', () => {
  it('module source has no node builtin imports', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../src/agent-context-assembler.ts', import.meta.url), 'utf-8');
    expect(src).not.toMatch(/^import .* from '(node:)?(fs|path|os|crypto|url|child_process)/m);
  });

  it('assembles AgentDI and AgentRuntimeConfig with pure defaults', async () => {
    const { di, runtimeConfig } = await assembleAgentContext(stubOptions());
    expect(di.configProvider).toBeDefined();
    expect(di.sessionProvider).toBeDefined();
    expect(di.toolProvider.getToolSet()).toEqual([]);
    expect(await di.skillProvider.loadSkills()).toEqual([]);
    expect(di.compressor).toBeDefined();
    expect(di.ruleEngine).toBeDefined();
    expect(di.storage).toBeDefined();
    expect(di.permissionEvaluator).toBeDefined();
    expect(runtimeConfig.securityMode).toBe('interactive');
    expect(runtimeConfig.runtime.platform).toBe('test');
    await expect(di.fileMutationQueue.withQueue('/x', async () => 42)).resolves.toBe(42);
  });
});
