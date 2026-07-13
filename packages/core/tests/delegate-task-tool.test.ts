import { describe, it, expect } from 'vitest';
import { InMemorySessionProvider } from '../src/plugins/session/in-memory/index.js';
import { AgentState } from '../src/agent-state.js';
import { createFileMutationQueue } from '../src/plugins/tool/file-system/shared/file-mutation-queue.js';
import {
  createDelegateTaskToolExecutor,
} from '../src/plugins/tool/builtin/delegate-task.js';
import type { AgentContext } from '../src/agent-context.js';

describe('delegate_task tool', () => {
  it('creates a child session and returns XML result', async () => {
    const sessionProvider = new InMemorySessionProvider();

    const agentState = new AgentState();
    const mockCtx = {
      configProvider: {
        getBehaviorConfig: () => ({ name: 'parent', maxTurns: 10, workspaceRoot: '/tmp', readOnly: false, sessionsDir: '/tmp/.sessions', autoApproveDangerous: false }),
        getModelConfig: () => ({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test', baseURL: undefined }),
        getToolConfig: () => ({}),
        getMcpConfig: () => ({}),
        getConfig: () => ({ name: 'parent', maxTurns: 10, workspaceRoot: '/tmp', readOnly: false, sessionsDir: '/tmp/.sessions', autoApproveDangerous: false, model: { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test' } }),
        resolveAgent: () => ({ id: 'default', name: 'parent', corePrompt: 'Default prompt.' }),
      },
      sessionProvider,
      toolProvider: { getToolSet: () => ({}), register: () => {} },
      mcpProviders: [],
      contextProvider: { build: async () => ({ system: 'You are test.', messages: [] }) },
      skillProvider: { loadSkills: async () => [], formatCatalog: () => '' },
      budgetPolicy: { checkTurn: () => true, checkTimeout: () => true, shouldCircuitBreak: () => false, getStatus: () => ({ turnsRemaining: 10, consecutiveErrors: 0, atRisk: false }) },
      compressor: { shouldCompress: () => false, compress: async (msgs: any[]) => msgs },
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
      ruleEngine: { evaluate: () => 'allow', checkOutsideAllowed: () => false, addRule: () => {} } as any,
      ruleStore: { saveApproved: async () => {}, loadAll: async () => [] } as any,
      permissionEvaluator: { evaluate: async () => ({ action: 'allow' }) } as any,
      securityMode: 'interactive' as const,
      loopStrategy: {
        run: async () => ({
          content: 'child result',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        }),
      },
    } as unknown as AgentContext;

    const executor = createDelegateTaskToolExecutor(mockCtx, agentState, 'default');
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

    const mockCtx = {
      configProvider: {
        getBehaviorConfig: () => ({ name: 'parent', maxTurns: 10, workspaceRoot: '/tmp', readOnly: false, sessionsDir: '/tmp/.sessions', autoApproveDangerous: false }),
        getModelConfig: () => ({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test', baseURL: undefined }),
        getToolConfig: () => ({}),
        getMcpConfig: () => ({}),
        getConfig: () => ({ name: 'parent', maxTurns: 10, workspaceRoot: '/tmp', readOnly: false, sessionsDir: '/tmp/.sessions', autoApproveDangerous: false, model: { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test' } }),
        resolveAgent: () => ({ id: 'default', name: 'parent', corePrompt: 'Default prompt.' }),
      },
      sessionProvider,
      toolProvider: { getToolSet: () => ({}), register: () => {} },
      mcpProviders: [],
      contextProvider: { build: async () => ({ system: 'You are test.', messages: [] }) },
      skillProvider: { loadSkills: async () => [], formatCatalog: () => '' },
      budgetPolicy: { checkTurn: () => true, checkTimeout: () => true, shouldCircuitBreak: () => false, getStatus: () => ({ turnsRemaining: 10, consecutiveErrors: 0, atRisk: false }) },
      compressor: { shouldCompress: () => false, compress: async (msgs: any[]) => msgs },
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
      ruleEngine: { evaluate: () => 'allow', checkOutsideAllowed: () => false, addRule: () => {} } as any,
      ruleStore: { saveApproved: async () => {}, loadAll: async () => [] } as any,
      permissionEvaluator: { evaluate: async () => ({ action: 'allow' }) } as any,
      securityMode: 'interactive' as const,
      loopStrategy: {
        run: async () => {
          throw new Error('Child agent failure');
        },
      },
    } as unknown as AgentContext;

    const executor = createDelegateTaskToolExecutor(mockCtx, agentState, 'default');
    const result = await executor({ task: 'do sub work' }, { cwd: '/tmp', workspaceRoot: '/tmp', sessionId: 'parent-1' });

    expect(result.output).toContain('state="failed"');
    expect(result.output).toContain('Child agent failure');
  });
});
