import { join } from 'node:path';
import type { Models } from '@earendil-works/pi-ai';
import { ContextResolver } from '../application/contexts/context-resolver.js';
import { AgentRuntimeImpl } from '../application/runtime/agent-runtime.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';
import { StartRunUsecase } from '../application/runs/start-run.js';
import type { AgentRuntime, ScopedAgentRuntime } from '../application/runtime/types.js';
import type { RuntimeRequestContext } from '../domain/identity/types.js';
import { LocalRunWorker } from '../execution/local-worker.js';
import { SingleAgentRunExecutor } from '../execution/single-agent-run-executor.js';
import { TeamRunExecutor } from '../execution/team-run-executor.js';
import { RuntimeRunExecutor } from '../execution/runtime-run-executor.js';
import { RuntimePluginHost } from '../plugin-system/runtime-plugin-host.js';
import type { AgentDefinitionProvider } from '../sdk/agent-definition-provider.js';
import type { RuntimePlugin } from '../sdk/runtime-plugin.js';
import type { RuntimeConfigProvider } from '../sdk/runtime-config-provider.js';
import type { RuntimeStorageProvider } from '../sdk/runtime-storage-provider.js';
import type { RuntimeWorkerOptions } from '../sdk/runtime-worker.js';
import { RunSignalHub } from '../runtime-events/run-signal-hub.js';
import { createCoreModels } from '../infrastructure/llm/models.js';
import { createDefaultAgentPaths, type AgentPaths } from '../infrastructure/config/paths.js';
import { configureConsoleOutput } from '../infrastructure/observability/debug-log.js';
import { RuntimeObserverHub } from '../infrastructure/observability/runtime-observer-hub.js';
import { debugRuntimeObserver } from '../infrastructure/observability/debug-runtime-observer.js';
import type { RuntimeObserver } from '../sdk/runtime-observer.js';
import { configureFileDebugLog } from '../infrastructure/observability/debug-log-file.js';
import { DefaultRuntimeConfigProvider } from '../plugins/config/default/default-runtime-config-provider.js';
import { SqliteRuntimeStorageProvider } from '../plugins/storage/sqlite/runtime-provider.js';

export interface CreateAgentRuntimeOptions {
  agentDefinitions: AgentDefinitionProvider;
  plugins?: readonly RuntimePlugin[];
  storage?: RuntimeStorageProvider;
  config?: RuntimeConfigProvider;
  models?: Models;
  executionRoot?: string;
  paths?: AgentPaths;
  worker?: RuntimeWorkerOptions;
  observers?: readonly RuntimeObserver[];
}

const DEFAULT_WORKER_OWNER = 'agent-runtime-worker';
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_POLL_MS = 1_000;
const DEFAULT_RUN_TIMEOUT_MS = 300_000;

export function createAgentRuntime(options: CreateAgentRuntimeOptions): AgentRuntime {
  if (!options || typeof options.agentDefinitions !== 'object' || options.agentDefinitions === null) {
    throw new RuntimeError('INVALID_INPUT', 'An AgentDefinitionProvider is required');
  }
  if (options.observers !== undefined && !Array.isArray(options.observers)) {
    throw new RuntimeError('INVALID_INPUT', 'Runtime observers must be an array');
  }
  const observerHub = new RuntimeObserverHub([debugRuntimeObserver, ...(options.observers ?? [])]);
  const observe = observerHub.sink();
  const paths = options.paths ?? createDefaultAgentPaths();
  const config = options.config ?? new DefaultRuntimeConfigProvider({ paths });
  const storage = options.storage ?? new SqliteRuntimeStorageProvider({ dbPath: join(paths.agentDir, 'rem-agent.db') });
  validateStorageProvider(storage);
  const models = options.models ?? createCoreModels({ all: true });
  // Freeze the root at construction time; never resolve it from a later process.cwd() call.
  const executionRoot = options.executionRoot ?? process.cwd();
  configureFileDebugLog(paths.debugLogFile);
  if (paths.debugLogFile && process.env.NODE_ENV === 'development') configureConsoleOutput(true);
  const pluginHost = new RuntimePluginHost(options.plugins ?? []);
  const contextResolver = new ContextResolver(pluginHost);
  const startRun = new StartRunUsecase({ storage: storage.runtimeStore, agentDefinitions: options.agentDefinitions, contextResolver });
  const single = new SingleAgentRunExecutor({
    models, config, executionRoot,
    agentDefinitions: options.agentDefinitions, storage: storage.runtimeStore, pluginHost, observe,
  });
  const executor = new RuntimeRunExecutor(single, new TeamRunExecutor({
    models, config, executionRoot,
    agentDefinitions: options.agentDefinitions, storage: storage.runtimeStore, pluginHost, observe,
  }));
  const signals = new RunSignalHub();
  const worker = new LocalRunWorker(storage.runtimeStore, executor, {
    owner: options.worker?.owner ?? DEFAULT_WORKER_OWNER,
    leaseMs: options.worker?.leaseMs ?? DEFAULT_LEASE_MS,
    pollMs: options.worker?.pollMs ?? DEFAULT_POLL_MS,
    runTimeoutMs: options.worker?.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
    onEventCommitted: (event) => signals.publishEvent(event),
    onSignal: (signal) => signals.publish(signal),
    onObservation: observe,
  });
  const inner = new AgentRuntimeImpl({
    storage: storage.runtimeStore, agentDefinitions: options.agentDefinitions, startRun, worker, signals, observe,
    checkStorageHealth: () => storage.checkHealth(),
  });
  return new AssembledAgentRuntime(config, inner, storage, options.storage ? [] : [storage], observe);
}

function validateStorageProvider(value: RuntimeStorageProvider): void {
  if (!value || typeof value !== 'object'
    || typeof value.init !== 'function' || typeof value.close !== 'function'
    || typeof value.checkHealth !== 'function' || !value.runtimeStore) {
    throw new RuntimeError('INVALID_INPUT', 'RuntimeStorageProvider must expose init, close, checkHealth and runtimeStore');
  }
}

export async function createAgentRuntimeFromEnv(options: CreateAgentRuntimeOptions): Promise<AgentRuntime> {
  const runtime = createAgentRuntime(options);
  try {
    await runtime.initialize();
  } catch (error) {
    await runtime.shutdown().catch(() => {});
    throw error;
  }
  return runtime;
}

class AssembledAgentRuntime implements AgentRuntime {
  private state: 'created' | 'ready' | 'shutdown' = 'created';
  private initializing?: Promise<void>;
  private shuttingDown?: Promise<void>;

  constructor(
    private readonly config: RuntimeConfigProvider,
    private readonly inner: AgentRuntimeImpl,
    private readonly storage: RuntimeStorageProvider,
    private readonly ownedStorages: readonly RuntimeStorageProvider[],
    private readonly observe: (event: import('../sdk/runtime-observer.js').RuntimeObservation) => void,
  ) {}

  async initialize(): Promise<void> {
    if (this.state === 'ready') return;
    if (this.state === 'shutdown') throw new RuntimeError('INVALID_INPUT', 'AgentRuntime has been shut down');
    this.initializing ??= this._initialize().finally(() => { this.initializing = undefined; });
    return this.initializing;
  }

  private async _initialize(): Promise<void> {
    this.observe({ type: 'runtime.initializing', occurredAt: new Date() });
    try {
      await this.config.init();
    // Give a concurrent shutdown a chance to win before opening an injected store.
    await Promise.resolve();
    if (this.isShutdown()) return;
    await this.storage.init();
    if (this.isShutdown()) return;
      await this.inner.initialize();
      if (this.isShutdown()) return;
      this.state = 'ready';
      this.observe({ type: 'runtime.ready', occurredAt: new Date() });
    } catch (error) {
      this.observe({ type: 'runtime.initialize.failed', occurredAt: new Date(), errorCode: error instanceof RuntimeError ? error.code : 'INTERNAL_ERROR' });
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return this.shuttingDown;
    if (this.state === 'shutdown') return;
    this.state = 'shutdown';
    this.shuttingDown = this._shutdown().finally(() => { this.shuttingDown = undefined; });
    return this.shuttingDown;
  }

  private async _shutdown(): Promise<void> {
    let failure: unknown;
    const initializing = this.initializing;
    if (initializing) {
      try { await initializing; } catch (error) { failure ??= error; }
    }
    try { await this.inner.shutdown(); } catch (error) { failure ??= error; }
    for (const storage of this.ownedStorages) {
      try { await storage.close(); } catch (error) { failure ??= error; }
    }
    this.observe({ type: 'runtime.shutdown', occurredAt: new Date() });
    if (failure) throw failure;
  }

  as(context: RuntimeRequestContext): ScopedAgentRuntime { return this.inner.as(context); }
  health() {
    if (this.state === 'shutdown') {
      return Promise.resolve({
        status: 'stopped' as const,
        checkedAt: new Date(),
        checks: { runtime: 'stopped' as const, storage: 'unknown' as const, worker: 'stopped' as const },
      });
    }
    return this.inner.health();
  }
  private isShutdown(): boolean { return this.state === 'shutdown'; }
}
