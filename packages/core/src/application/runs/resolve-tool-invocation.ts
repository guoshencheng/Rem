import type { RuntimeRequestContext } from '../../domain/identity/types.js';
import type { AgentRun, ToolInvocation, WorkItem } from '../../domain/run/types.js';
import type { ToolInvocationResolution } from '../../domain/run/execution-models.js';
import type { RunEvent } from '../../domain/event/types.js';
import type { RuntimeStorage, RuntimeUnitOfWork } from '../../sdk/runtime-storage.js';
import { cloneCanonicalJson, hashCanonicalJson } from '../contexts/canonical-json.js';
import { RuntimeError } from '../runtime/runtime-error.js';
import { appendEvent, finishWork, hasUnknownInvocation } from '../../execution/run-completion-events.js';
import { transitionRun } from '../../domain/run/run-state.js';
import { generateId } from '../../shared/generate-id.js';
import { validateToolInvocationResolution } from './validate-tool-resolution.js';
import { finishExecutionGraph, updateExecutionNode, updateRootExecutionNode } from '../../execution/run-completion-node.js';
import { appendRunExecutionControlEntry } from '../../execution/run-execution-journal.js';
import { consumeExecutionMessage } from '../../execution/run-execution-budget.js';

export interface ResolveToolInvocationDeps { storage: RuntimeStorage; now?: () => Date; generateId?: () => string; onEventCommitted?: (event: RunEvent) => void; }

export class ResolveToolInvocationUsecase {
  private readonly now: () => Date;
  private readonly id: () => string;
  constructor(private readonly deps: ResolveToolInvocationDeps) {
    this.now = deps.now ?? (() => new Date()); this.id = deps.generateId ?? generateId;
  }

  async execute(request: RuntimeRequestContext, runId: string, invocationId: string, resolution: ToolInvocationResolution): Promise<AgentRun> {
    const normalized = validateToolInvocationResolution(resolution);
    const key = normalized.idempotencyKey;
    const hash = this.hashResolution(runId, invocationId, normalized);
    const at = new Date(this.now().getTime());
    const committed: RunEvent[] = [];
    const result = await this.deps.storage.transaction((uow) => {
      const prior = uow.idempotency.get(request.tenantId, 'resolve-tool-invocation', key);
      if (prior) {
        if (prior.requestHash !== hash) throw new RuntimeError('IDEMPOTENCY_CONFLICT', 'Idempotency key was used for another resolution');
        const replay = uow.runs.get(prior.resourceId);
        if (!replay) throw new RuntimeError('STORAGE_UNAVAILABLE', 'Resolution idempotency record references a missing run', true);
        return structuredClone(replay);
      }
      const run = ownedRun(uow, request.tenantId, runId);
      const invocation = uow.toolInvocations.get(invocationId);
      if (!invocation || invocation.runId !== runId || invocation.tenantId !== request.tenantId) throw new RuntimeError('TOOL_RESULT_UNKNOWN', 'Tool invocation not found');
      if (invocation.status !== 'unknown' || run.status !== 'waiting') throw new RuntimeError('RUN_CONFLICT', 'Tool invocation is no longer waiting');
      const updated = applyResolution(uow, run, invocation, normalized, at, this.id, request.principal.principalId, committed);
      uow.idempotency.insert({ tenantId: request.tenantId, operation: 'resolve-tool-invocation', idempotencyKey: key, requestHash: hash, resourceId: runId, createdAt: at });
      return structuredClone(updated);
    });
    for (const event of committed) this.deps.onEventCommitted?.(event);
    return result;
  }

  private hashResolution(runId: string, invocationId: string, resolution: ToolInvocationResolution): string {
    try { return hashCanonicalJson({ runId, invocationId, resolution }); }
    catch (cause) { throw new RuntimeError('INVALID_INPUT', 'Resolution must be canonical JSON', false, undefined, { cause }); }
  }
}

function ownedRun(uow: RuntimeUnitOfWork, tenantId: string, runId: string): AgentRun {
  const run = uow.runs.get(runId);
  if (!run || run.tenantId !== tenantId) throw new RuntimeError('RUN_NOT_FOUND', 'Run not found');
  return run;
}

function applyResolution(uow: RuntimeUnitOfWork, run: AgentRun, invocation: ToolInvocation, resolution: ToolInvocationResolution, at: Date, id: () => string, principalId: string, committed: RunEvent[]): AgentRun {
  const work = uow.workItems.getByRun(run.runId);
  if (!work) throw new RuntimeError('STORAGE_UNAVAILABLE', 'Run work item is missing', true);
  if (resolution.action === 'confirm-succeeded') {
    const details = resolution.result.details === undefined ? undefined : cloneCanonicalJson(resolution.result.details);
    uow.toolInvocations.update({ ...invocation, status: 'succeeded', result: { output: resolution.result.output, ...(details === undefined ? {} : { details }) }, error: undefined, updatedAt: at });
    const toolResult = {
      role: 'toolResult' as const, toolCallId: invocation.toolCallId, toolName: invocation.toolName,
      content: [{ type: 'text' as const, text: resolution.result.output }],
      ...(details === undefined ? {} : { details }), isError: false, timestamp: at.getTime(),
    };
    consumeExecutionMessage(uow, run, toolResult, at);
    const team = run.executionPlanSnapshot?.executionType === 'team' || run.executionType === 'team';
    uow.executionEntries.append({
      entryId: id(), tenantId: run.tenantId, runId: run.runId,
      nodeId: invocation.nodeId ?? run.rootNodeId ?? `${run.runId}:root`, sequence: uow.executionEntries.nextSequence(run.runId),
      kind: 'tool-result', message: toolResult,
      data: { invocationId: invocation.invocationId, toolCallId: invocation.toolCallId, toolName: invocation.toolName, output: resolution.result.output, ...(details === undefined ? {} : { details }) } as never,
      audience: team ? 'internal' : 'public', visibility: team ? 'run' : 'session', createdAt: at,
    });
    appendEvent(uow, run, 'tool.result_confirmed', { invocationId: invocation.invocationId, principalId }, at, { generateId: id }, committed);
    appendRunExecutionControlEntry(uow, run, { action: 'confirm-succeeded', invocationId: invocation.invocationId, principalId }, at, id, invocation.nodeId);
    return hasUnknownInvocation(uow, run.runId) ? remainWaiting(uow, run, work, invocation.nodeId, at, id, 'confirm-succeeded', committed)
      : requeue(uow, run, work, invocation.nodeId, at, id, 'confirm-succeeded', committed);
  }
  if (resolution.action === 'retry') {
    if (invocation.sideEffect === 'non-idempotent' && !invocation.supportsIdempotencyKey) throw new RuntimeError('TOOL_RESULT_UNKNOWN', 'Non-idempotent invocation cannot be retried safely');
    uow.toolInvocations.update({ ...invocation, status: 'planned', error: undefined, updatedAt: at });
    appendRunExecutionControlEntry(uow, run, { action: 'retry', invocationId: invocation.invocationId, principalId }, at, id, invocation.nodeId);
    return hasUnknownInvocation(uow, run.runId) ? remainWaiting(uow, run, work, invocation.nodeId, at, id, 'retry', committed)
      : requeue(uow, run, work, invocation.nodeId, at, id, 'retry', committed);
  }
  uow.toolInvocations.update({ ...invocation, status: 'failed', error: 'Tool invocation failed by operator', updatedAt: at });
  appendRunExecutionControlEntry(uow, run, { action: 'fail', invocationId: invocation.invocationId, principalId, errorCode: 'TOOL_EXECUTION_FAILED' }, at, id, invocation.nodeId);
  const failed: AgentRun = { ...run, status: transitionRun(run.status, 'failed'), errorCode: 'TOOL_EXECUTION_FAILED', finishedAt: at, updatedAt: at, waitingReason: undefined };
  uow.runs.update(failed); uow.workItems.update(finishWork(work, 'failed', at));
  updateRootExecutionNode(uow, failed, 'failed', at);
  finishExecutionGraph(uow, failed.runId, 'failed', at);
  updateExecutionNode(uow, run.runId, invocation.nodeId ?? run.rootNodeId ?? `${run.runId}:root`, 'failed', at);
  appendEvent(uow, failed, 'run.failed', { errorCode: 'TOOL_EXECUTION_FAILED', retryable: false, principalId }, at, { generateId: id }, committed);
  return failed;
}

function requeue(uow: RuntimeUnitOfWork, run: AgentRun, work: WorkItem, nodeId: string | undefined, at: Date, id: () => string, action: string, committed: RunEvent[]): AgentRun {
  const queued: AgentRun = { ...run, status: transitionRun(run.status, 'queued'), waitingReason: undefined, errorCode: undefined, finishedAt: undefined, updatedAt: at };
  uow.runs.update(queued); uow.workItems.update({ ...work, status: 'queued', leaseOwner: undefined, leaseExpiresAt: undefined, updatedAt: at });
  updateRootExecutionNode(uow, queued, 'queued', at);
  requeueWaitingDeliveries(uow, run.runId, at);
  updateExecutionNode(uow, run.runId, nodeId ?? run.rootNodeId ?? `${run.runId}:root`, 'queued', at);
  appendEvent(uow, queued, 'run.requeued', { reason: `tool-resolution:${action}` }, at, { generateId: id }, committed);
  return queued;
}

function requeueWaitingDeliveries(uow: RuntimeUnitOfWork, runId: string, at: Date): void {
  for (const delivery of uow.deliveries.listByRun(runId)) {
    if (delivery.status !== 'waiting') continue;
    uow.deliveries.update({ ...delivery, status: 'queued', errorCode: undefined, updatedAt: new Date(at.getTime()) });
    const node = uow.executionNodes.get(delivery.nodeId);
    if (node && node.status === 'waiting') {
      uow.executionNodes.update({ ...node, status: 'queued', updatedAt: new Date(at.getTime()) });
    }
  }
}

function remainWaiting(uow: RuntimeUnitOfWork, run: AgentRun, work: WorkItem, nodeId: string | undefined, at: Date, id: () => string, action: string, committed: RunEvent[]): AgentRun {
  const waiting: AgentRun = { ...run, status: 'waiting', waitingReason: 'tool-result-unknown', errorCode: 'TOOL_RESULT_UNKNOWN', finishedAt: undefined, updatedAt: at };
  uow.runs.update(waiting); uow.workItems.update(finishWork(work, 'failed', at));
  updateRootExecutionNode(uow, waiting, 'waiting', at);
  updateExecutionNode(uow, run.runId, nodeId ?? run.rootNodeId ?? `${run.runId}:root`, 'waiting', at);
  appendEvent(uow, waiting, 'run.waiting', { waitingReason: 'tool-result-unknown', action }, at, { generateId: id }, committed);
  return waiting;
}
