import type { RunEvent } from '../domain/event/types.js';
import type { AgentRun, WorkItem } from '../domain/run/types.js';
import type { RuntimeUnitOfWork } from '../sdk/runtime-storage.js';
import { appendRunExecutionControlEntry } from './run-execution-journal.js';

export function terminateInvalidTeamGraph(
  uow: RuntimeUnitOfWork,
  run: AgentRun,
  work: WorkItem,
  at: Date,
  generateId: () => string,
  appendEvent: (uow: RuntimeUnitOfWork, run: AgentRun, type: string, data: unknown, at: Date, committed: RunEvent[]) => void,
  committed: RunEvent[],
): void {
  const failed: AgentRun = {
    ...run, status: 'failed', errorCode: 'INTERNAL_ERROR',
    finishedAt: new Date(at.getTime()), updatedAt: new Date(at.getTime()),
  };
  uow.runs.update(failed);
  appendEvent(uow, failed, 'run.failed', { errorCode: 'INTERNAL_ERROR', retryable: false }, at, committed);
  appendRunExecutionControlEntry(uow, failed, {
    action: 'recovery-invalid-graph', principalId: run.principalId, errorCode: 'INTERNAL_ERROR',
  }, at, generateId, run.rootNodeId);
  const { leaseOwner: _owner, leaseExpiresAt: _expiry, ...rest } = work;
  uow.workItems.update({ ...rest, status: 'failed', updatedAt: new Date(at.getTime()) });
}
