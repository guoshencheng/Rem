import { describe, it, expect } from 'vitest';
import { InMemorySessionProvider } from '../src/plugins/session/in-memory/index.js';
import { AgentState } from '../src/agent-state.js';
import type { BusEvent } from '../src/bus-events.js';
import {
  createDelegateTaskToolExecutor,
} from '../src/plugins/tool/builtin/delegate-task.js';
import type { AgentDI } from '../src/agent-di.js';
import type { AgentRuntimeConfig } from '../src/agent-runtime-config.js';

const stubRuntimeConfig = (): AgentRuntimeConfig => ({
  securityMode: 'interactive',
  runtime: { platform: 'test', env: {} },
});

describe('delegate_task tool', () => {
  it('creates a child session and returns XML result', async () => {
    const sessionProvider = new InMemorySessionProvider();

    const agentState = new AgentState();
    const mockDI = {
      configProvider: {
        getBehaviorConfig: () => ({ name: 'parent', maxTurns: 10, workspaceRoot: '/tmp', readOnly: false, autoApproveDangerous: false }),
        getModelConfig: () => ({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test', baseURL: undefined }),
        getToolConfig: () => ({}),
        getMcpConfig: () => ({}),
        getConfig: () => ({ name: 'parent', maxTurns: 10, workspaceRoot: '/tmp', readOnly: false, autoApproveDangerous: false, model: { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test' } }),
        resolveAgent: () => ({ id: 'default', name: 'parent', corePrompt: 'Default prompt.' }),
      },
      sessionProvider,
      toolProvider: { getToolSet: () => [], register: () => {} },
      mcpProviders: [],
      contextProvider: { build: async () => ({ system: 'You are test.', messages: [] }) },
      skillProvider: { loadSkills: async () => [], formatCatalog: () => '' },
      budgetPolicy: { checkTurn: () => true, checkTimeout: () => true, shouldCircuitBreak: () => false, getStatus: () => ({ turnsRemaining: 10, consecutiveErrors: 0, atRisk: false }) },
      compressor: { shouldCompress: () => false, compress: async (msgs: any[]) => msgs },
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
      ruleEngine: { evaluate: () => 'allow', checkOutsideAllowed: () => false, addRule: () => {} } as any,
      storage: {
        todoStore: { getBySession: async () => [], replaceForSession: async (_s: string, todos: unknown[]) => todos },
        archiveStore: { save: async () => {}, get: async () => null, listBySession: async () => [], getLatest: async () => null },
        ruleStore: { saveApproved: async () => {}, loadAll: async () => [], loadBySource: async () => [] },
      } as any,
      permissionEvaluator: { evaluate: async () => ({ action: 'allow' }) } as any,
      loopStrategy: {
        run: async () => ({
          content: 'child result',
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        }),
      },
    } as unknown as AgentDI;

    const executor = createDelegateTaskToolExecutor(mockDI, stubRuntimeConfig(), agentState, 'default');
    const result = await executor({ task: 'do sub work' }, { cwd: '/tmp', workspaceRoot: '/tmp', sessionId: 'parent-1' });

    expect(result.output).toContain('<task id="');
    expect(result.output).toContain('state="completed"');
    expect(result.output).toContain('<summary>do sub work</summary>');
    expect(result.output).toContain('<task_result>\nchild result\n  </task_result>');

    const sessions = await sessionProvider.list();
    expect(sessions.length).toBeGreaterThan(0);
  });

  it('propagates errors from child agent as failed XML', async () => {
    const sessionProvider = new InMemorySessionProvider();
    const agentState = new AgentState();

    const mockDI = {
      configProvider: {
        getBehaviorConfig: () => ({ name: 'parent', maxTurns: 10, workspaceRoot: '/tmp', readOnly: false, autoApproveDangerous: false }),
        getModelConfig: () => ({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test', baseURL: undefined }),
        getToolConfig: () => ({}),
        getMcpConfig: () => ({}),
        getConfig: () => ({ name: 'parent', maxTurns: 10, workspaceRoot: '/tmp', readOnly: false, autoApproveDangerous: false, model: { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test' } }),
        resolveAgent: () => ({ id: 'default', name: 'parent', corePrompt: 'Default prompt.' }),
      },
      sessionProvider,
      toolProvider: { getToolSet: () => [], register: () => {} },
      mcpProviders: [],
      contextProvider: { build: async () => ({ system: 'You are test.', messages: [] }) },
      skillProvider: { loadSkills: async () => [], formatCatalog: () => '' },
      budgetPolicy: { checkTurn: () => true, checkTimeout: () => true, shouldCircuitBreak: () => false, getStatus: () => ({ turnsRemaining: 10, consecutiveErrors: 0, atRisk: false }) },
      compressor: { shouldCompress: () => false, compress: async (msgs: any[]) => msgs },
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
      ruleEngine: { evaluate: () => 'allow', checkOutsideAllowed: () => false, addRule: () => {} } as any,
      storage: {
        todoStore: { getBySession: async () => [], replaceForSession: async (_s: string, todos: unknown[]) => todos },
        archiveStore: { save: async () => {}, get: async () => null, listBySession: async () => [], getLatest: async () => null },
        ruleStore: { saveApproved: async () => {}, loadAll: async () => [], loadBySource: async () => [] },
      } as any,
      permissionEvaluator: { evaluate: async () => ({ action: 'allow' }) } as any,
      loopStrategy: {
        run: async () => {
          throw new Error('Child agent failure');
        },
      },
    } as unknown as AgentDI;

    const executor = createDelegateTaskToolExecutor(mockDI, stubRuntimeConfig(), agentState, 'default');
    const result = await executor({ task: 'do sub work' }, { cwd: '/tmp', workspaceRoot: '/tmp', sessionId: 'parent-1' });

    expect(result.output).toContain('state="failed"');
    expect(result.output).toContain('Child agent failure');
  });

  it('drives child stream chunks into the bus and tags child-agent-update with toolCallId', async () => {
    const sessionProvider = new InMemorySessionProvider();
    const agentState = new AgentState();
    const events: BusEvent[] = [];
    agentState.subscribe((event) => events.push(event));

    const mockDI = {
      configProvider: {
        getBehaviorConfig: () => ({ name: 'parent', maxTurns: 10, workspaceRoot: '/tmp', readOnly: false, autoApproveDangerous: false }),
        getModelConfig: () => ({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test', baseURL: undefined }),
        getToolConfig: () => ({}),
        getMcpConfig: () => ({}),
        getConfig: () => ({ name: 'parent', maxTurns: 10, workspaceRoot: '/tmp', readOnly: false, autoApproveDangerous: false, model: { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test' } }),
        resolveAgent: () => ({ id: 'default', name: 'parent', corePrompt: 'Default prompt.' }),
      },
      sessionProvider,
      toolProvider: { getToolSet: () => [], register: () => {} },
      mcpProviders: [],
      contextProvider: { build: async () => ({ system: 'You are test.', messages: [] }) },
      skillProvider: { loadSkills: async () => [], formatCatalog: () => '' },
      budgetPolicy: { checkTurn: () => true, checkTimeout: () => true, shouldCircuitBreak: () => false, getStatus: () => ({ turnsRemaining: 10, consecutiveErrors: 0, atRisk: false }) },
      compressor: { shouldCompress: () => false, compress: async (msgs: any[]) => msgs },
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
      ruleEngine: { evaluate: () => 'allow', checkOutsideAllowed: () => false, addRule: () => {} } as any,
      storage: {
        todoStore: { getBySession: async () => [], replaceForSession: async (_s: string, todos: unknown[]) => todos },
        archiveStore: { save: async () => {}, get: async () => null, listBySession: async () => [], getLatest: async () => null },
        ruleStore: { saveApproved: async () => {}, loadAll: async () => [], loadBySource: async () => [] },
      } as any,
      permissionEvaluator: { evaluate: async () => ({ action: 'allow' }) } as any,
      loopStrategy: {
        run: async (loopCtx: any) => {
          loopCtx.emit({ type: 'message-start', step: 1, messageId: 'child-msg-1' });
          loopCtx.emit({ type: 'text_start', contentIndex: 0, partial: {} });
          loopCtx.emit({ type: 'text_delta', contentIndex: 0, delta: 'hello', partial: {} });
          return {
            content: 'child result',
            usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          };
        },
      },
    } as unknown as AgentDI;

    const executor = createDelegateTaskToolExecutor(mockDI, stubRuntimeConfig(), agentState, 'default');
    const result = await executor(
      { task: 'stream sub work' },
      { cwd: '/tmp', workspaceRoot: '/tmp', sessionId: 'parent-1', toolCallId: 'tc-1' },
    );

    expect(result.output).toContain('state="completed"');

    const childSessionId = events.find((e) => e.type === 'child-agent-update')?.type === 'child-agent-update'
      ? (events.find((e) => e.type === 'child-agent-update') as Extract<BusEvent, { type: 'child-agent-update' }>).childSessionId
      : undefined;
    expect(childSessionId).toBeDefined();

    const childChunks = events.filter(
      (e): e is Extract<BusEvent, { type: 'chunk' }> => e.type === 'chunk' && e.sessionId === childSessionId,
    );
    expect(childChunks.some((c) => c.chunk.type === 'text_delta')).toBe(true);
    expect(childChunks.some((c) => c.chunk.type === 'finish')).toBe(true);

    const sessionEnd = events.find((e) => e.type === 'session-end' && e.sessionId === childSessionId);
    expect(sessionEnd).toBeDefined();

    const updates = events.filter(
      (e): e is Extract<BusEvent, { type: 'child-agent-update' }> => e.type === 'child-agent-update',
    );
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.every((u) => u.toolCallId === 'tc-1')).toBe(true);
    expect(updates[updates.length - 1].status).toBe('completed');
  });
});
