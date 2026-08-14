import type { AgentRun } from '../domain/run/types.js';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { RunDelivery, RunExecutionEntry, RunExecutionNode } from '../domain/run/execution-models.js';
import type { RuntimeStorage, RuntimeUnitOfWork } from '../sdk/runtime-storage.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';
import { runtimeResumeDeliveryId } from './runtime-delivery-state.js';
import { updateExecutionNode } from './run-completion-node.js';
import { appendRunExecutionControlEntry } from './run-execution-journal.js';
import { consumeExecutionMessage } from './run-execution-budget.js';

const terminalDelivery = (status: RunDelivery['status']): boolean => ['completed', 'failed', 'cancelled'].includes(status);

export async function claimTeamDelivery(storage: RuntimeStorage, runId: string, activeNodes: ReadonlySet<string>, now: Date): Promise<RunDelivery | null> {
  return storage.transaction((uow) => {
    const candidate = uow.deliveries.listByRun(runId).find((delivery) => {
      if (delivery.status !== 'queued' || activeNodes.has(delivery.nodeId)) return false;
      const node = uow.executionNodes.get(delivery.nodeId);
      return node !== null && !['completed', 'failed', 'cancelled', 'waiting'].includes(node.status);
    });
    if (!candidate) return null;
    const node = uow.executionNodes.get(candidate.nodeId);
    if (!node) return null;
    const claimed = uow.deliveries.claimQueued(runId, candidate.deliveryId, new Date(now.getTime()));
    if (!claimed) return null;
    updateExecutionNode(uow, runId, node.nodeId, 'running', now);
    return claimed;
  });
}

export async function completeTeamDelivery(
  storage: RuntimeStorage,
  run: AgentRun,
  deliveryId: string,
  resultEntryId: string | undefined,
  now: Date,
  errorCode?: string,
): Promise<void> {
  await storage.transaction((uow) => completeDeliveryInUnitOfWork(uow, run, deliveryId, resultEntryId, now, errorCode));
}

/**
 * A member failure is a durable result, not an in-memory exception.  The
 * requester must be able to resume from the same batch after a restart, so we
 * append a stable synthetic assistant entry and complete the delivery in the
 * same transaction.
 */
export async function failTeamDelivery(
  storage: RuntimeStorage,
  run: AgentRun,
  deliveryId: string,
  errorCode: string,
  now: Date,
): Promise<void> {
  await storage.transaction((uow) => {
    const delivery = uow.deliveries.get(deliveryId);
    if (!delivery || delivery.runId !== run.runId || delivery.status !== 'running') return;
    const entryId = `${delivery.deliveryId}:failure:${delivery.attempt}`;
    if (!uow.executionEntries.get(entryId)) {
      const message = syntheticFailureMessage(errorCode, now);
      consumeExecutionMessage(uow, run, message, now);
      uow.executionEntries.append({
        entryId, tenantId: run.tenantId, runId: run.runId, nodeId: delivery.nodeId,
        sequence: uow.executionEntries.nextSequence(run.runId), kind: 'message',
        message,
        data: { kind: 'team.failure', errorCode }, audience: 'internal', visibility: 'run',
        createdAt: new Date(now.getTime()),
      });
    }
    completeDeliveryInUnitOfWork(uow, run, deliveryId, entryId, now, errorCode);
  });
}

/** Cancel queued/running work after an organizer failure without touching an
 * already waiting invocation (waiting is the stronger recovery state). */
export async function cancelTeamDeliveries(
  storage: RuntimeStorage,
  run: AgentRun,
  now: Date,
  exceptDeliveryId?: string,
): Promise<void> {
  await storage.transaction((uow) => {
    for (const delivery of uow.deliveries.listByRun(run.runId)) {
      if (delivery.deliveryId === exceptDeliveryId || !['queued', 'running'].includes(delivery.status)) continue;
      uow.deliveries.update({ ...delivery, status: 'cancelled', errorCode: 'EXECUTION_CANCELLED', updatedAt: new Date(now.getTime()) });
      const node = uow.executionNodes.get(delivery.nodeId);
      if (node && !['completed', 'failed', 'cancelled', 'waiting'].includes(node.status)) {
        updateExecutionNode(uow, run.runId, node.nodeId, 'cancelled', now);
      }
    }
  });
}

function completeDeliveryInUnitOfWork(
  uow: RuntimeUnitOfWork,
  run: AgentRun,
  deliveryId: string,
  resultEntryId: string | undefined,
  now: Date,
  errorCode?: string,
): void {
  const delivery = uow.deliveries.get(deliveryId);
  if (!delivery || delivery.runId !== run.runId) throw new RuntimeError('STORAGE_UNAVAILABLE', 'Team delivery is missing', true);
  if (delivery.status !== 'running') return;
  const status: RunDelivery['status'] = errorCode === undefined ? 'completed' : 'failed';
  const updated: RunDelivery = {
    ...delivery, status, updatedAt: new Date(now.getTime()),
    ...(resultEntryId === undefined ? {} : { resultEntryId }),
    ...(errorCode === undefined ? {} : { errorCode }),
  };
  uow.deliveries.update(updated);
  if (errorCode !== undefined) {
    appendRunExecutionControlEntry(uow, run, {
      action: 'delivery-failed', deliveryId: delivery.deliveryId, nodeId: delivery.nodeId,
      principalId: run.principalId, errorCode,
    }, now, undefined, delivery.nodeId);
  }
  const node = uow.executionNodes.get(delivery.nodeId);
  if (node && !['completed', 'failed', 'cancelled'].includes(node.status)) {
    const hasQueued = uow.deliveries.listByNode(run.runId, node.nodeId).some((candidate) => candidate.status === 'queued');
    updateExecutionNode(uow, run.runId, node.nodeId, hasQueued ? 'queued' : 'idle', now);
  }
  if (delivery.kind !== 'message' || delivery.requestedByNodeId === undefined) return;
  const batch = uow.deliveries.listByBatch(run.runId, delivery.batchId).filter((candidate) => candidate.kind === 'message');
  if (!batch.every((candidate) => terminalDelivery(candidate.status))) return;
  const resumeId = runtimeResumeDeliveryId(run.runId, delivery.requestedByNodeId, delivery.batchId);
  if (uow.deliveries.get(resumeId)) return;
  uow.deliveries.insert({
    deliveryId: resumeId, tenantId: run.tenantId, runId: run.runId, nodeId: delivery.requestedByNodeId,
    kind: 'resume', batchId: delivery.batchId, depth: delivery.depth, status: 'queued', attempt: 0,
    requestedByNodeId: undefined, createdAt: new Date(now.getTime()), updatedAt: new Date(now.getTime()),
  });
  const requester = uow.executionNodes.get(delivery.requestedByNodeId);
  if (requester && requester.status === 'idle') uow.executionNodes.update({ ...requester, status: 'queued', updatedAt: new Date(now.getTime()) });
  appendRunExecutionControlEntry(uow, run, { action: 'delivery-resume-queued', batchId: delivery.batchId, nodeId: delivery.requestedByNodeId, principalId: run.principalId }, now, undefined, delivery.requestedByNodeId);
}

export async function markTeamDeliveryWaiting(storage: RuntimeStorage, run: AgentRun, deliveryId: string, now: Date, errorCode = 'TOOL_RESULT_UNKNOWN'): Promise<void> {
  await storage.transaction((uow) => {
    const delivery = uow.deliveries.get(deliveryId);
    if (!delivery || delivery.status !== 'running') return;
    uow.deliveries.update({ ...delivery, status: 'waiting', errorCode, updatedAt: new Date(now.getTime()) });
    updateExecutionNode(uow, run.runId, delivery.nodeId, 'waiting', now);
    appendRunExecutionControlEntry(uow, run, {
      action: 'delivery-waiting', deliveryId, nodeId: delivery.nodeId,
      principalId: run.principalId, errorCode,
    }, now, undefined, delivery.nodeId);
  });
}

export async function lastAssistantEntry(storage: RuntimeStorage, runId: string, nodeId: string, afterSequence = 0): Promise<RunExecutionEntry | undefined> {
  return storage.transaction((uow) => {
    const entries: RunExecutionEntry[] = [];
    let after = 0;
    for (;;) {
      const page = uow.executionEntries.listByNode(runId, nodeId, after, 500);
      entries.push(...page);
      if (page.length < 500) break;
      after = page.at(-1)?.sequence ?? after;
    }
    const assistants = entries.reverse().filter(isFinalAssistant);
    // A recovered delivery may start from an already-completed checkpoint,
    // so no new assistant entry is appended during this attempt.  Preserve
    // the existing final entry as the delivery's durable result pointer.
    return assistants.find((entry) => entry.sequence > afterSequence) ?? assistants[0];
  });
}

function isFinalAssistant(entry: RunExecutionEntry): boolean {
  return !isCommunication(entry) && entry.message?.role === 'assistant'
    && entry.message.stopReason !== 'toolUse'
    && !entry.message.content.some((part) => part.type === 'toolCall');
}

function isCommunication(entry: RunExecutionEntry): boolean {
  return typeof entry.data === 'object' && entry.data !== null && !Array.isArray(entry.data)
    && (entry.data as { kind?: unknown }).kind === 'team.communication';
}

function syntheticFailureMessage(errorCode: string, at: Date): AssistantMessage {
  return {
    role: 'assistant', content: [{ type: 'text', text: `[Team member failed: ${errorCode}]` }],
    api: 'runtime', provider: 'runtime', model: 'runtime',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'error', errorMessage: errorCode, timestamp: at.getTime(),
  } as AssistantMessage;
}
