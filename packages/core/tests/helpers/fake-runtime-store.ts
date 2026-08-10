import type { Artifact } from '../../src/domain/artifact/types.js';
import type { RunEvent } from '../../src/domain/event/types.js';
import type { AgentRun, ToolInvocation, WorkItem } from '../../src/domain/run/types.js';
import type { AgentSession, RuntimeSessionEntry } from '../../src/domain/session/types.js';
import type { IdempotencyRecord, RuntimeStorage, RuntimeUnitOfWork } from '../../src/sdk/runtime-storage.js';
import { RuntimeError } from '../../src/application/runtime/runtime-error.js';

interface State {
  sessions: Map<string, AgentSession>;
  entries: Map<string, RuntimeSessionEntry[]>;
  runs: Map<string, AgentRun>;
  events: Map<string, RunEvent[]>;
  workItems: Map<string, WorkItem>;
  workItemByRun: Map<string, string>;
  artifacts: Map<string, Artifact>;
  idempotency: Map<string, IdempotencyRecord>;
  toolInvocations: Map<string, ToolInvocation>;
}

const clone = <T>(value: T): T => structuredClone(value);
const conflict = (message: string): never => { throw new RuntimeError('STORAGE_CONFLICT', message); };
const invalid = (message: string): never => { throw new RuntimeError('INVALID_INPUT', message); };
const idempotencyKey = (tenantId: string, operation: string, key: string): string => JSON.stringify([tenantId, operation, key]);
const compareWork = (left: WorkItem, right: WorkItem): number => left.createdAt.getTime() - right.createdAt.getTime() || left.workItemId.localeCompare(right.workItemId);
const isPromise = (value: unknown): value is Promise<unknown> => typeof value === 'object' && value !== null && 'then' in value && typeof (value as { then?: unknown }).then === 'function';

function emptyState(): State {
  return { sessions: new Map(), entries: new Map(), runs: new Map(), events: new Map(), workItems: new Map(), workItemByRun: new Map(), artifacts: new Map(), idempotency: new Map(), toolInvocations: new Map() };
}

function createUnitOfWork(state: State): RuntimeUnitOfWork {
  return {
    sessions: {
      insert(session) { if (state.sessions.has(session.sessionId)) conflict('Session already exists'); state.sessions.set(session.sessionId, clone(session)); },
      get(sessionId) { const session = state.sessions.get(sessionId); return session ? clone(session) : null; },
      appendEntries(entries) {
        const known = new Set([...state.entries.values()].flat().map((entry) => `${entry.sessionId}:${entry.sequence}`));
        const ids = new Set<string>();
        for (const entry of entries) {
          const sequenceKey = `${entry.sessionId}:${entry.sequence}`;
          if (known.has(sequenceKey) || ids.has(entry.entryId) || [...state.entries.values()].flat().some((item) => item.entryId === entry.entryId)) conflict('Session entry already exists');
          known.add(sequenceKey); ids.add(entry.entryId);
        }
        for (const entry of entries) state.entries.set(entry.sessionId, [...(state.entries.get(entry.sessionId) ?? []), clone(entry)]);
      },
      listEntries(sessionId) { return clone([...(state.entries.get(sessionId) ?? [])].sort((left, right) => left.sequence - right.sequence)); },
    },
    runs: {
      insert(run) { if (state.runs.has(run.runId)) conflict('Run already exists'); state.runs.set(run.runId, clone(run)); },
      get(runId) { const run = state.runs.get(runId); return run ? clone(run) : null; },
      update(run) { if (!state.runs.has(run.runId)) conflict('Run does not exist'); state.runs.set(run.runId, clone(run)); },
    },
    events: {
      append(event) {
        const all = [...state.events.values()].flat();
        if (all.some((item) => item.eventId === event.eventId || item.runId === event.runId && item.sequence === event.sequence)) conflict('Event already exists');
        state.events.set(event.runId, [...(state.events.get(event.runId) ?? []), clone(event)]);
      },
      nextSequence(runId) { const events = state.events.get(runId) ?? []; return events.length === 0 ? 1 : Math.max(...events.map((event) => event.sequence)) + 1; },
      list(runId, afterSequence, limit) { if (limit <= 0) invalid('Event limit must be positive'); return clone((state.events.get(runId) ?? []).filter((event) => event.sequence > afterSequence).sort((left, right) => left.sequence - right.sequence).slice(0, limit)); },
    },
    workItems: {
      insert(item) { if (state.workItems.has(item.workItemId) || state.workItemByRun.has(item.runId)) conflict('Work item already exists'); state.workItems.set(item.workItemId, clone(item)); state.workItemByRun.set(item.runId, item.workItemId); },
      getByRun(runId) { const item = state.workItems.get(state.workItemByRun.get(runId) ?? ''); return item ? clone(item) : null; },
      update(item) {
        const previous = state.workItems.get(item.workItemId);
        if (!previous) conflict('Work item does not exist');
        const existing = state.workItemByRun.get(item.runId);
        if (existing && existing !== item.workItemId) conflict('Run already has a work item');
        if (previous.runId !== item.runId) state.workItemByRun.delete(previous.runId);
        state.workItems.set(item.workItemId, clone(item)); state.workItemByRun.set(item.runId, item.workItemId);
      },
    },
    artifacts: {
      insert(artifact) { if (state.artifacts.has(artifact.artifactId)) conflict('Artifact already exists'); state.artifacts.set(artifact.artifactId, clone(artifact)); },
      listByRun(runId) { return clone([...state.artifacts.values()].filter((artifact) => artifact.runId === runId)); },
    },
    idempotency: {
      get(tenantId, operation, key) { const record = state.idempotency.get(idempotencyKey(tenantId, operation, key)); return record ? clone(record) : null; },
      insert(record) { const key = idempotencyKey(record.tenantId, record.operation, record.idempotencyKey); if (state.idempotency.has(key)) conflict('Idempotency record already exists'); state.idempotency.set(key, clone(record)); },
    },
    toolInvocations: {
      insert(invocation) { if (state.toolInvocations.has(invocation.invocationId)) conflict('Tool invocation already exists'); state.toolInvocations.set(invocation.invocationId, clone(invocation)); },
      get(invocationId) { const invocation = state.toolInvocations.get(invocationId); return invocation ? clone(invocation) : null; },
      update(invocation) { if (!state.toolInvocations.has(invocation.invocationId)) conflict('Tool invocation does not exist'); state.toolInvocations.set(invocation.invocationId, clone(invocation)); },
      listByRun(runId) { return clone([...state.toolInvocations.values()].filter((invocation) => invocation.runId === runId)); },
    },
  };
}

class FakeRuntimeStore implements RuntimeStorage {
  private state = emptyState();
  private tail = Promise.resolve();

  async transaction<T>(operation: (uow: RuntimeUnitOfWork) => T): Promise<T> {
    return this.lock(() => {
      const next = clone(this.state);
      const result = operation(createUnitOfWork(next));
      if (isPromise(result)) invalid('RuntimeStorage transaction callback must be synchronous');
      this.state = next;
      return result;
    });
  }

  async getSession(sessionId: string): Promise<AgentSession | null> { const session = this.state.sessions.get(sessionId); return session ? clone(session) : null; }
  async getRun(runId: string): Promise<AgentRun | null> { const run = this.state.runs.get(runId); return run ? clone(run) : null; }
  async listEvents(runId: string, afterSequence = 0, limit = 100): Promise<RunEvent[]> { return createUnitOfWork(this.state).events.list(runId, afterSequence, limit); }
  async listArtifacts(runId: string): Promise<Artifact[]> { return createUnitOfWork(this.state).artifacts.listByRun(runId); }

  async claimWorkItem(owner: string, now: Date, leaseMs: number): Promise<WorkItem | null> {
    if (!owner) invalid('Lease owner is required'); if (leaseMs <= 0) invalid('Lease duration must be positive');
    return this.lock(() => {
      const item = [...this.state.workItems.values()].filter((candidate) => candidate.status === 'queued' || candidate.status === 'leased' && (candidate.leaseExpiresAt?.getTime() ?? Infinity) <= now.getTime()).sort(compareWork)[0];
      if (!item) return null;
      const claimed: WorkItem = { ...item, status: 'leased', leaseOwner: owner, leaseExpiresAt: new Date(now.getTime() + leaseMs), attempt: item.attempt + 1, updatedAt: clone(now) };
      this.state.workItems.set(claimed.workItemId, claimed);
      return clone(claimed);
    });
  }

  async listRecoverableWorkItems(now: Date): Promise<WorkItem[]> {
    return clone([...this.state.workItems.values()].filter((item) => item.status === 'queued' || item.status === 'leased' && (item.leaseExpiresAt?.getTime() ?? Infinity) <= now.getTime()).sort(compareWork));
  }

  private async lock<T>(operation: () => T): Promise<T> {
    const previous = this.tail;
    let release: (() => void) | undefined;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return operation(); } finally { release!(); }
  }
}

export async function createFakeRuntimeStore(): Promise<{ store: RuntimeStorage; close(): Promise<void> }> {
  return { store: new FakeRuntimeStore(), close: async () => {} };
}
