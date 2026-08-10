import type { AgentRun, RunStatus, WorkItem } from '../../src/domain/run/types.js';
import type { RuntimeStorage } from '../../src/sdk/runtime-storage.js';
import type { RunExecutor } from '../../src/execution/run-executor.js';
import type { WorkerScheduler } from '../../src/execution/local-worker.js';
import { LocalRunWorker } from '../../src/execution/local-worker.js';
import { createFakeRuntimeStore } from './fake-runtime-store.js';

export const baseTime = new Date('2026-08-10T02:00:00.000Z');
export const at = (milliseconds: number): Date => new Date(baseTime.getTime() + milliseconds);

export async function fakeStore(): Promise<RuntimeStorage> {
  return (await createFakeRuntimeStore()).store;
}

export async function seedRun(storage: RuntimeStorage, changes: {
  runId?: string; sessionId?: string; tenantId?: string; status?: RunStatus;
  workStatus?: WorkItem['status']; leaseOwner?: string; leaseExpiresAt?: Date;
  cancellationRequestedAt?: Date; withRun?: boolean; withSession?: boolean; withWork?: boolean;
} = {}): Promise<void> {
  const runId = changes.runId ?? 'run-1';
  const sessionId = changes.sessionId ?? 'session-1';
  const tenantId = changes.tenantId ?? 'tenant-1';
  await storage.transaction((uow) => {
    if (changes.withSession !== false) uow.sessions.insert({
      sessionId, tenantId, contexts: { bindings: [] }, createdAt: baseTime, updatedAt: baseTime,
    });
    if (changes.withRun !== false) {
      const run: AgentRun = {
        runId, tenantId, principalId: 'user-1', sessionId, agentId: 'agent-1', agentRevision: '1',
        status: changes.status ?? 'queued', trigger: { type: 'task', input: null },
        contextSnapshot: { items: [], configLayers: [], promptSections: [] },
        ...(changes.cancellationRequestedAt ? { cancellationRequestedAt: changes.cancellationRequestedAt } : {}),
        createdAt: baseTime, updatedAt: baseTime,
      };
      uow.runs.insert(run);
      uow.events.append({
        eventId: `created-${runId}`, sequence: 1, schemaVersion: 1,
        tenantId, sessionId, runId, type: 'run.created', data: {}, occurredAt: baseTime,
      });
    }
    if (changes.withWork !== false) uow.workItems.insert({
      workItemId: `work-${runId}`, runId, status: changes.workStatus ?? 'queued',
      ...(changes.leaseOwner ? { leaseOwner: changes.leaseOwner } : {}),
      ...(changes.leaseExpiresAt ? { leaseExpiresAt: changes.leaseExpiresAt } : {}),
      attempt: changes.workStatus === 'leased' ? 1 : 0, createdAt: baseTime, updatedAt: baseTime,
    });
  });
}

export function createWorker(
  storage: RuntimeStorage,
  executor: RunExecutor,
  changes: Partial<ConstructorParameters<typeof LocalRunWorker>[2]> = {},
): LocalRunWorker {
  let id = 0;
  return new LocalRunWorker(storage, executor, {
    owner: 'worker-1', leaseMs: 1_000, pollMs: 10, runTimeoutMs: 5_000,
    now: () => baseTime, generateId: () => `generated-${++id}`, ...changes,
  });
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

export class ManualScheduler implements WorkerScheduler {
  private nextId = 0;
  private tasks = new Map<number, { callback: () => void; delayMs: number }>();
  readonly cleared: unknown[] = [];
  readonly scheduled: number[] = [];

  setTimeout(callback: () => void, delayMs: number): number {
    const id = ++this.nextId;
    this.tasks.set(id, { callback, delayMs });
    this.scheduled.push(delayMs);
    return id;
  }

  clearTimeout(handle: unknown): void { this.cleared.push(handle); this.tasks.delete(handle as number); }

  runDelay(delayMs: number): void {
    const found = [...this.tasks].find(([, task]) => task.delayMs === delayMs);
    if (!found) throw new Error(`No timer scheduled for ${delayMs}ms`);
    this.tasks.delete(found[0]);
    found[1].callback();
  }

  get pending(): number { return this.tasks.size; }
  get pendingDelays(): number[] { return [...this.tasks.values()].map(({ delayMs }) => delayMs); }
}

export const successResult = {
  sessionEntries: [{ message: { role: 'user' as const, content: 'done', timestamp: baseTime.getTime() } }],
  artifacts: [{ type: 'result', mediaType: 'text/plain', name: 'answer', data: 'done' }],
};
