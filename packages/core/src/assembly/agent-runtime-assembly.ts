import { ContextResolver } from '../application/contexts/context-resolver.js';
import { AgentRuntimeImpl } from '../application/runtime/agent-runtime.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';
import { StartRunUsecase } from '../application/runs/start-run.js';
import type { AgentRuntime, ScopedAgentRuntime } from '../application/runtime/types.js';
import type { RuntimeRequestContext } from '../domain/identity/types.js';
import { LocalRunWorker } from '../execution/local-worker.js';
import { REMAgentRunExecutor } from '../execution/rem-agent-executor.js';
import { RuntimePluginHost } from '../plugin-system/runtime-plugin-host.js';
import type { AgentDefinitionProvider } from '../sdk/agent-definition-provider.js';
import type { RuntimePlugin } from '../sdk/runtime-plugin.js';
import type { StorageProvider } from '../sdk/storage-provider.js';
import { RunSignalHub } from '../runtime-events/run-signal-hub.js';
import { createAgentAssembly } from './agent-assembly.js';
import { initializeAgentDI } from './agent-context-assembler.js';
import type { AgentAssembly } from './types.js';

export interface CreateAgentRuntimeOptions {
  agentDefinitions: AgentDefinitionProvider;
  plugins?: readonly RuntimePlugin[];
  storage?: StorageProvider;
  assembly?: AgentAssembly;
  worker?: { owner?: string; leaseMs?: number; pollMs?: number; runTimeoutMs?: number };
}

const DEFAULT_WORKER_OWNER = 'agent-runtime-worker';
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_POLL_MS = 1_000;
const DEFAULT_RUN_TIMEOUT_MS = 300_000;

/**
 * 同步装配 AgentRuntime；调用方须显式执行 initialize()。
 * Storage 缺省时复用 assembly 的 Storage；assembly 也缺省时按环境创建默认装配
 * （默认 SQLite + 内置模型注册表）。仅 Runtime 自建的默认 Storage 会在 shutdown 时关闭。
 */
export function createAgentRuntime(options: CreateAgentRuntimeOptions): AgentRuntime {
  if (!options || typeof options.agentDefinitions !== 'object' || options.agentDefinitions === null) {
    throw new RuntimeError('INVALID_INPUT', 'An AgentDefinitionProvider is required');
  }
  const assembly = options.assembly ?? createAgentAssembly();
  const storage = options.storage ?? assembly.di.storage;
  // 只有 Runtime 内部创建的 assembly 的 Storage 归 Runtime 所有；注入的均归调用方。
  const ownedStorages = options.assembly ? [] : [assembly.di.storage];
  const agentDefinitions = options.agentDefinitions;

  const pluginHost = new RuntimePluginHost(options.plugins ?? []);
  const contextResolver = new ContextResolver(pluginHost);
  const startRun = new StartRunUsecase({ storage: storage.runtimeStore, agentDefinitions, contextResolver });
  const executor = new REMAgentRunExecutor({
    assembly, agentDefinitions, storage: storage.runtimeStore, pluginHost,
  });
  const signals = new RunSignalHub();
  const worker = new LocalRunWorker(storage.runtimeStore, executor, {
    owner: options.worker?.owner ?? DEFAULT_WORKER_OWNER,
    leaseMs: options.worker?.leaseMs ?? DEFAULT_LEASE_MS,
    pollMs: options.worker?.pollMs ?? DEFAULT_POLL_MS,
    runTimeoutMs: options.worker?.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
    onEventCommitted: (event) => signals.publishEvent(event),
  });
  const inner = new AgentRuntimeImpl({
    storage: storage.runtimeStore, agentDefinitions, startRun, worker, signals,
  });
  return new AssembledAgentRuntime(assembly, inner, ownedStorages);
}

/** 按环境默认装配并完成旧 AgentAssembly 初始化与 Runtime 初始化。 */
export async function createAgentRuntimeFromEnv(options: CreateAgentRuntimeOptions): Promise<AgentRuntime> {
  const runtime = createAgentRuntime(options);
  try {
    await runtime.initialize();
  } catch (error) {
    // 初始化中途失败时调用方拿不到句柄，必须 best-effort 释放自建 Storage；不掩盖原始错误。
    await runtime.shutdown().catch(() => {});
    throw error;
  }
  return runtime;
}

/** 在 AgentRuntimeImpl 之外补上旧 assembly 的异步初始化与自建 Storage 的关闭。 */
class AssembledAgentRuntime implements AgentRuntime {
  private state: 'created' | 'ready' | 'shutdown' = 'created';
  private initializing?: Promise<void>;

  constructor(
    private readonly assembly: AgentAssembly,
    private readonly inner: AgentRuntimeImpl,
    private readonly ownedStorages: readonly StorageProvider[],
  ) {}

  async initialize(): Promise<void> {
    if (this.state === 'ready') return;
    if (this.state === 'shutdown') throw new RuntimeError('INVALID_INPUT', 'AgentRuntime has been shut down');
    // 并发 initialize 共享同一 in-flight promise，避免交叠执行初始化。
    this.initializing ??= this._initialize().finally(() => { this.initializing = undefined; });
    return this.initializing;
  }

  private async _initialize(): Promise<void> {
    await initializeAgentDI(this.assembly.di);
    await this.inner.initialize();
    this.state = 'ready';
  }

  async shutdown(): Promise<void> {
    if (this.state === 'shutdown') return;
    this.state = 'shutdown';
    // Worker 停止失败也不能跳自建 Storage 的关闭；Worker 错误优先抛出。
    let failure: unknown;
    try { await this.inner.shutdown(); } catch (error) { failure = error; }
    for (const storage of this.ownedStorages) {
      try { await storage.close(); } catch (error) { failure ??= error; }
    }
    if (failure) throw failure;
  }

  as(context: RuntimeRequestContext): ScopedAgentRuntime {
    return this.inner.as(context);
  }
}
