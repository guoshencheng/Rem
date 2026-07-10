import { afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentService, type AgentServiceOptions } from '../../src/agent.js';
import { JsonWorkspaceRepository } from '../../src/workspace-repository-json.js';
import {
  clearProviders,
  registerProvider,
  SqliteStorageProvider,
  type AgentState,
  type StreamChunk,
  type GenerateResult,
} from 'rem-agent-core';
import type { BusEvent } from '../../src/types.js';

export const DEFAULT_WORKSPACE = 'default';

export interface MockProviderConfig {
  name: string;
  stream?: () => AsyncGenerator<StreamChunk>;
  generate?: () => Promise<GenerateResult>;
}

export function registerMockProvider(config: MockProviderConfig): void {
  registerProvider(config.name, {
    resolveConfig() {
      return { model: 'mock-model', apiKey: 'fake-key' };
    },
    async generate() {
      return config.generate
        ? config.generate()
        : { text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
    },
    async *stream() {
      if (config.stream) {
        yield* config.stream();
      }
    },
  });
}

import { SqliteStorageProvider } from 'rem-agent-core';

export interface TestService {
  service: AgentService;
  dir: string;
  storageProvider: SqliteStorageProvider;
  cleanup: () => Promise<void>;
}

export async function createTestService(options: {
  workspace?: string;
  provider?: MockProviderConfig;
  agentOptions?: Partial<AgentServiceOptions>;
} = {}): Promise<TestService> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-service-test-'));

  if (options.provider) {
    registerMockProvider(options.provider);
  }

  const workspaceRepo = new JsonWorkspaceRepository(join(dir, 'workspaces.json'));
  const workspace = options.workspace ?? DEFAULT_WORKSPACE;
  await workspaceRepo.add(workspace).catch(() => {});

  const storageProvider = new SqliteStorageProvider({ dbPath: join(dir, 'rem-agent.db') });

  const service = new AgentService(
    {
      name: 'TestAgent',
      provider: options.provider?.name ?? 'mock-default',
      model: 'mock-model',
      workspaceRoot: dir,
      storageProvider,
      ...options.agentOptions,
    },
    workspaceRepo,
  );

  await service.init();

  return {
    service,
    dir,
    storageProvider,
    cleanup: async () => {
      await storageProvider.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export function getAgentState(service: AgentService): AgentState {
  return (service as unknown as { state: AgentState }).state;
}

export function collectBusEvents(
  service: AgentService,
  sessionId?: string,
): { events: BusEvent[]; stop: () => void } {
  const events: BusEvent[] = [];
  const state = getAgentState(service);
  const stop = state.subscribe((event) => {
    if (sessionId === undefined || event.sessionId === sessionId) {
      events.push(event);
    }
  });
  return { events, stop };
}

export async function waitFor(
  events: BusEvent[],
  predicate: (events: BusEvent[]) => boolean,
  timeoutMs = 2000,
  intervalMs = 20,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate(events)) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('waitFor timeout');
}

export async function* buildStreamFromChunks(chunks: StreamChunk[]): AsyncGenerator<StreamChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

export const simpleTextStream = (): AsyncGenerator<StreamChunk> =>
  buildStreamFromChunks([
    { type: 'text', text: 'Hello' },
    { type: 'usage', inputTokens: 3, outputTokens: 3, totalTokens: 6 },
    { type: 'finish', reason: 'stop' },
  ]);

afterEach(() => {
  clearProviders();
});
