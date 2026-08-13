import type { RuntimeRequestContext } from '../../domain/identity/types.js';
import { RuntimeError } from './runtime-error.js';
import { ScopedAgentRuntimeImpl } from './scoped-agent-runtime.js';
import type { AgentRuntime, AgentRuntimeDeps, ScopedAgentRuntime } from './types.js';

type LifecycleState = 'created' | 'ready' | 'shutdown';

const DEFAULT_WAIT_POLL_MS = 100;

export class AgentRuntimeImpl implements AgentRuntime {
  private state: LifecycleState = 'created';

  constructor(private readonly deps: AgentRuntimeDeps) {}

  async initialize(): Promise<void> {
    if (this.state === 'ready') return;
    if (this.state === 'shutdown') throw new RuntimeError('INVALID_INPUT', 'AgentRuntime has been shut down');
    await this.deps.agentDefinitions.init();
    this.deps.worker.start();
    this.state = 'ready';
  }

  async shutdown(): Promise<void> {
    if (this.state === 'shutdown') return;
    this.state = 'shutdown';
    await this.deps.worker.stop();
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
    });
  }

  private ensureReady(): void {
    if (this.state !== 'ready') {
      throw new RuntimeError('INVALID_INPUT', 'AgentRuntime is not initialized');
    }
  }
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
