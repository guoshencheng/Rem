import type { RunExecutionNode } from '../domain/run/execution-models.js';
import type { AgentRun } from '../domain/run/types.js';
import type { RuntimeUnitOfWork } from '../sdk/runtime-storage.js';
import { updateNodeDelivery } from './runtime-delivery-state.js';

export function updateRootExecutionNode(uow: RuntimeUnitOfWork, run: AgentRun, status: RunExecutionNode['status'], at: Date): void {
  updateExecutionNode(uow, run.runId, run.rootNodeId ?? `${run.runId}:root`, status, at);
}

export function updateExecutionNode(uow: RuntimeUnitOfWork, runId: string, nodeId: string, status: RunExecutionNode['status'], at: Date): void {
  const node = uow.executionNodes.get(nodeId);
  if (!node) return;
  const terminal = status === 'completed' || status === 'failed' || status === 'cancelled';
  const { startedAt: existingStartedAt, finishedAt: _existingFinishedAt, ...withoutTimes } = node;
  uow.executionNodes.update({
    ...withoutTimes, status,
    ...(status === 'running' || status === 'waiting' || terminal
      ? { startedAt: existingStartedAt ? cloneDate(existingStartedAt) : cloneDate(at) }
      : existingStartedAt === undefined ? {} : { startedAt: cloneDate(existingStartedAt) }),
    ...(terminal ? { finishedAt: cloneDate(at) } : {}),
    updatedAt: cloneDate(at),
  });
  updateNodeDelivery(uow, runId, node.nodeId, status, at);
}

/** Bring every non-terminal graph node to the root Run's terminal state. A
 * Team can have queued/idle members when the organizer fails, so updating only
 * the root leaves stale executable work behind. */
export function finishExecutionGraph(uow: RuntimeUnitOfWork, runId: string, status: Extract<RunExecutionNode['status'], 'completed' | 'failed' | 'cancelled'>, at: Date): void {
  for (const node of uow.executionNodes.listByRun(runId)) {
    if (node.status === 'completed' || node.status === 'failed' || node.status === 'cancelled') continue;
    updateExecutionNode(uow, runId, node.nodeId, status, at);
  }
}

export const cloneDate = (value: Date): Date => new Date(value.getTime());
