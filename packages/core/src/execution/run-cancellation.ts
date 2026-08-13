import type { RunEvent } from '../domain/event/types.js';
import type { AgentRun, WorkItem } from '../domain/run/types.js';
import type { RuntimeStorage, RuntimeUnitOfWork } from '../sdk/runtime-storage.js';
import type { ResolvedLocalRunWorkerOptions } from './local-worker-options.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';
import { isTerminalRunStatus, transitionRun } from '../domain/run/run-state.js';
import { nextWorkerId, readWorkerNow } from './local-worker-options.js';

export class RunCancellation {
  constructor(
    private readonly storage: RuntimeStorage,
    private readonly options: ResolvedLocalRunWorkerOptions,
  ) {}

  request(runId: string): Promise<AgentRun> {
    if (typeof runId !== 'string' || !runId.trim()) {
      return Promise.reject(new RuntimeError('INVALID_INPUT', 'runId must be a non-empty string'));
    }
    const at = readWorkerNow(this.options.now);
    const committed: RunEvent[] = [];
    return this.storage.transaction((uow) => {
      const run = uow.runs.get(runId);
      if (!run) throw new RuntimeError('RUN_NOT_FOUND', 'Run not found');
      if (isTerminalRunStatus(run.status)) return structuredClone(run);
      const work = uow.workItems.getByRun(runId);
      if (!work) throw new RuntimeError('STORAGE_UNAVAILABLE', 'Run work item is missing', true);
      const requested: AgentRun = {
        ...run, cancellationRequestedAt: run.cancellationRequestedAt ?? cloneDate(at), updatedAt: cloneDate(at),
      };
      if (run.status === 'running') {
        uow.runs.update(requested);
        return structuredClone(requested);
      }
      const cancelled: AgentRun = {
        ...requested, status: transitionRun(run.status, 'cancelled'), errorCode: 'EXECUTION_CANCELLED',
        finishedAt: cloneDate(at), updatedAt: cloneDate(at),
      };
      uow.runs.update(cancelled);
      const event: RunEvent = {
        eventId: nextWorkerId(this.options.generateId), sequence: uow.events.nextSequence(runId), schemaVersion: 1,
        tenantId: run.tenantId, sessionId: run.sessionId, runId, type: 'run.cancelled',
        data: { errorCode: 'EXECUTION_CANCELLED', retryable: false }, occurredAt: cloneDate(at),
      };
      uow.events.append(event);
      committed.push(event);
      uow.workItems.update(finishWork(work, at));
      return structuredClone(cancelled);
    }).then((run) => {
      const emit = this.options.onEventCommitted;
      if (emit) for (const event of committed) emit(event);
      return run;
    });
  }
}

function finishWork(work: WorkItem, at: Date): WorkItem {
  const { leaseOwner: _owner, leaseExpiresAt: _expiry, ...rest } = work;
  return { ...rest, status: 'failed', updatedAt: cloneDate(at) };
}

const cloneDate = (value: Date): Date => new Date(value.getTime());
