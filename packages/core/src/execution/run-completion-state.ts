import type { RunEvent } from '../domain/event/types.js';
import type { AgentRun, WorkItem } from '../domain/run/types.js';
import type { RuntimeUnitOfWork } from '../sdk/runtime-storage.js';
import type { ResolvedLocalRunWorkerOptions } from './local-worker-options.js';
import type { RunFailure } from './run-completion.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';
import { transitionRun } from '../domain/run/run-state.js';
import { appendEvent, finishWork } from './run-completion-events.js';
import { finishExecutionGraph, updateRootExecutionNode } from './run-completion-node.js';

export function readOwnedState(uow: RuntimeUnitOfWork, claimed: WorkItem, owner: string, at: Date): { run: AgentRun; work: WorkItem } | null {
  const work = uow.workItems.getByRun(claimed.runId);
  if (!work || !ownsLease(work, claimed, owner, at)) return null;
  const run = uow.runs.get(claimed.runId);
  if (!run) throw unavailable('Claimed run is missing');
  return { run, work };
}

export function finishFailedRun(uow: RuntimeUnitOfWork, run: AgentRun, work: WorkItem, failure: RunFailure, at: Date, options: ResolvedLocalRunWorkerOptions, committed: RunEvent[]): void {
  const status = failure.cancelled ? 'cancelled' : 'failed';
  const finished: AgentRun = { ...run, status: transitionRun(run.status, status), errorCode: failure.code, finishedAt: cloneDate(at), updatedAt: cloneDate(at) };
  uow.runs.update(finished); updateRootExecutionNode(uow, finished, status, at);
  finishExecutionGraph(uow, finished.runId, status, at);
  appendEvent(uow, finished, failure.cancelled ? 'run.cancelled' : 'run.failed', { errorCode: failure.code, retryable: failure.retryable }, at, options, committed);
  uow.workItems.update(finishWork(work, 'failed', at));
}

export function ownsLease(live: WorkItem, claimed: WorkItem, owner: string, at: Date): boolean {
  return live.workItemId === claimed.workItemId && live.status === 'leased' && live.leaseOwner === owner
    && live.attempt === claimed.attempt && live.leaseExpiresAt?.getTime() === claimed.leaseExpiresAt?.getTime()
    && (live.leaseExpiresAt?.getTime() ?? Number.NEGATIVE_INFINITY) > at.getTime();
}
const cloneDate = (value: Date): Date => new Date(value.getTime());
const unavailable = (message: string): RuntimeError => new RuntimeError('STORAGE_UNAVAILABLE', message, true);
