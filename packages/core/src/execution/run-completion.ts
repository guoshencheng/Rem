import type { RuntimeErrorCode } from '../application/runtime/runtime-error.js';
import type { Artifact } from '../domain/artifact/types.js';
import type { AgentRun, WorkItem } from '../domain/run/types.js';
import type { AgentSession, RuntimeSessionEntry } from '../domain/session/types.js';
import type { RuntimeStorage, RuntimeUnitOfWork } from '../sdk/runtime-storage.js';
import type { ResolvedLocalRunWorkerOptions } from './local-worker-options.js';
import type { ValidatedRunOutput } from './run-output-validation.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';
import { isTerminalRunStatus, transitionRun } from '../domain/run/run-state.js';
import { nextWorkerId, readWorkerNow } from './local-worker-options.js';

export type ClaimedRunStart =
  | { kind: 'execute'; run: AgentRun; session: AgentSession }
  | { kind: 'skip' };

export interface RunFailure {
  code: RuntimeErrorCode;
  retryable: boolean;
  cancelled?: boolean;
}

export class RunCompletion {
  constructor(
    private readonly storage: RuntimeStorage,
    private readonly options: ResolvedLocalRunWorkerOptions,
  ) {}

  start(claimed: WorkItem): Promise<ClaimedRunStart> {
    const at = readWorkerNow(this.options.now);
    return this.storage.transaction((uow): ClaimedRunStart => {
      const liveWork = uow.workItems.getByRun(claimed.runId);
      if (!liveWork) throw unavailable('Claimed work item is missing');
      if (!ownsLease(liveWork, claimed, this.options.owner)) return { kind: 'skip' };
      const run = uow.runs.get(claimed.runId);
      if (!run) {
        uow.workItems.update(finishWork(liveWork, 'failed', at));
        return { kind: 'skip' };
      }
      if (isTerminalRunStatus(run.status)) {
        uow.workItems.update(finishWork(liveWork, run.status === 'completed' ? 'completed' : 'failed', at));
        return { kind: 'skip' };
      }
      if (run.cancellationRequestedAt) {
        finishRun(uow, run, liveWork, { code: 'EXECUTION_CANCELLED', retryable: false, cancelled: true }, at, this.options);
        return { kind: 'skip' };
      }
      if (run.status === 'running') {
        // Tool-level recovery is Task 11. Never replay an execution whose side effects are uncertain.
        finishRun(uow, run, liveWork, { code: 'INTERNAL_ERROR', retryable: false }, at, this.options);
        return { kind: 'skip' };
      }
      if (run.status !== 'queued') {
        finishRun(uow, run, liveWork, { code: 'INTERNAL_ERROR', retryable: false }, at, this.options);
        return { kind: 'skip' };
      }
      const running: AgentRun = {
        ...run, status: transitionRun(run.status, 'running'), startedAt: cloneDate(at), updatedAt: cloneDate(at),
      };
      uow.runs.update(running);
      appendEvent(uow, running, 'run.started', { attempt: liveWork.attempt }, at, this.options);
      const session = uow.sessions.get(running.sessionId);
      if (!session || session.tenantId !== running.tenantId) {
        finishRun(uow, running, liveWork, { code: 'INTERNAL_ERROR', retryable: false }, at, this.options);
        return { kind: 'skip' };
      }
      return { kind: 'execute', run: structuredClone(running), session: structuredClone(session) };
    });
  }

  succeed(claimed: WorkItem, output: ValidatedRunOutput): Promise<boolean> {
    const at = readWorkerNow(this.options.now);
    return this.storage.transaction((uow) => {
      const state = ownedState(uow, claimed, this.options.owner);
      if (!state) return false;
      const { run, work } = state;
      if (isTerminalRunStatus(run.status)) return false;
      if (run.cancellationRequestedAt) {
        finishRun(uow, run, work, { code: 'EXECUTION_CANCELLED', retryable: false, cancelled: true }, at, this.options);
        return true;
      }
      if (run.status !== 'running') return false;
      const session = uow.sessions.get(run.sessionId);
      if (!session || session.tenantId !== run.tenantId) {
        finishRun(uow, run, work, { code: 'INTERNAL_ERROR', retryable: false }, at, this.options);
        return true;
      }
      const existing = uow.sessions.listEntries(session.sessionId);
      let sequence = existing.reduce((maximum, entry) => Math.max(maximum, entry.sequence), 0);
      const entries: RuntimeSessionEntry[] = output.sessionEntries.map((entry) => ({
        entryId: nextWorkerId(this.options.generateId), tenantId: run.tenantId,
        sessionId: run.sessionId, runId: run.runId, sequence: ++sequence,
        message: structuredClone(entry.message),
        ...(entry.metadata === undefined ? {} : { metadata: structuredClone(entry.metadata) }),
        createdAt: cloneDate(at),
      }));
      if (entries.length) uow.sessions.appendEntries(entries);
      for (const draft of output.artifacts) {
        const artifact: Artifact = {
          artifactId: nextWorkerId(this.options.generateId), tenantId: run.tenantId,
          sessionId: run.sessionId, runId: run.runId, ...structuredClone(draft), createdAt: cloneDate(at),
        };
        uow.artifacts.insert(artifact);
        appendEvent(uow, run, 'artifact.created', {
          artifactId: artifact.artifactId, type: artifact.type, mediaType: artifact.mediaType, name: artifact.name,
        }, at, this.options);
      }
      const completed: AgentRun = {
        ...run, status: transitionRun(run.status, 'completed'), finishedAt: cloneDate(at), updatedAt: cloneDate(at),
      };
      uow.runs.update(completed);
      appendEvent(uow, completed, 'run.completed', {
        sessionEntryCount: entries.length, artifactCount: output.artifacts.length,
      }, at, this.options);
      uow.workItems.update(finishWork(work, 'completed', at));
      return true;
    });
  }

  fail(claimed: WorkItem, failure: RunFailure): Promise<boolean> {
    const at = readWorkerNow(this.options.now);
    return this.storage.transaction((uow) => {
      const state = ownedState(uow, claimed, this.options.owner);
      if (!state || isTerminalRunStatus(state.run.status)) return false;
      const cancelled = state.run.cancellationRequestedAt !== undefined || failure.cancelled;
      finishRun(uow, state.run, state.work, cancelled
        ? { code: 'EXECUTION_CANCELLED', retryable: false, cancelled: true }
        : failure, at, this.options);
      return true;
    });
  }
}

function ownedState(uow: RuntimeUnitOfWork, claimed: WorkItem, owner: string): { run: AgentRun; work: WorkItem } | null {
  const work = uow.workItems.getByRun(claimed.runId);
  if (!work || !ownsLease(work, claimed, owner)) return null;
  const run = uow.runs.get(claimed.runId);
  if (!run) throw unavailable('Claimed run is missing');
  return { run, work };
}

function ownsLease(live: WorkItem, claimed: WorkItem, owner: string): boolean {
  return live.workItemId === claimed.workItemId && live.status === 'leased'
    && live.leaseOwner === owner && live.attempt === claimed.attempt
    && live.leaseExpiresAt?.getTime() === claimed.leaseExpiresAt?.getTime();
}

function finishRun(uow: RuntimeUnitOfWork, run: AgentRun, work: WorkItem, failure: RunFailure, at: Date, options: ResolvedLocalRunWorkerOptions): void {
  const status = failure.cancelled ? 'cancelled' : 'failed';
  const finished: AgentRun = { ...run, status: transitionRun(run.status, status), errorCode: failure.code,
    finishedAt: cloneDate(at), updatedAt: cloneDate(at) };
  uow.runs.update(finished);
  appendEvent(uow, finished, failure.cancelled ? 'run.cancelled' : 'run.failed',
    { errorCode: failure.code, retryable: failure.retryable }, at, options);
  uow.workItems.update(finishWork(work, 'failed', at));
}

function finishWork(work: WorkItem, status: 'completed' | 'failed', at: Date): WorkItem {
  const { leaseOwner: _owner, leaseExpiresAt: _expiry, ...rest } = work;
  return { ...rest, status, updatedAt: cloneDate(at) };
}

function appendEvent(uow: RuntimeUnitOfWork, run: AgentRun, type: string, data: unknown, at: Date, options: ResolvedLocalRunWorkerOptions): void {
  uow.events.append({ eventId: nextWorkerId(options.generateId), sequence: uow.events.nextSequence(run.runId), schemaVersion: 1,
    tenantId: run.tenantId, sessionId: run.sessionId, runId: run.runId, type,
    data: structuredClone(data), occurredAt: cloneDate(at) });
}

const cloneDate = (value: Date): Date => new Date(value.getTime());
const unavailable = (message: string): RuntimeError => new RuntimeError('STORAGE_UNAVAILABLE', message, true);
