import { describe, it, expect, vi } from 'vitest';
import type { Usage } from '@earendil-works/pi-ai';
import type { AgentDI } from '../src/agent-di.js';
import type { AgentRuntimeConfig } from '../src/agent-runtime-config.js';
import { AgentState } from '../src/agent-state.js';

const emptyUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const createMockContextBase = () => ({
  configProvider: {
    getBehaviorConfig: () => ({ name: 'test', maxTurns: 1, workspaceRoot: '/tmp', readOnly: false, autoApproveDangerous: false }),
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
  systemPromptAssembler: { assemble: async () => 'mock system prompt' },
  toolComposer: {
    compose: () => ({
      getToolSet: () => [],
      execute: async () => [],
      register: () => {},
      isDangerous: () => false,
    }),
  },
  mcpProviders: [],
  storage: {
    todoStore: { getBySession: async () => [], replaceForSession: async (_s: string, todos: unknown[]) => todos },
    archiveStore: { save: async () => {}, get: async () => null, listBySession: async () => [], getLatest: async () => null },
    ruleStore: { loadAll: async () => [], loadBySource: async () => [], saveApproved: async () => {} },
  },
  models: {
    getModel: () => ({ id: 'gpt-4o-mini', provider: 'openai' }),
    stream: vi.fn(),
    complete: vi.fn(),
  },
});

const stubRuntimeConfig = (): AgentRuntimeConfig => ({
  securityMode: 'interactive',
  runtime: { platform: 'test', env: {} },
});

describe('runAgent', () => {
  it('returns a stream and output promise', async () => {
    const mockDI = {
      ...createMockContextBase(),
      loopStrategy: {
        run: async () => ({
          content: 'hello back',
          usage: { ...emptyUsage, input: 1, output: 1, totalTokens: 2 },
        }),
      },
    } as unknown as AgentDI;

    const { runAgent } = await import('../src/run-agent.js');
    const result = runAgent({
      input: { content: 'hello', timestamp: new Date() },
      sessionId: 'test-session',
      di: mockDI, runtimeConfig: stubRuntimeConfig(),
      agentState: new AgentState(),
    });
    expect(result.stream).toBeDefined();
    expect(result.output).toBeInstanceOf(Promise);

    // Consume stream to completion
    for await (const _chunk of result.stream.fullStream) {
      // drain
    }

    const output = await result.output;
    expect(output.completed).toBe(true);
  });

  it('passes through multipart user content (text + image) to the session', async () => {
    const saveMock = vi.fn();
    const base = createMockContextBase();
    const mockDI = {
      ...base,
      sessionProvider: { ...base.sessionProvider, save: saveMock },
      loopStrategy: {
        run: async () => ({
          content: 'ok',
          usage: { ...emptyUsage, input: 1, output: 1, totalTokens: 2 },
        }),
      },
    } as unknown as AgentDI;

    const parts = [
      { type: 'text' as const, text: 'look at this' },
      { type: 'image' as const, data: 'aGVsbG8=', mimeType: 'image/png' },
    ];

    const { runAgent } = await import('../src/run-agent.js');
    const result = runAgent({
      input: { content: parts, timestamp: new Date() },
      sessionId: 'test-session-parts',
      di: mockDI, runtimeConfig: stubRuntimeConfig(),
      agentState: new AgentState(),
    });
    for await (const _chunk of result.stream.fullStream) {
      // drain
    }
    await result.output;

    expect(saveMock).toHaveBeenCalled();
    const savedSession = saveMock.mock.calls[0][0] as { conversation: Array<{ role: string; content: unknown }> };
    const last = savedSession.conversation[savedSession.conversation.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toEqual(parts);
  });

  it('calls toolComposer.compose and uses the effective tool provider', async () => {
    const composedToolSet = [{ name: 'composedTool', description: 'composed', parameters: { type: 'object', properties: {} } }];
    const compose = vi.fn(() => ({
      getToolSet: () => composedToolSet,
      execute: async () => [],
      register: () => {},
      isDangerous: () => false,
    }));

    const mockDI = {
      ...createMockContextBase(),
      toolComposer: { compose },
      loopStrategy: {
        run: async (ctx: any) => {
          expect(ctx.stream).toBeDefined();
          expect(ctx.generate).toBeDefined();
          return {
            content: 'hello back',
            usage: { ...emptyUsage, input: 1, output: 1, totalTokens: 2 },
          };
        },
      },
    } as unknown as AgentDI;

    const { runAgent } = await import('../src/run-agent.js');
    const result = runAgent({
      input: { content: 'hello', timestamp: new Date() },
      sessionId: 'test-session',
      di: mockDI, runtimeConfig: stubRuntimeConfig(),
      agentState: new AgentState(),
    });

    for await (const _chunk of result.stream.fullStream) {
      // drain
    }

    await result.output;

    expect(compose).toHaveBeenCalledWith({
      toolProvider: mockDI.toolProvider,
      mcpProviders: mockDI.mcpProviders,
      skillProvider: mockDI.skillProvider,
    });
  });

  it('accumulates usage and writes history', async () => {
    const usage: Usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    const savedSessions: any[] = [];
    const mockDI = {
      ...createMockContextBase(),
      toolComposer: {
        compose: () => ({
          getToolSet: () => [],
          execute: async () => [],
          register: () => {},
          isDangerous: () => false,
        }),
      },
      loopStrategy: {
        run: async () => ({
          content: 'hello back',
          usage: { ...emptyUsage, input: 10, output: 5, totalTokens: 15 },
          message: { role: 'assistant', content: [], usage: { ...emptyUsage, input: 10, output: 5, totalTokens: 15 } },
        }),
      },
      sessionProvider: {
        load: async () => null,
        save: async (session: any) => { savedSessions.push(session); },
        addMessage: () => ({} as any),
        appendContent: () => {},
      },
    } as unknown as AgentDI;

    const agentState = new AgentState();
    const listener = vi.fn();
    agentState.subscribe(listener);

    const { runAgent } = await import('../src/run-agent.js');
    const result = runAgent({
      input: { content: 'hello', timestamp: new Date() },
      sessionId: 'test-session',
      di: mockDI, runtimeConfig: stubRuntimeConfig(),
      agentState,
      workspace: 'test-workspace',
    });

    for await (const _chunk of result.stream.fullStream) {
      // drain
    }

    await result.output;

    expect(agentState.get('test-session')?.tokenUsage.totalTokens).toBe(15);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      workspace: 'test-workspace',
      sessionId: 'test-session',
      type: 'usage-change',
    }));

    const lastSession = savedSessions[savedSessions.length - 1];
    expect(lastSession.metadata.tokenUsageHistory).toHaveLength(1);
    expect(lastSession.metadata.tokenUsageHistory[0].totalTokens).toBe(15);
  });

  it('emits error chunk when loopStrategy throws', async () => {
    const mockDI = {
      ...createMockContextBase(),
      toolComposer: {
        compose: () => ({
          getToolSet: () => [],
          execute: async () => [],
          register: () => {},
          isDangerous: () => false,
        }),
      },
      loopStrategy: {
        run: async () => { throw new Error('LLM failed'); },
      },
    } as unknown as AgentDI;

    const { runAgent } = await import('../src/run-agent.js');
    const result = runAgent({
      input: { content: 'hello', timestamp: new Date() },
      sessionId: 'test-session',
      di: mockDI, runtimeConfig: stubRuntimeConfig(),
      agentState: new AgentState(),
    });

    const chunks: import('../src/types.js').AgentStreamEvent[] = [];
    for await (const chunk of result.stream.fullStream) {
      chunks.push(chunk);
    }

    expect(chunks.some((c) => c.type === 'error')).toBe(true);
    expect(chunks.find((c) => c.type === 'error')).toMatchObject({
      error: expect.objectContaining({ message: 'LLM failed' }),
    });

    const output = await result.output;
    expect(output.completed).toBe(true);
    expect(output.content).toContain('LLM failed');
  });

  it('passes thinkingEnabled to stream/generate when model supports reasoning', async () => {
    const stream = vi.fn(async function* () {
      yield { type: 'text', contentIndex: 0, text: 'hi', partial: {} };
    });
    const complete = vi.fn();
    const mockDI = {
      ...createMockContextBase(),
      models: {
        getModel: () => ({ id: 'gpt-4o-mini', provider: 'openai', reasoning: true }),
        stream,
        complete,
      },
      loopStrategy: {
        run: async (ctx: any) => {
          const s = ctx.stream();
          for await (const _ of s) {
            // drain
          }
          await ctx.generate();
          return { content: 'hello back', usage: { ...emptyUsage, input: 1, output: 1, totalTokens: 2 } };
        },
      },
    } as unknown as AgentDI;

    const { runAgent } = await import('../src/run-agent.js');
    const result = runAgent({
      input: { content: 'hello', timestamp: new Date() },
      sessionId: 'test-session',
      di: mockDI, runtimeConfig: stubRuntimeConfig(),
      agentState: new AgentState(),
    });

    for await (const _ of result.stream.fullStream) {
      // drain
    }
    await result.output;

    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'gpt-4o-mini', reasoning: true }),
      expect.anything(),
      expect.objectContaining({ thinkingEnabled: true }),
    );
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'gpt-4o-mini', reasoning: true }),
      expect.anything(),
      expect.objectContaining({ thinkingEnabled: true }),
    );
  });

  it('always enables thinking for MiniMax regardless of reasoning config', async () => {
    const stream = vi.fn(async function* () {
      yield { type: 'text', contentIndex: 0, text: 'hi', partial: {} };
    });
    const complete = vi.fn();
    const base = createMockContextBase();
    const mockDI = {
      ...base,
      configProvider: {
        ...base.configProvider,
        getModelConfig: () => ({ provider: 'minimax', model: 'MiniMax-M3', apiKey: 'sk-test', baseURL: undefined, reasoning: 'off' }),
      },
      models: {
        getModel: () => ({ id: 'MiniMax-M3', provider: 'minimax', reasoning: true }),
        stream,
        complete,
      },
      loopStrategy: {
        run: async (ctx: any) => {
          const s = ctx.stream();
          for await (const _ of s) {
            // drain
          }
          await ctx.generate();
          return { content: 'hello back', usage: { ...emptyUsage, input: 1, output: 1, totalTokens: 2 } };
        },
      },
    } as unknown as AgentDI;

    const { runAgent } = await import('../src/run-agent.js');
    const result = runAgent({
      input: { content: 'hello', timestamp: new Date() },
      sessionId: 'test-session',
      di: mockDI, runtimeConfig: stubRuntimeConfig(),
      agentState: new AgentState(),
    });

    for await (const _ of result.stream.fullStream) {
      // drain
    }
    await result.output;

    const streamOptions = stream.mock.calls[0][2] as Record<string, unknown>;
    expect(streamOptions.thinkingEnabled).toBe(true);
    expect(streamOptions.reasoning).toBeUndefined();

    const completeOptions = complete.mock.calls[0][2] as Record<string, unknown>;
    expect(completeOptions.thinkingEnabled).toBe(true);
    expect(completeOptions.reasoning).toBeUndefined();
  });
});
