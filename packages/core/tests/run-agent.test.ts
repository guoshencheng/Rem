import { describe, it, expect, vi } from 'vitest';
import type { AgentContext } from '../src/agent-context.js';

describe('runAgent', () => {
  it('returns a stream and output promise', async () => {
    const mockCtx = {
      configProvider: {
        getBehaviorConfig: () => ({ name: 'test', maxTurns: 1, workspaceRoot: '/tmp', readOnly: false, sessionsDir: '/tmp/.sessions', autoApproveDangerous: false }),
        getModelConfig: () => ({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test', baseURL: undefined }),
        getToolConfig: () => ({}),
        getMcpConfig: () => ({}),
      },
      sessionProvider: { load: async () => null, save: async () => {}, addMessage: () => ({} as any), appendContent: () => {} },
      agentLiveProvider: { get: () => null, getOrCreate: () => ({} as any), set: () => {} },
      toolProvider: { getToolSet: () => ({}), register: () => {} },
      contextProvider: { build: async () => ({ system: 'You are test.', messages: [] }) },
      skillProvider: { loadSkills: async () => [], formatCatalog: () => '' },
      budgetPolicy: { checkTurn: () => true, checkTimeout: () => true, shouldCircuitBreak: () => false, getStatus: () => ({ turnsRemaining: 1, consecutiveErrors: 0, atRisk: false }) },
      compressor: { shouldCompress: () => false, compress: async (msgs: unknown[]) => msgs },
      errorHandler: { classify: () => 'unknown', isRetryable: () => false },
      titleProvider: { generateTitle: async () => undefined },
      loopStrategy: {
        run: async () => ({
          content: 'hello back',
          newMessages: [],
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        }),
      },
      mcpManager: { connectAll: async () => [], closeAll: async () => {} },
    } as unknown as AgentContext;

    const { runAgent } = await import('../src/run-agent.js');
    const result = runAgent({
      input: { content: 'hello', timestamp: new Date() },
      sessionId: 'test-session',
      ctx: mockCtx,
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
      configProvider: {
        getBehaviorConfig: () => ({ name: 'test', maxTurns: 1, workspaceRoot: '/tmp', readOnly: false, sessionsDir: '/tmp/.sessions', autoApproveDangerous: false }),
        getModelConfig: () => ({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test', baseURL: undefined }),
        getToolConfig: () => ({}),
        getMcpConfig: () => ({}),
      },
      sessionProvider: { load: async () => null, save: async () => {}, addMessage: () => ({} as any), appendContent: () => {} },
      agentLiveProvider: { get: () => null, getOrCreate: () => ({} as any), set: () => {} },
      toolProvider: { getToolSet: () => ({}), register: () => {} },
      mcpProviders: [],
      skillProvider: { loadSkills: async () => [], formatCatalog: () => '' },
      toolComposer: { compose },
      contextProvider: { build: async () => ({ system: 'You are test.', messages: [] }) },
      budgetPolicy: { checkTurn: () => true, checkTimeout: () => true, shouldCircuitBreak: () => false, getStatus: () => ({ turnsRemaining: 1, consecutiveErrors: 0, atRisk: false }) },
      compressor: { shouldCompress: () => false, compress: async (msgs: unknown[]) => msgs },
      errorHandler: { classify: () => 'unknown', isRetryable: () => false },
      titleProvider: { generateTitle: async () => undefined },
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
      mcpManager: { connectAll: async () => [], closeAll: async () => {} },
    } as unknown as AgentContext;

    const { runAgent } = await import('../src/run-agent.js');
    const result = runAgent({
      input: { content: 'hello', timestamp: new Date() },
      sessionId: 'test-session',
      ctx: mockCtx,
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
});
