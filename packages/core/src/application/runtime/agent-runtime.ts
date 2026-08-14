import type { RuntimeRequestContext } from '../../domain/identity/types.js';
import { RuntimeError } from './runtime-error.js';
import { ScopedAgentRuntimeImpl } from './scoped-agent-runtime.js';
import type { AgentRuntime, AgentRuntimeDeps, ScopedAgentRuntime } from './types.js';
import type { RuntimeHealth } from '../../sdk/runtime-health.js';

type LifecycleState = 'created' | 'ready' | 'shutdown';

const DEFAULT_WAIT_POLL_MS = 100;

export class AgentRuntimeImpl implements AgentRuntime {
  private state: LifecycleState = 'created';

  constructor(private readonly deps: AgentRuntimeDeps) {}

  async initialize(): Promise<void> {
    if (this.state === 'ready') return;
    if (this.state === 'shutdown') throw new RuntimeError('INVALID_INPUT', 'AgentRuntime has been shut down');
    await this.deps.agentDefinitions.init();
    if (this.isShutdown()) return;
    // 恢复审计必须在 Worker start 前完成，否则崩溃残留的 running Run 会被直接判失败。
    await this.deps.worker.recover();
    if (this.isShutdown()) return;
    this.deps.worker.start();
    if (this.isShutdown()) {
      await this.deps.worker.stop();
      return;
    }
    this.state = 'ready';
  }

  async shutdown(): Promise<void> {
    if (this.state === 'shutdown') return;
    this.state = 'shutdown';
    await this.deps.worker.stop();
  }

  async health(): Promise<RuntimeHealth> {
    const checkedAt = new Date();
    if (this.state === 'shutdown') return { status: 'stopped', checkedAt, checks: { runtime: 'stopped', storage: 'unknown', worker: 'stopped' } };
    if (this.state !== 'ready') return { status: 'degraded', checkedAt, checks: { runtime: 'not-ready', storage: 'unknown', worker: 'stopped' } };
    let storage: 'ok' | 'error' | 'unknown' = 'unknown';
    let errorCode: RuntimeHealth['errorCode'];
    if (this.deps.checkStorageHealth) {
      try { await this.deps.checkStorageHealth(); storage = 'ok'; }
      catch (error) { storage = 'error'; errorCode = error instanceof RuntimeError ? error.code : 'STORAGE_UNAVAILABLE'; }
    }
    const worker = this.deps.worker.isRunning ? 'running' : 'stopped';
    const ready = (storage === 'ok' || storage === 'unknown') && worker === 'running';
    return { status: ready ? 'ready' : 'degraded', checkedAt,
      checks: { runtime: 'ready', storage, worker }, ...(errorCode === undefined ? {} : { errorCode }) };
  }

  as(context: RuntimeRequestContext): ScopedAgentRuntime {
    this.ensureReady();
    validateContext(context);
    return new ScopedAgentRuntimeImpl({
      context: {
        tenantId: context.tenantId.trim(),
        principal: { ...context.principal, principalId: context.principal.principalId.trim() },
      },
      ensureReady: () => this.ensureReady(),
      storage: this.deps.storage,
      agentDefinitions: this.deps.agentDefinitions,
      startRun: this.deps.startRun,
      worker: this.deps.worker,
      signals: this.deps.signals,
      waitPollMs: this.deps.waitPollMs ?? DEFAULT_WAIT_POLL_MS,
      observe: this.deps.observe,
    });
  }

  private ensureReady(): void {
    if (this.state !== 'ready') {
      throw new RuntimeError('INVALID_INPUT', 'AgentRuntime is not initialized');
    }
  }

  private isShutdown(): boolean { return this.state === 'shutdown'; }
}

function validateContext(context: RuntimeRequestContext): void {
  if (!context || typeof context.tenantId !== 'string' || !context.tenantId.trim()) {
    throw new RuntimeError('INVALID_INPUT', 'RuntimeRequestContext tenantId must be a non-empty string');
  }
  const principalId = context.principal?.principalId;
  if (typeof principalId !== 'string' || !principalId.trim()) {
    throw new RuntimeError('INVALID_INPUT', 'RuntimeRequestContext principal.principalId must be a non-empty string');
  }
}
