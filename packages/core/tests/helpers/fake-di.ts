import type { Models } from '@earendil-works/pi-ai';
import type { RuntimeConfigProvider } from '../../src/sdk/runtime-config-provider.js';
import { createMockModels } from './mock-models.js';

export interface FakeAssembly {
  models: Models;
  runtimeConfigProvider: RuntimeConfigProvider;
  executionRoot: string;
  cleanup: () => Promise<void>;
}

export interface FakeAssemblyOptions {
  models?: Models;
  maxTurns?: number;
}

/** Runtime-only test dependencies. */
export async function createFakeAssembly(options: FakeAssemblyOptions = {}): Promise<FakeAssembly> {
  const maxTurns = options.maxTurns ?? 5;
  return {
    models: options.models ?? createMockModels({ name: 'mock' }),
    runtimeConfigProvider: fakeRuntimeConfigProvider(maxTurns),
    executionRoot: '/',
    cleanup: async () => {},
  };
}

export function fakeRuntimeConfigProvider(maxTurns = 5): RuntimeConfigProvider {
  return {
    init: async () => {},
    getDefaults: () => ({
      config: {},
      behavior: { name: 'TestAgent', maxTurns, executionRoot: '/', readOnly: false, autoApproveDangerous: true },
      compression: { enabled: false, thresholdRatio: 0.8, protectHead: 4, protectTail: 8 },
      tool: {},
      orchestration: {
        maxAgentRuns: 20, maxMessages: 50, maxDepth: 8, timeoutMs: 300_000,
        maxTokens: 200_000, maxParallelAgents: 4,
      },
    }),
    resolveModel: () => ({ provider: 'mock', model: 'mock-model', apiKey: 'mock-key' }),
  };
}
