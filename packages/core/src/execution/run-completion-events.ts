import type { RunEvent } from '../domain/event/types.js';
import type { AgentRun, WorkItem } from '../domain/run/types.js';
import type { RuntimeUnitOfWork } from '../sdk/runtime-storage.js';
import type { ResolvedLocalRunWorkerOptions } from './local-worker-options.js';
import { nextWorkerId } from './local-worker-options.js';
import { transitionRun } from '../domain/run/run-state.js';
import { updateRootExecutionNode } from './run-completion-node.js';

export function finishWaiting(uow: RuntimeUnitOfWork, run: AgentRun, work: WorkItem, at: Date, options: ResolvedLocalRunWorkerOptions, committed: RunEvent[]): void {
  const waiting: AgentRun = {
    ...run, status: transitionRun(run.status, 'waiting'), waitingReason: 'tool-result-unknown',
    errorCode: 'TOOL_RESULT_UNKNOWN', updatedAt: new Date(at), finishedAt: undefined,
  };
  uow.runs.update(waiting);
  updateRootExecutionNode(uow, waiting, 'waiting', at);
  appendEvent(uow, waiting, 'run.waiting', { waitingReason: 'tool-result-unknown', errorCode: 'TOOL_RESULT_UNKNOWN' }, at, options, committed);
  const { leaseOwner: _owner, leaseExpiresAt: _expiry, ...rest } = work;
  uow.workItems.update({ ...rest, status: 'failed', updatedAt: new Date(at) });
}

export function appendEvent(uow: RuntimeUnitOfWork, run: AgentRun, type: string, data: unknown, at: Date, options: Pick<ResolvedLocalRunWorkerOptions, 'generateId'>, committed: RunEvent[]): void {
  const event: RunEvent = { eventId: nextWorkerId(options.generateId), sequence: uow.events.nextSequence(run.runId), schemaVersion: 1,
    tenantId: run.tenantId, sessionId: run.sessionId, runId: run.runId, type, data: structuredClone(data), occurredAt: new Date(at) };
  uow.events.append(event);
  committed.push(event);
}

export function hasUnknownInvocation(uow: RuntimeUnitOfWork, runId: string): boolean {
  return uow.toolInvocations.listByRun(runId).some((invocation) => invocation.status === 'unknown');
}

export function finishWork(work: WorkItem, status: 'completed' | 'failed', at: Date): WorkItem {
  const { leaseOwner: _owner, leaseExpiresAt: _expiry, ...rest } = work;
  return { ...rest, status, updatedAt: new Date(at) };
}
