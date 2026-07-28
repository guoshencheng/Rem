import { describe, it, expect } from 'vitest';
import type { AgentDI } from '../src/agent-di.js';
import type { AgentRuntimeConfig } from '../src/agent-runtime-config.js';
import { createFileMutationQueue } from '../src/plugins/tool/file-system/shared/file-mutation-queue.js';
import { AgentState } from '../src/agent-state.js';

const createMockContextBase = (workspaceRoot = '/tmp') => ({
  configProvider: {
    getBehaviorConfig: () => ({ name: 'test', maxTurns: 1, workspaceRoot, readOnly: false, autoApproveDangerous: false }),
    getModelConfig: () => ({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test', baseURL: undefined }),
    getToolConfig: () => ({}),
    getMcpConfig: () => ({}),
    resolveAgent: () => ({ id: 'default', name: 'test', corePrompt: 'Default prompt.' }),
  },
  sessionProvider: { load: async () => null, save: async () => {}, addMessage: () => ({} as any), appendContent: () => {} },
  toolProvider: { getToolSet: () => [], register: () => {} },
  contextProvider: { build: async () => ({ system: 'You are test.', messages: [] }) },
  skillProvider: { loadSkills: async () => [], formatCatalog: () => '' },
  budgetPolicy: { checkTurn: () => true, checkTimeout: () => true, shouldCircuitBreak: () => false, getStatus: () => ({ turnsRemaining: 1, consecutiveErrors: 0, atRisk: false }) },
  compressor: { shouldCompress: () => false, compress: async (msgs: unknown[]) => msgs },
  errorHandler: { classify: () => 'unknown', isRetryable: () => false },
  titleProvider: { generateTitle: async () => undefined },
  mcpManager: { connectAll: async () => [], closeAll: async () => {} },
  fileMutationQueue: createFileMutationQueue(),
  systemPromptAssembler: { assemble: async () => 'mock system prompt' },
  toolComposer: {
    compose: () => ({
      getToolSet: () => [],
      execute: async () => [],
      register: () => {},
      isDangerous: () => false,
    }),
  },
  storage: {
    todoStore: { getBySession: async () => [], replaceForSession: async (_s: string, todos: unknown[]) => todos },
    archiveStore: { save: async () => {}, get: async () => null, listBySession: async () => [], getLatest: async () => null },
    ruleStore: { loadAll: async () => [], loadBySource: async () => [], saveApproved: async () => {} },
  },
});

const stubRuntimeConfig = (): AgentRuntimeConfig => ({
  securityMode: 'interactive',
  runtime: { platform: 'test', env: {} },
});

describe('runAgent workspaceRoot', () => {
  it('uses explicit workspaceRoot over behavior.workspaceRoot', async () => {
    let capturedWorkspaceRoot: string | undefined;
    const mockDI = {
      ...createMockContextBase('/default-root'),
      mcpProviders: [],
      toolComposer: {
        compose: () => ({
          getToolSet: () => [],
          execute: async () => [],
          register: () => {},
          isDangerous: () => false,
        }),
      },
      loopStrategy: {
        run: async (ctx: any) => {
          capturedWorkspaceRoot = ctx.workspaceRoot;
          return { content: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        },
    },
  } as unknown as AgentDI;

    const { runAgent } = await import('../src/run-agent.js');
    const result = runAgent({
      input: { content: 'hi', timestamp: new Date() },
      sessionId: 's1',
      di: mockDI, runtimeConfig: stubRuntimeConfig(),
      agentState: new AgentState(),
      workspace: '/workspace-a',
      workspaceRoot: '/custom-root',
    });

    for await (const _chunk of result.stream.fullStream) {
      // drain
    }
    await result.output;

    expect(capturedWorkspaceRoot).toBe('/custom-root');
  });

  it('defaults workspaceRoot to workspace when workspaceRoot is omitted', async () => {
    let capturedWorkspaceRoot: string | undefined;
    const mockDI = {
      ...createMockContextBase('/default-root'),
      mcpProviders: [],
      toolComposer: {
        compose: () => ({
          getToolSet: () => [],
          execute: async () => [],
          register: () => {},
          isDangerous: () => false,
        }),
      },
      loopStrategy: {
        run: async (ctx: any) => {
          capturedWorkspaceRoot = ctx.workspaceRoot;
          return { content: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        },
    },
  } as unknown as AgentDI;

    const { runAgent } = await import('../src/run-agent.js');
    const result = runAgent({
      input: { content: 'hi', timestamp: new Date() },
      sessionId: 's2',
      di: mockDI, runtimeConfig: stubRuntimeConfig(),
      agentState: new AgentState(),
      workspace: '/workspace-b',
    });

    for await (const _chunk of result.stream.fullStream) {
      // drain
    }
    await result.output;

    expect(capturedWorkspaceRoot).toBe('/workspace-b');
  });

  it('falls back to behavior.workspaceRoot when neither workspace nor workspaceRoot is provided', async () => {
    let capturedWorkspaceRoot: string | undefined;
    const mockDI = {
      ...createMockContextBase('/default-root'),
      mcpProviders: [],
      toolComposer: {
        compose: () => ({
          getToolSet: () => [],
          execute: async () => [],
          register: () => {},
          isDangerous: () => false,
        }),
      },
      loopStrategy: {
        run: async (ctx: any) => {
          capturedWorkspaceRoot = ctx.workspaceRoot;
          return { content: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        },
    },
  } as unknown as AgentDI;

    const { runAgent } = await import('../src/run-agent.js');
    const result = runAgent({
      input: { content: 'hi', timestamp: new Date() },
      sessionId: 's3',
      di: mockDI, runtimeConfig: stubRuntimeConfig(),
      agentState: new AgentState(),
    });

    for await (const _chunk of result.stream.fullStream) {
      // drain
    }
    await result.output;

    expect(capturedWorkspaceRoot).toBe('/default-root');
  });
});
