import type { SessionRuntime } from './runtime.js';

/** 保证同一 sessionId 的并发首次加载共享同一个 Runtime。 */
export class SessionRuntimeRegistry {
  private readonly pending = new Map<string, Promise<SessionRuntime>>();
  private readonly resolved = new Map<string, SessionRuntime>();

  get(sessionId: string): SessionRuntime | undefined {
    return this.resolved.get(sessionId);
  }

  getOrCreate(
    sessionId: string,
    load: () => Promise<SessionRuntime>,
  ): Promise<SessionRuntime> {
    const existing = this.pending.get(sessionId);
    if (existing) return existing;
    const created = load().then(
      (runtime) => {
        this.resolved.set(sessionId, runtime);
        return runtime;
      },
      (error) => {
        this.pending.delete(sessionId);
        throw error;
      },
    );
    this.pending.set(sessionId, created);
    return created;
  }

  remove(sessionId: string): void {
    this.pending.delete(sessionId);
    this.resolved.delete(sessionId);
  }
}
