import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentContext } from '../src/agent-context.js';
import { AgentState } from '../src/agent-state.js';
import type { PromptBuildContext } from '../src/sdk/system-prompt.js';
import { createFileMutationQueue } from '../src/plugins/tool/file-system/shared/file-mutation-queue.js';

vi.mock('../src/reason/reason.js', () => ({
  reason: vi.fn(async () => ({
    [Symbol.asyncIterator]() {
      return { async next() { return { done: true, value: undefined }; } };
    },
  })),
}));

function createMockContext(overrides: Record<string, unknown> = {}) {
  const capturedAssemble = vi.fn(async (_ctx: PromptBuildContext) => 'mock system prompt');
  return {
    configProvider: {
      getBehaviorConfig: () => ({ name: 'test', maxTurns: 1, workspaceRoot: '/tmp', readOnly: false, sessionsDir: '/tmp/.sessions', autoApproveDangerous: false }),
      getModelConfig: () => ({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test', baseURL: undefined }),
      getToolConfig: () => ({}),
      getMcpConfig: () => ({}),
      resolveAgent: (id?: string) => {
        if (id === 'coder') {
          return { id: 'coder', name: 'Code Assistant', corePrompt: 'Focus on code.' };
        }
        if (id === 'coder-with-model') {
          return {
            id: 'coder-with-model',
            name: 'Code Assistant',
            corePrompt: 'Focus on code.',
            model: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', apiKey: 'sk-anthropic', baseURL: undefined },
          };
        }
        return { id: 'default', name: 'test', corePrompt: 'Default prompt.' };
      },
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
    systemPromptAssembler: { assemble: capturedAssemble },
    toolComposer: {
      compose: () => ({
        getToolSet: () => ({}),
        execute: async () => [],
        register: () => {},
        isDangerous: () => false,
      }),
    },
    mcpProviders: [],
    loopStrategy: {
      run: async (loopCtx: any) => {
        await loopCtx.reason();
        return {
          content: 'hello back',
          newMessages: [],
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
    },
    ...overrides,
  } as unknown as AgentContext;
}

describe('runAgent custom agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses custom agent corePrompt and falls back to default model', async () => {
    const { runAgent } = await import('../src/run-agent.js');
    const { reason } = await import('../src/reason/reason.js');

    const ctx = createMockContext();
    const result = runAgent({
      input: { content: 'hello', timestamp: new Date() },
      sessionId: 'test-session',
      ctx,
      agentState: new AgentState(),
      agent: 'coder',
    });

    for await (const _chunk of result.stream.fullStream) {
      // drain
    }
    await result.output;

    const assembleCall = (ctx.systemPromptAssembler.assemble as any).mock.calls[0][0];
    expect(assembleCall.agentName).toBe('Code Assistant');
    expect(assembleCall.agentCorePrompt).toBe('Focus on code.');

    const reasonCall = (reason as any).mock.calls[0][0];
    expect(reasonCall.provider).toBe('openai');
    expect(reasonCall.model).toBe('gpt-4o-mini');
    expect(reasonCall.system).toBe('mock system prompt');
  });

  it('uses custom agent model override', async () => {
    const { runAgent } = await import('../src/run-agent.js');
    const { reason } = await import('../src/reason/reason.js');

    const ctx = createMockContext();
    const result = runAgent({
      input: { content: 'hello', timestamp: new Date() },
      sessionId: 'test-session',
      ctx,
      agentState: new AgentState(),
      agent: 'coder-with-model',
    });

    for await (const _chunk of result.stream.fullStream) {
      // drain
    }
    await result.output;

    const reasonCall = (reason as any).mock.calls[0][0];
    expect(reasonCall.provider).toBe('anthropic');
    expect(reasonCall.model).toBe('claude-3-5-sonnet-20241022');
    expect(reasonCall.apiKey).toBe('sk-anthropic');
  });

  it('falls back to default when agent is unknown', async () => {
    const { runAgent } = await import('../src/run-agent.js');
    const ctx = createMockContext();
    const result = runAgent({
      input: { content: 'hello', timestamp: new Date() },
      sessionId: 'test-session',
      ctx,
      agentState: new AgentState(),
      agent: 'unknown',
    });

    for await (const _chunk of result.stream.fullStream) {
      // drain
    }
    await result.output;

    const assembleCall = (ctx.systemPromptAssembler.assemble as any).mock.calls[0][0];
    expect(assembleCall.agentName).toBe('test');
    expect(assembleCall.agentCorePrompt).toBe('Default prompt.');
  });
});
