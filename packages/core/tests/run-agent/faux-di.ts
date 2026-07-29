import { fauxProvider, type FauxResponseStep } from '@earendil-works/pi-ai/providers/faux';
import { createCoreModels } from '../../src/llm/models.js';
import { InMemorySessionProvider } from '../../src/plugins/session/in-memory/index.js';
import type { AgentDI } from '../../src/agent-di.js';
import type { AgentRuntimeConfig } from '../../src/agent-runtime-config.js';

export interface FauxDiOptions {
  responses?: FauxResponseStep[];
  sessionProvider?: InMemorySessionProvider;
  configOverrides?: Record<string, unknown>;
  diOverrides?: Record<string, unknown>;
}

export function createFauxDi(options: FauxDiOptions = {}): { di: AgentDI; handle: ReturnType<typeof fauxProvider>; sessionProvider: InMemorySessionProvider } {
  const handle = fauxProvider();
  if (options.responses) handle.setResponses(options.responses);
  const models = createCoreModels({ customProviders: [handle.provider] });
  const sessionProvider = options.sessionProvider ?? new InMemorySessionProvider();

  const configProvider = {
    getBehaviorConfig: () => ({ name: 'test', maxTurns: 5, workspaceRoot: '/tmp', readOnly: false, autoApproveDangerous: false }),
    getModelConfig: () => ({ provider: 'faux', model: 'faux-1', apiKey: '', baseURL: undefined }),
    getToolConfig: () => ({}),
    getMcpConfig: () => ({}),
    getCompressionConfig: () => ({ thresholdRatio: 0.8 }),
    resolveAgent: () => ({ id: 'default', name: 'test', corePrompt: 'p' }),
    ...(options.configOverrides ?? {}),
  };

  const di = {
    configProvider,
    sessionProvider,
    budgetPolicy: { checkTurn: () => true, checkTimeout: () => true },
    systemPromptAssembler: { assemble: async () => 'sys' },
    contextProvider: { build: async (s: { conversation: unknown[] }) => ({ system: 'sys', messages: s.conversation }) },
    compressor: { shouldCompress: () => false, compress: async (m: never[]) => m },
    errorHandler: { classify: () => 'unknown', isRetryable: () => false },
    titleProvider: { generateTitle: async () => undefined },
    mcpManager: { connectAll: async () => [], closeAll: async () => {} },
    toolProvider: { getToolSet: () => [], getToolDefinition: () => undefined, execute: async () => [], register: () => {}, isDangerous: () => false },
    mcpProviders: [],
    skillProvider: { loadSkills: async () => [] },
    storage: {
      todoStore: { getBySession: async () => [], replaceForSession: async (_s: string, t: unknown[]) => t },
      archiveStore: { save: async () => {}, get: async () => null, listBySession: async () => [], getLatest: async () => null },
      ruleStore: { loadAll: async () => [], loadBySource: async () => [], saveApproved: async () => {} },
    },
    ruleEngine: { addRule: () => {}, checkOutsideAllowed: () => false },
    permissionEvaluator: { evaluate: async () => ({ action: 'allow' }) },
    models,
    ...(options.diOverrides ?? {}),
  } as unknown as AgentDI;

  return { di, handle, sessionProvider };
}

export const stubRuntimeConfig = (): AgentRuntimeConfig =>
  ({ securityMode: 'auto', runtime: { platform: 'test', env: {} } }) as unknown as AgentRuntimeConfig;
