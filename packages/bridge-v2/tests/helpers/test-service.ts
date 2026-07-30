import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgentAssembly, createDefaultAgentPaths, initializeAgentDI } from 'rem-agent-core';
import type { AgentContextBuildOptions, BusEvent } from 'rem-agent-core';
import { AgentsUniService } from '../../src/agents-uni-service.js';
import { createMockModels, type MockProviderConfig } from './mock-models.js';
import { StaticConfigProvider } from './static-config-provider.js';

export const DEFAULT_WORKSPACE = 'default';

export interface TestService {
  service: AgentsUniService;
  dir: string;
  cleanup: () => Promise<void>;
}

export async function createTestService(options: {
  workspace?: string;
  provider?: MockProviderConfig;
  agentOptions?: Partial<AgentContextBuildOptions>;
} = {}): Promise<TestService> {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-v2-test-'));
  const paths = createDefaultAgentPaths({ agentDir: dir, homeAgentDir: dir });
  const models = createMockModels(options.provider ?? { name: 'mock-default' });
  const workspace = options.workspace ?? DEFAULT_WORKSPACE;

  const configProvider = new StaticConfigProvider({
    provider: options.provider?.name ?? 'mock-default',
    model: 'mock-model',
    apiKey: 'mock-key',
    name: 'TestAgent',
  });

  const { di, runtimeConfig } = createAgentAssembly({ paths, configProvider, models, ...options.agentOptions });
  await initializeAgentDI(di, { skipMcp: true });

  const service = new AgentsUniService(di, runtimeConfig);
  await di.storage.workspaceStore.add(workspace).catch(() => {});

  return {
    service,
    dir,
    cleanup: async () => {
      di.storage.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** 订阅总线直到 predicate 命中或超时 */
export async function waitForBusEvent(
  service: AgentsUniService,
  predicate: (e: BusEvent) => boolean,
  timeoutMs = 5000,
): Promise<BusEvent> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    for await (const event of service.stream(ac.signal)) {
      if (predicate(event)) return event;
    }
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
  throw new Error('waitForBusEvent timeout');
}
