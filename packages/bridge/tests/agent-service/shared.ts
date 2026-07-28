import { afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentService, type AgentServiceOptions } from '../../src/agent.js';
import { SqliteStorageProvider, type AgentState, createDefaultAgentPaths } from 'rem-agent-core';
import { createCoreModels } from 'rem-agent-core';
import type { Models, Provider, Model, AssistantMessageEventStream, AssistantMessage, Message, AssistantMessageEvent } from '@earendil-works/pi-ai';
import type { BusEvent } from '../../src/types.js';

export { createDefaultAgentPaths } from 'rem-agent-core';
export const DEFAULT_WORKSPACE = 'default';

export interface MockProviderConfig {
  name: string;
  stream?: () => AsyncGenerator<AssistantMessageEvent>;
  complete?: () => Promise<AssistantMessage>;
  error?: Error;
}

class MockEventStream implements AsyncIterable<AssistantMessageEvent> {
  private events: AssistantMessageEvent[] = [];
  private pending: Array<(event: AssistantMessageEvent | null) => void> = [];
  private resultPromise: Promise<AssistantMessage>;
  private resolveResult!: (value: AssistantMessage) => void;
  private done = false;

  constructor() {
    this.resultPromise = new Promise((resolve) => {
      this.resolveResult = resolve;
    });
  }

  push(event: AssistantMessageEvent): void {
    if (this.done) return;
    if (event.type === 'done' || event.type === 'error') {
      this.done = true;
      const finalMessage = event.type === 'done' ? event.message : event.error;
      this.resolveResult(finalMessage);
    }
    const waiter = this.pending.shift();
    if (waiter) {
      waiter(event);
    } else {
      this.events.push(event);
    }
  }

  end(result?: AssistantMessage): void {
    this.done = true;
    if (result !== undefined) {
      this.resolveResult(result);
    }
    for (const waiter of this.pending) waiter(null);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
    while (true) {
      if (this.events.length > 0) {
        yield this.events.shift()!;
        continue;
      }
      if (this.done) return;
      const event = await new Promise<AssistantMessageEvent | null>((resolve) => {
        this.pending.push(resolve);
      });
      if (event === null) return;
      yield event;
    }
  }

  result(): Promise<AssistantMessage> {
    return this.resultPromise;
  }
}

export function createMockProvider(config: MockProviderConfig): Provider {
  const model: Model<any> = {
    id: 'mock-model',
    name: 'mock-model',
    api: 'openai-completions',
    provider: config.name,
    baseUrl: '',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  };

  const defaultAssistantMessage = (): AssistantMessage => ({
    role: 'assistant',
    api: 'openai-completions',
    provider: config.name,
    model: 'mock-model',
    content: [{ type: 'text', text: 'Hello' }],
    usage: { input: 3, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 6, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop',
    timestamp: Date.now(),
  });

  const createErrorMessage = (message: string): AssistantMessage => ({
    ...defaultAssistantMessage(),
    stopReason: 'error',
    errorMessage: message,
  });

  return {
    id: config.name,
    name: config.name,
    auth: {
      apiKey: { resolve: () => ({ type: 'apiKey', apiKey: 'fake-key', source: 'env' }) },
      oauth: undefined as any,
    },
    getModels: () => [model],
    stream: (_model: Model<any>, _context: { messages: Message[] }, _options?: any): AssistantMessageEventStream => {
      const eventStream = new MockEventStream();

      if (config.error) {
        const errorMessage = createErrorMessage(config.error.message);
        eventStream.push({ type: 'error', reason: 'error', error: errorMessage });
        eventStream.end(errorMessage);
      } else if (config.stream) {
        (async () => {
          try {
            for await (const event of config.stream!()) {
              eventStream.push(event);
            }
            const message = config.complete ? await config.complete() : defaultAssistantMessage();
            eventStream.push({ type: 'done', reason: 'stop', message });
            eventStream.end(message);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const errorMessage = createErrorMessage(message);
            eventStream.push({ type: 'error', reason: 'error', error: errorMessage });
            eventStream.end(errorMessage);
          }
        })();
      } else {
        const message = config.complete ? config.complete() : defaultAssistantMessage();
        Promise.resolve(message).then((msg) => {
          eventStream.push({ type: 'done', reason: 'stop', message: msg });
          eventStream.end(msg);
        });
      }

      return eventStream as unknown as AssistantMessageEventStream;
    },
    complete: async (_model: Model<any>, _context: { messages: Message[] }, _options?: any): Promise<AssistantMessage> => {
      return config.complete ? config.complete() : defaultAssistantMessage();
    },
    streamSimple: (_model: Model<any>, _context: any, _options?: any) => {
      throw new Error('not implemented');
    },
    completeSimple: async (_model: Model<any>, _context: any, _options?: any) => {
      throw new Error('not implemented');
    },
  } as Provider;
}

export function createMockModels(config?: MockProviderConfig): Models {
  const models = createCoreModels();
  if (config) {
    models.setProvider(createMockProvider(config));
  } else {
    models.setProvider(createMockProvider({ name: 'mock-default' }));
  }
  return models;
}

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
  const models = createMockModels(options.provider);

  const storageProvider = new SqliteStorageProvider({ dbPath: join(dir, 'rem-agent.db') });
  await storageProvider.init();
  const workspace = options.workspace ?? DEFAULT_WORKSPACE;
  await storageProvider.workspaceStore.add(workspace).catch(() => {});

  const configPath = join(dir, 'rem-agent.config.json');
  await writeFile(configPath, JSON.stringify({
    name: 'TestAgent',
    models: { default: { provider: options.provider?.name ?? 'mock-default', model: 'mock-model' } },
  }));

  const service = new AgentService({
    configPath,
    storageProvider,
    models,
    ...options.agentOptions,
  });

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

export async function* buildStreamFromChunks(chunks: AssistantMessageEvent[]): AsyncGenerator<AssistantMessageEvent> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

export const simpleTextStream = (): AsyncGenerator<AssistantMessageEvent> => {
  const partial: AssistantMessage = {
    role: 'assistant',
    api: 'openai-completions',
    provider: 'mock-default',
    model: 'mock-model',
    content: [{ type: 'text', text: 'Hello' }],
    usage: { input: 3, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 6, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop',
    timestamp: Date.now(),
  };
  return buildStreamFromChunks([
    { type: 'text_delta', contentIndex: 0, delta: 'Hello', partial },
    { type: 'done', reason: 'stop', message: partial },
  ]);
};

afterEach(() => {
  // No-op; mock models are created per-test.
});
