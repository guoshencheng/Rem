import type { RunEvent } from '../domain/event/types.js';
import type { AgentRun, ToolInvocation, WorkItem } from '../domain/run/types.js';
import type { RuntimeStorage, RuntimeUnitOfWork } from '../sdk/runtime-storage.js';
import { transitionRun } from '../domain/run/run-state.js';
import { nextWorkerId, readWorkerNow } from './local-worker-options.js';
import { updateExecutionNode, updateRootExecutionNode } from './run-completion-node.js';
import { appendRunExecutionControlEntry } from './run-execution-journal.js';
import { ensureBatchResumes, upgradeQueuedTeamGraph } from './team-recovery-graph.js';
import { terminateInvalidTeamGraph } from './runtime-recovery-failures.js';

export interface RuntimeRecoveryOptions {
  now: () => Date;
  generateId: () => string;
  onEventCommitted?: (event: RunEvent) => void;
}

export async function recoverInterruptedRuns(
  storage: RuntimeStorage,
  options: RuntimeRecoveryOptions,
): Promise<void> {
  const at = readWorkerNow(options.now);
  const recoverable = await storage.listRecoverableWorkItems(at);
  for (const item of recoverable) {
    const committed: RunEvent[] = [];
    await storage.transaction((uow) => recoverWorkItem(uow, item.runId, at, options, committed));
    for (const event of committed) options.onEventCommitted?.(event);
  }
}

function recoverWorkItem(
  uow: RuntimeUnitOfWork,
  runId: string,
  at: Date,
  options: RuntimeRecoveryOptions,
  committed: RunEvent[],
): void {
  const work = uow.workItems.getByRun(runId);
  if (!work) return;
  const run = uow.runs.get(runId);
  if (!run) { requeueWork(uow, work, at); return; }
  const graphUpgrade = upgradeQueuedTeamGraph(uow, run, at, options.generateId);
  if (graphUpgrade === 'invalid') {
    terminateInvalidTeamGraph(uow, run, work, at, options.generateId, appendEventFromRecovery(options), committed);
    return;
  }
  const isTeam = run.executionType === 'team' || run.executionPlanSnapshot?.executionType === 'team';
  if (isTeam && !isTerminalStatus(run.status) && uow.executionNodes.listByRun(run.runId).length === 0) {
    terminateInvalidTeamGraph(uow, run, work, at, options.generateId, appendEventFromRecovery(options), committed);
    return;
  }
  ensureBatchResumes(uow, run, at, options.generateId);
  const invocations = uow.toolInvocations.listByRun(runId);
  const unknown = invocations.filter((invocation) => invocation.status === 'unknown');
  if (unknown.length > 0 && run.status !== 'waiting' && run.status !== 'completed' && run.status !== 'failed' && run.status !== 'cancelled') {
    const executingUnsafe = invocations.filter((invocation) => invocation.status === 'executing' && !isRetryable(invocation));
    for (const invocation of executingUnsafe) markInvocationUnknown(uow, run, invocation, at, options, committed);
    for (const invocation of invocations.filter((candidate) => candidate.status === 'executing' && isRetryable(candidate))) {
      uow.toolInvocations.update({ ...invocation, status: 'planned', updatedAt: cloneDate(at) });
      updateExecutionNode(uow, runId, invocation.nodeId ?? run.rootNodeId ?? `${runId}:root`, 'queued', at);
    }
    const waitingInvocations = [...unknown, ...executingUnsafe];
    markWaiting(uow, run, work, waitingInvocations, at, options, committed);
    return;
  }
  if (run.status === 'queued') {
    requeueRunningDeliveries(uow, runId, at);
    requeueWork(uow, work, at);
    return;
  }
  if (run.status === 'waiting') { uow.workItems.update(finishWork(work, at)); return; }
  if (run.status !== 'running') return;

  const executing = invocations.filter((invocation) => invocation.status === 'executing');
  if (executing.some((invocation) => !isRetryable(invocation))) {
    markUnknown(uow, run, work, executing, at, options, committed);
    return;
  }
  for (const invocation of executing) {
    uow.toolInvocations.update({ ...invocation, status: 'planned', updatedAt: cloneDate(at) });
  }
  const requeued: AgentRun = { ...run, status: 'queued', updatedAt: cloneDate(at) };
  uow.runs.update(requeued);
  updateRootExecutionNode(uow, requeued, 'queued', at);
  requeueRunningDeliveries(uow, runId, at);
  for (const node of uow.executionNodes.listByRun(runId)) {
    if (node.nodeId === requeued.rootNodeId || node.status !== 'running') continue;
    updateExecutionNode(uow, runId, node.nodeId, 'queued', at);
  }
  appendEvent(uow, requeued, 'run.requeued', { reason: 'recovery' }, at, options, committed);
  appendRunExecutionControlEntry(uow, requeued, { action: 'recovery-requeue', principalId: run.principalId }, at, options.generateId, run.rootNodeId);
  requeueWork(uow, work, at);
}

function markUnknown(
  uow: RuntimeUnitOfWork,
  run: AgentRun,
  work: WorkItem,
  executing: ToolInvocation[],
  at: Date,
  options: RuntimeRecoveryOptions,
  committed: RunEvent[],
): void {
  for (const invocation of executing) {
    markInvocationUnknown(uow, run, invocation, at, options, committed);
  }
  markWaiting(uow, run, work, executing, at, options, committed);
}

function markInvocationUnknown(uow: RuntimeUnitOfWork, run: AgentRun, invocation: ToolInvocation, at: Date, options: RuntimeRecoveryOptions, committed: RunEvent[]): void {
  uow.toolInvocations.update({ ...invocation, status: 'unknown', error: 'Tool result is unknown', updatedAt: cloneDate(at) });
  appendEvent(uow, run, 'tool.result_unknown', {
    invocationId: invocation.invocationId, toolCallId: invocation.toolCallId,
    toolName: invocation.toolName, reason: 'recovery',
  }, at, options, committed);
  appendRunExecutionControlEntry(uow, run, { action: 'recovery-waiting', invocationId: invocation.invocationId, principalId: run.principalId, errorCode: 'TOOL_RESULT_UNKNOWN' }, at, options.generateId, invocation.nodeId);
}

function markWaiting(uow: RuntimeUnitOfWork, run: AgentRun, work: WorkItem, invocations: ToolInvocation[], at: Date, options: RuntimeRecoveryOptions, committed: RunEvent[]): void {
  for (const invocation of invocations) {
    updateExecutionNode(uow, run.runId, invocation.nodeId ?? run.rootNodeId ?? `${run.runId}:root`, 'waiting', at);
    markNodeDeliveryWaiting(uow, run.runId, invocation.nodeId ?? run.rootNodeId ?? `${run.runId}:root`, at);
    if (invocation.status === 'unknown') {
      appendRunExecutionControlEntry(uow, run, {
        action: 'recovery-waiting', invocationId: invocation.invocationId,
        principalId: run.principalId, errorCode: 'TOOL_RESULT_UNKNOWN',
      }, at, options.generateId, invocation.nodeId);
    }
  }
  const waiting: AgentRun = {
    ...run, status: run.status === 'waiting' ? 'waiting' : run.status === 'running' ? transitionRun(run.status, 'waiting') : 'waiting', waitingReason: 'recovery', errorCode: 'TOOL_RESULT_UNKNOWN', updatedAt: cloneDate(at),
  };
  uow.runs.update(waiting);
  updateRootExecutionNode(uow, waiting, 'waiting', at);
  appendEvent(uow, waiting, 'run.waiting', { waitingReason: 'recovery' }, at, options, committed);
  uow.workItems.update(finishWork(work, at));
}

const isRetryable = (invocation: ToolInvocation): boolean =>
  invocation.sideEffect !== 'non-idempotent' || invocation.supportsIdempotencyKey;

function isTerminalStatus(status: AgentRun['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function requeueWork(uow: RuntimeUnitOfWork, work: WorkItem, at: Date): void {
  if (work.status !== 'leased') return;
  const { leaseOwner: _owner, leaseExpiresAt: _expiry, ...rest } = work;
  uow.workItems.update({ ...rest, status: 'queued', updatedAt: cloneDate(at) });
}

function requeueRunningDeliveries(uow: RuntimeUnitOfWork, runId: string, at: Date): void {
  for (const delivery of uow.deliveries.listByRun(runId)) {
    if (delivery.status !== 'running') continue;
    uow.deliveries.update({ ...delivery, status: 'queued', errorCode: undefined, updatedAt: cloneDate(at) });
    const node = uow.executionNodes.get(delivery.nodeId);
    if (node && node.status === 'running') uow.executionNodes.update({ ...node, status: 'queued', updatedAt: cloneDate(at) });
  }
}

function markNodeDeliveryWaiting(uow: RuntimeUnitOfWork, runId: string, nodeId: string, at: Date): void {
  const candidates = uow.deliveries.listByNode(runId, nodeId)
    .filter((delivery) => delivery.status === 'running' || delivery.status === 'queued');
  const delivery = candidates.find((candidate) => candidate.status === 'running') ?? candidates.at(-1);
  if (!delivery) return;
  uow.deliveries.update({ ...delivery, status: 'waiting', errorCode: 'TOOL_RESULT_UNKNOWN', updatedAt: cloneDate(at) });
}

function finishWork(work: WorkItem, at: Date): WorkItem {
  const { leaseOwner: _owner, leaseExpiresAt: _expiry, ...rest } = work;
  return { ...rest, status: 'failed', updatedAt: cloneDate(at) };
}

function appendEvent(
  uow: RuntimeUnitOfWork,
  run: AgentRun,
  type: string,
  data: unknown,
  at: Date,
  options: RuntimeRecoveryOptions,
  committed: RunEvent[],
): void {
  const event: RunEvent = {
    eventId: nextWorkerId(options.generateId), sequence: uow.events.nextSequence(run.runId),
    schemaVersion: 1, tenantId: run.tenantId, sessionId: run.sessionId, runId: run.runId,
    type, data: structuredClone(data), occurredAt: cloneDate(at),
  };
  uow.events.append(event);
  committed.push(event);
}

function appendEventFromRecovery(options: RuntimeRecoveryOptions) {
  return (uow: RuntimeUnitOfWork, run: AgentRun, type: string, data: unknown, at: Date, committed: RunEvent[]): void => {
    appendEvent(uow, run, type, data, at, options, committed);
  };
}

const cloneDate = (value: Date): Date => new Date(value.getTime());
