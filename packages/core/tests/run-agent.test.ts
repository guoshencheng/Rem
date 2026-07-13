import { describe, it, expect, vi } from 'vitest';
import type { AgentContext } from '../src/agent-context.js';
import { createFileMutationQueue } from '../src/plugins/tool/file-system/shared/file-mutation-queue.js';
import { AgentState } from '../src/agent-state.js';
import type { LanguageModelUsage } from '../src/types.js';

const createMockContextBase = () => ({
  configProvider: {
    getBehaviorConfig: () => ({ name: 'test', maxTurns: 1, workspaceRoot: '/tmp', readOnly: false, sessionsDir: '/tmp/.sessions', autoApproveDangerous: false }),
    getModelConfig: () => ({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test', baseURL: undefined }),
    getToolConfig: () => ({}),
    getMcpConfig: () => ({}),
    resolveAgent: () => ({ id: 'default', name: 'test', corePrompt: 'Default prompt.' }),
  },
  sessionProvider: { load: async () => null, save: async () => {}, addMessage: () => ({} as any), appendContent: () => {} },
  toolProvider: { getToolSet: () => ({}), register: () => {} },
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
      getToolSet: () => ({}),
      execute: async () => [],
      register: () => {},
      isDangerous: () => false,
    }),
  },
});

describe('runAgent', () => {
  it('returns a stream and output promise', async () => {
    const mockCtx = {
      ...createMockContextBase(),
      loopStrategy: {
        run: async () => ({
          content: 'hello back',
          newMessages: [],
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        }),
      },
    } as unknown as AgentContext;

    const { runAgent } = await import('../src/run-agent.js');
    const result = runAgent({
      input: { content: 'hello', timestamp: new Date() },
      sessionId: 'test-session',
      ctx: mockCtx,
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

  it('calls toolComposer.compose and uses the effective tool provider', async () => {
    const composedToolSet = { composedTool: { description: 'composed', parameters: { type: 'object', properties: {} } } };
    const compose = vi.fn(() => ({
      getToolSet: () => composedToolSet,
      execute: async () => [],
      register: () => {},
      isDangerous: () => false,
    }));

    const mockCtx = {
      ...createMockContextBase(),
      mcpProviders: [],
      toolComposer: { compose },
      loopStrategy: {
        run: async (ctx: any) => {
          expect(ctx.reason).toBeDefined();
          return {
            content: 'hello back',
            newMessages: [],
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        },
      },
    } as unknown as AgentContext;

    const { runAgent } = await import('../src/run-agent.js');
    const result = runAgent({
      input: { content: 'hello', timestamp: new Date() },
      sessionId: 'test-session',
      ctx: mockCtx,
      agentState: new AgentState(),
    });

    for await (const _chunk of result.stream.fullStream) {
      // drain
    }

    await result.output;

    expect(compose).toHaveBeenCalledWith({
      toolProvider: mockCtx.toolProvider,
      mcpProviders: mockCtx.mcpProviders,
      skillProvider: mockCtx.skillProvider,
    });
  });

  it('accumulates usage and writes history', async () => {
    const usage: LanguageModelUsage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
    const savedSessions: any[] = [];
    const mockCtx = {
      ...createMockContextBase(),
      mcpProviders: [],
      toolComposer: {
        compose: () => ({
          getToolSet: () => ({}),
          execute: async () => [],
          register: () => {},
          isDangerous: () => false,
        }),
      },
      loopStrategy: {
        run: async () => ({ content: 'hello back', newMessages: [], usage }),
      },
      sessionProvider: {
        load: async () => null,
        save: async (session: any) => { savedSessions.push(session); },
        addMessage: () => ({} as any),
        appendContent: () => {},
      },
    } as unknown as AgentContext;

    const agentState = new AgentState();
    const listener = vi.fn();
    agentState.subscribe(listener);

    const { runAgent } = await import('../src/run-agent.js');
    const result = runAgent({
      input: { content: 'hello', timestamp: new Date() },
      sessionId: 'test-session',
      ctx: mockCtx,
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
    const mockCtx = {
      ...createMockContextBase(),
      mcpProviders: [],
      toolComposer: {
        compose: () => ({
          getToolSet: () => ({}),
          execute: async () => [],
          register: () => {},
          isDangerous: () => false,
        }),
      },
      loopStrategy: {
        run: async () => { throw new Error('LLM failed'); },
      },
    } as unknown as AgentContext;

    const { runAgent } = await import('../src/run-agent.js');
    const result = runAgent({
      input: { content: 'hello', timestamp: new Date() },
      sessionId: 'test-session',
      ctx: mockCtx,
      agentState: new AgentState(),
    });

    const chunks: import('../src/types.js').AgentStreamChunk[] = [];
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
});
