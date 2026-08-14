import type { Artifact } from '../../src/domain/artifact/types.js';
import type { RunEvent } from '../../src/domain/event/types.js';
import type { AgentRun, ToolInvocation, WorkItem } from '../../src/domain/run/types.js';
import type { RunExecutionEntry, RunExecutionNode, RunDelivery, RunExecutionBudget, RunListOptions, ExecutionEntryListOptions } from '../../src/domain/run/execution-models.js';
import type { AgentSession, RuntimeSessionEntry, RuntimeSessionSummary } from '../../src/domain/session/types.js';
import type { IdempotencyRecord, RuntimeStorage, RuntimeTransactionCallback, RuntimeUnitOfWork, SynchronousRuntimeTransactionCallback } from '../../src/sdk/runtime-storage.js';
import { RuntimeError } from '../../src/application/runtime/runtime-error.js';
import { decodeRunCursor } from '../../src/domain/run/run-cursor.js';

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
  toolInvocationByRunCall: Map<string, string>;
  executionNodes: Map<string, RunExecutionNode>;
  executionEntries: Map<string, RunExecutionEntry[]>;
  deliveries: Map<string, RunDelivery>;
  executionBudgets: Map<string, RunExecutionBudget>;
}

const clone = <T>(value: T): T => structuredClone(value);
const conflict = (message: string): never => { throw new RuntimeError('STORAGE_CONFLICT', message); };
const invalid = (message: string): never => { throw new RuntimeError('INVALID_INPUT', message); };
const idempotencyKey = (tenantId: string, operation: string, key: string): string => JSON.stringify([tenantId, operation, key]);
const toolCallKey = (runId: string, toolCallId: string, nodeId = 'root'): string => JSON.stringify([runId, nodeId, toolCallId]);
const compareWork = (left: WorkItem, right: WorkItem): number => {
  const timeOrder = left.createdAt.getTime() - right.createdAt.getTime();
  if (timeOrder) return timeOrder;
  return left.workItemId === right.workItemId ? 0 : left.workItemId < right.workItemId ? -1 : 1;
};
const isThenable = (value: unknown): value is PromiseLike<unknown> => (typeof value === 'object' && value !== null || typeof value === 'function') && typeof (value as { then?: unknown }).then === 'function';

function emptyState(): State {
  return { sessions: new Map(), entries: new Map(), runs: new Map(), events: new Map(), workItems: new Map(), workItemByRun: new Map(), artifacts: new Map(), idempotency: new Map(), toolInvocations: new Map(), toolInvocationByRunCall: new Map(), executionNodes: new Map(), executionEntries: new Map(), deliveries: new Map(), executionBudgets: new Map() };
}

function createUnitOfWork(state: State): RuntimeUnitOfWork {
  return {
    sessions: {
      insert(session) { if (state.sessions.has(session.sessionId)) conflict('Session already exists'); state.sessions.set(session.sessionId, clone(session)); },
      get(sessionId) { const session = state.sessions.get(sessionId); return session ? clone(session) : null; },
      listByTenant(tenantId) {
        return clone([...state.sessions.values()]
          .filter((session) => session.tenantId === tenantId)
          .sort((left, right) => {
            const timeOrder = right.updatedAt.getTime() - left.updatedAt.getTime();
            return timeOrder || left.sessionId.localeCompare(right.sessionId);
          })
          .map((session) => ({
            ...session,
            messageCount: (state.entries.get(session.sessionId) ?? [])
              .filter((entry) => entry.message.role === 'user' || entry.message.role === 'assistant').length,
          })));
      },
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
      nextEntrySequence(sessionId) {
        const entries = state.entries.get(sessionId) ?? [];
        return entries.length === 0 ? 1 : Math.max(...entries.map((entry) => entry.sequence)) + 1;
      },
      listEntries(sessionId) { return clone([...(state.entries.get(sessionId) ?? [])].sort((left, right) => left.sequence - right.sequence)); },
      update(session) { if (!state.sessions.has(session.sessionId)) conflict('Session does not exist'); state.sessions.set(session.sessionId, clone(session)); },
    },
    runs: {
      insert(run) { if (state.runs.has(run.runId)) conflict('Run already exists'); state.runs.set(run.runId, clone(run)); },
      get(runId) { const run = state.runs.get(runId); return run ? clone(run) : null; },
      update(run) { if (!state.runs.has(run.runId)) conflict('Run does not exist'); state.runs.set(run.runId, clone(run)); },
      listByTenant(tenantId, options = {}) {
        let runs = [...state.runs.values()].filter((run) => run.tenantId === tenantId);
        if (options.sessionId) runs = runs.filter((run) => run.sessionId === options.sessionId);
        if (options.status) runs = runs.filter((run) => run.status === options.status);
        runs.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.runId.localeCompare(left.runId));
        if (options.cursor) {
          const cursor = decodeRunCursor(options.cursor);
          runs = runs.filter((run) => run.createdAt.toISOString() < cursor.createdAt
            || run.createdAt.toISOString() === cursor.createdAt && run.runId < cursor.runId);
        }
        return clone(runs.slice(0, options.limit ?? 100));
      },
    },
    events: {
      append(event) {
        const all = [...state.events.values()].flat();
        if (all.some((item) => item.eventId === event.eventId || item.runId === event.runId && item.sequence === event.sequence)) conflict('Event already exists');
        state.events.set(event.runId, [...(state.events.get(event.runId) ?? []), clone(event)]);
      },
      nextSequence(runId) { const events = state.events.get(runId) ?? []; return events.length === 0 ? 1 : Math.max(...events.map((event) => event.sequence)) + 1; },
      list(runId, afterSequence, limit) {
        if (!Number.isFinite(afterSequence) || !Number.isInteger(afterSequence) || afterSequence < 0) invalid('Event cursor must be a non-negative integer');
        if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit <= 0) invalid('Event limit must be a positive integer');
        return clone((state.events.get(runId) ?? []).filter((event) => event.sequence > afterSequence).sort((left, right) => left.sequence - right.sequence).slice(0, limit));
      },
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
      insert(invocation) {
        const key = toolCallKey(invocation.runId, invocation.toolCallId, invocation.nodeId);
        if (state.toolInvocations.has(invocation.invocationId) || state.toolInvocationByRunCall.has(key)) conflict('Tool invocation already exists');
        state.toolInvocations.set(invocation.invocationId, clone(invocation)); state.toolInvocationByRunCall.set(key, invocation.invocationId);
      },
      get(invocationId) { const invocation = state.toolInvocations.get(invocationId); return invocation ? clone(invocation) : null; },
      getByRunAndCall(runId, toolCallId, nodeId) {
        const direct = nodeId === undefined ? undefined : state.toolInvocationByRunCall.get(toolCallKey(runId, toolCallId, nodeId));
        const invocationId = nodeId === undefined
          ? [...state.toolInvocations.values()].find((item) => item.runId === runId && item.toolCallId === toolCallId)?.invocationId
          : direct;
        const invocation = invocationId ? state.toolInvocations.get(invocationId) : undefined;
        return invocation ? clone(invocation) : null;
      },
      update(invocation) {
        const previous = state.toolInvocations.get(invocation.invocationId);
        if (!previous) conflict('Tool invocation does not exist');
        const key = toolCallKey(invocation.runId, invocation.toolCallId, invocation.nodeId);
        const existing = state.toolInvocationByRunCall.get(key);
        if (existing && existing !== invocation.invocationId) conflict('Tool invocation already exists');
        const previousKey = toolCallKey(previous.runId, previous.toolCallId, previous.nodeId);
        if (previousKey !== key) state.toolInvocationByRunCall.delete(previousKey);
        state.toolInvocations.set(invocation.invocationId, clone(invocation)); state.toolInvocationByRunCall.set(key, invocation.invocationId);
      },
      listByRun(runId) { return clone([...state.toolInvocations.values()].filter((invocation) => invocation.runId === runId)); },
    },
    executionNodes: {
      insert(node) { if (state.executionNodes.has(node.nodeId)) conflict('Execution node already exists'); state.executionNodes.set(node.nodeId, clone(node)); },
      get(nodeId) { const node = state.executionNodes.get(nodeId); return node ? clone(node) : null; },
      listByRun(runId) { return clone([...state.executionNodes.values()].filter((node) => node.runId === runId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.nodeId.localeCompare(b.nodeId))); },
      update(node) { if (!state.executionNodes.has(node.nodeId)) conflict('Execution node does not exist'); state.executionNodes.set(node.nodeId, clone(node)); },
    },
    executionEntries: {
      append(entry) {
        const entries = state.executionEntries.get(entry.runId) ?? [];
        if (entries.some((item) => item.entryId === entry.entryId || item.sequence === entry.sequence)) conflict('Execution entry already exists');
        state.executionEntries.set(entry.runId, [...entries, clone(entry)]);
      },
      get(entryId) {
        const entry = [...state.executionEntries.values()].flat().find((candidate) => candidate.entryId === entryId);
        return entry ? clone(entry) : null;
      },
      nextSequence(runId) { const entries = state.executionEntries.get(runId) ?? []; return entries.length === 0 ? 1 : Math.max(...entries.map((entry) => entry.sequence)) + 1; },
      listByRun(runId, afterSequence, limit) { return clone((state.executionEntries.get(runId) ?? []).filter((entry) => entry.sequence > afterSequence).sort((a, b) => a.sequence - b.sequence).slice(0, limit)); },
      listByNode(runId, nodeId, afterSequence, limit) { return clone((state.executionEntries.get(runId) ?? []).filter((entry) => entry.nodeId === nodeId && entry.sequence > afterSequence).sort((a, b) => a.sequence - b.sequence).slice(0, limit)); },
    },
    deliveries: {
      insert(delivery) {
        if (state.deliveries.has(delivery.deliveryId)) conflict('Delivery already exists');
        if ([...state.deliveries.values()].some((candidate) => candidate.runId === delivery.runId
          && candidate.kind === delivery.kind && candidate.batchId === delivery.batchId && candidate.nodeId === delivery.nodeId)) {
          conflict('Delivery batch target already exists');
        }
        state.deliveries.set(delivery.deliveryId, clone(delivery));
      },
      get(deliveryId) { const delivery = state.deliveries.get(deliveryId); return delivery ? clone(delivery) : null; },
      listByRun(runId) { return clone([...state.deliveries.values()].filter((delivery) => delivery.runId === runId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.deliveryId.localeCompare(b.deliveryId))); },
      listByBatch(runId, batchId) { return clone([...state.deliveries.values()].filter((delivery) => delivery.runId === runId && delivery.batchId === batchId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.deliveryId.localeCompare(b.deliveryId))); },
      listByNode(runId, nodeId) { return clone([...state.deliveries.values()].filter((delivery) => delivery.runId === runId && delivery.nodeId === nodeId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.deliveryId.localeCompare(b.deliveryId))); },
      claimQueued(runId, deliveryId, now) {
        const current = state.deliveries.get(deliveryId);
        if (!current || current.runId !== runId || current.status !== 'queued') return null;
        const claimed = { ...current, status: 'running' as const, attempt: current.attempt + 1, updatedAt: clone(now) };
        state.deliveries.set(deliveryId, clone(claimed));
        return clone(claimed);
      },
      update(delivery) {
        if (!state.deliveries.has(delivery.deliveryId)) conflict('Delivery does not exist');
        if ([...state.deliveries.values()].some((candidate) => candidate.deliveryId !== delivery.deliveryId
          && candidate.runId === delivery.runId && candidate.kind === delivery.kind
          && candidate.batchId === delivery.batchId && candidate.nodeId === delivery.nodeId)) conflict('Delivery batch target already exists');
        state.deliveries.set(delivery.deliveryId, clone(delivery));
      },
    },
    executionBudgets: {
      insert(budget) { if (state.executionBudgets.has(budget.runId)) conflict('Execution budget already exists'); state.executionBudgets.set(budget.runId, clone(budget)); },
      get(runId) { const budget = state.executionBudgets.get(runId); return budget ? clone(budget) : null; },
      update(budget) { if (!state.executionBudgets.has(budget.runId)) conflict('Execution budget does not exist'); state.executionBudgets.set(budget.runId, clone(budget)); },
    },
  };
}

class FakeRuntimeStore implements RuntimeStorage {
  private state = emptyState();
  private tail = Promise.resolve();

  async transaction<T extends RuntimeTransactionCallback>(
    operation: SynchronousRuntimeTransactionCallback<T>,
  ): Promise<ReturnType<T>> {
    return this.lock(() => {
      const next = clone(this.state);
      const result = operation(createUnitOfWork(next));
      if (isThenable(result)) { void Promise.resolve(result).catch(() => {}); invalid('RuntimeStorage transaction callback must be synchronous'); }
      this.state = next;
      return result;
    });
  }

  async getSession(sessionId: string): Promise<AgentSession | null> { const session = this.state.sessions.get(sessionId); return session ? clone(session) : null; }
  async listSessions(tenantId: string): Promise<RuntimeSessionSummary[]> { return createUnitOfWork(this.state).sessions.listByTenant(tenantId); }
  async listSessionEntries(sessionId: string): Promise<RuntimeSessionEntry[]> { return createUnitOfWork(this.state).sessions.listEntries(sessionId); }
  async getRun(runId: string): Promise<AgentRun | null> { const run = this.state.runs.get(runId); return run ? clone(run) : null; }
  async listRuns(tenantId: string, options?: RunListOptions): Promise<AgentRun[]> { return createUnitOfWork(this.state).runs.listByTenant(tenantId, options); }
  async listEvents(runId: string, afterSequence = 0, limit = 100): Promise<RunEvent[]> { return createUnitOfWork(this.state).events.list(runId, afterSequence, limit); }
  async listArtifacts(runId: string): Promise<Artifact[]> { return createUnitOfWork(this.state).artifacts.listByRun(runId); }
  async getArtifact(artifactId: string): Promise<Artifact | null> { const artifact = this.state.artifacts.get(artifactId); return artifact ? clone(artifact) : null; }
  async listExecutionNodes(runId: string): Promise<RunExecutionNode[]> { return createUnitOfWork(this.state).executionNodes.listByRun(runId); }
  async listExecutionEntries(runId: string, options: ExecutionEntryListOptions = {}): Promise<RunExecutionEntry[]> { return createUnitOfWork(this.state).executionEntries.listByRun(runId, options.afterSequence ?? 0, options.limit ?? 100); }
  async listDeliveries(runId: string): Promise<RunDelivery[]> { return createUnitOfWork(this.state).deliveries.listByRun(runId); }

  async claimWorkItem(owner: string, now: Date, leaseMs: number): Promise<WorkItem | null> {
    const leaseOwner = owner.trim();
    const expiresAt = new Date(now.getTime() + leaseMs);
    if (!leaseOwner) invalid('Lease owner is required');
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0 || !Number.isFinite(now.getTime()) || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) invalid('Lease duration must produce a valid expiry');
    return this.lock(() => {
      const item = [...this.state.workItems.values()].filter((candidate) => candidate.status === 'queued' || candidate.status === 'leased' && (candidate.leaseExpiresAt?.getTime() ?? Infinity) <= now.getTime()).sort(compareWork)[0];
      if (!item) return null;
      const claimed: WorkItem = { ...item, status: 'leased', leaseOwner, leaseExpiresAt: expiresAt, attempt: item.attempt + 1, updatedAt: clone(now) };
      this.state.workItems.set(claimed.workItemId, claimed);
      return clone(claimed);
    });
  }

  async listRecoverableWorkItems(now: Date): Promise<WorkItem[]> {
    if (!Number.isFinite(now.getTime())) invalid('Recovery time must be valid');
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
