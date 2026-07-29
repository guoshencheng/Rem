import { describe, it, expect } from 'vitest';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { runAgent } from '../../src/run-agent.js';
import { createCoreModels } from '../../src/llm/models.js';
import { AgentState } from '../../src/agent-state.js';
import { InMemorySessionProvider } from '../../src/plugins/session/in-memory/index.js';
import type { AgentDI } from '../../src/agent-di.js';
import type { AgentStreamEvent } from '../../src/types.js';

const makeDi = (models: ReturnType<typeof createCoreModels>, sessionProvider: InMemorySessionProvider): AgentDI => ({
  configProvider: {
    getBehaviorConfig: () => ({ name: 'test', maxTurns: 5, workspaceRoot: '/tmp', readOnly: false, autoApproveDangerous: false }),
    getModelConfig: () => ({ provider: 'faux', model: 'faux-1', apiKey: '', baseURL: undefined }),
    getToolConfig: () => ({}), getMcpConfig: () => ({}),
    getCompressionConfig: () => ({ thresholdRatio: 0.8 }),
    resolveAgent: () => ({ id: 'default', name: 'test', corePrompt: 'p' }),
  } as never,
  sessionProvider,
  budgetPolicy: { checkTurn: () => true, checkTimeout: () => true } as never,
  systemPromptAssembler: { assemble: async () => 'sys' } as never,
  contextProvider: { build: async (s: { conversation: unknown[] }) => ({ system: 'sys', messages: s.conversation }) } as never,
  compressor: { shouldCompress: () => false, compress: async (m: never[]) => m } as never,
  errorHandler: { classify: () => 'unknown', isRetryable: () => false } as never,
  titleProvider: { generateTitle: async () => undefined } as never,
  mcpManager: { connectAll: async () => [], closeAll: async () => {} } as never,
  toolProvider: { getToolSet: () => [], getToolDefinition: () => undefined, execute: async () => [], register: () => {}, isDangerous: () => false } as never,
  mcpProviders: [],
  skillProvider: { loadSkills: async () => [] } as never,
  storage: {
    todoStore: { getBySession: async () => [], replaceForSession: async (_s: string, t: unknown[]) => t },
    archiveStore: { save: async () => {}, get: async () => null, listBySession: async () => [], getLatest: async () => null },
    ruleStore: { loadAll: async () => [], loadBySource: async () => [], saveApproved: async () => {} },
  } as never,
  ruleEngine: { addRule: () => {}, checkOutsideAllowed: () => false } as never,
  permissionEvaluator: { evaluate: async () => ({ action: 'allow' }) } as never,
  models,
});

describe('runAgent (pi Agent)', () => {
  it('streams events, persists messages, and returns output', async () => {
    const handle = fauxProvider();
    handle.setResponses([fauxAssistantMessage('final answer')]);
    const models = createCoreModels({ customProviders: [handle.provider] });
    const sessionProvider = new InMemorySessionProvider();
    const di = makeDi(models, sessionProvider);

    const { stream, output } = runAgent({
      input: { content: 'hi' },
      sessionId: 's1',
      di,
      runtimeConfig: { securityMode: 'auto', runtime: { platform: 'test', env: {} } } as never,
      agentState: new AgentState(),
    });

    const events: AgentStreamEvent[] = [];
    for await (const e of stream.fullStream) events.push(e);
    const result = await output;

    expect(result.completed).toBe(true);
    expect(result.content).toBe('final answer');
    expect(events.map((e) => e.type)).toContain('message-start');
    expect(events.map((e) => e.type)).toContain('step-finish');
    expect(events[events.length - 1].type).toBe('finish');

    const session = await sessionProvider.load('s1');
    expect(session!.conversation.map((m) => m.role)).toEqual(['user', 'assistant']);
  });
});
