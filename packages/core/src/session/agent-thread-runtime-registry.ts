import type { AgentThreadRuntime } from './agent-thread-runtime.js';

export class AgentThreadRuntimeRegistry {
  private readonly pending = new Map<string, Promise<AgentThreadRuntime>>();
  private readonly resolved = new Map<string, AgentThreadRuntime>();

  get(agentThreadId: string): AgentThreadRuntime | undefined { return this.resolved.get(agentThreadId); }

  register(runtime: AgentThreadRuntime): AgentThreadRuntime {
    this.resolved.set(runtime.thread.agentThreadId, runtime);
    this.pending.set(runtime.thread.agentThreadId, Promise.resolve(runtime));
    return runtime;
  }

  getOrCreate(agentThreadId: string, load: () => Promise<AgentThreadRuntime>): Promise<AgentThreadRuntime> {
    const existing = this.pending.get(agentThreadId);
    if (existing) return existing;
    const created = load().then((runtime) => {
      this.resolved.set(agentThreadId, runtime);
      return runtime;
    }, (error) => {
      this.pending.delete(agentThreadId);
      throw error;
    });
    this.pending.set(agentThreadId, created);
    return created;
  }

  values(): AgentThreadRuntime[] { return [...this.resolved.values()]; }
  interruptAll(): void { this.resolved.forEach((runtime) => runtime.interrupt()); }
}
