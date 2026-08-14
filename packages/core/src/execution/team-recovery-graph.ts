import type { Message } from '@earendil-works/pi-ai';
import type { AgentRun } from '../domain/run/types.js';
import type { RunExecutionNode } from '../domain/run/execution-models.js';
import type { RuntimeUnitOfWork } from '../sdk/runtime-storage.js';
import { appendRunExecutionControlEntry } from './run-execution-journal.js';
import { runtimeDeliveryId, runtimeResumeDeliveryId } from './runtime-delivery-state.js';

/** Upgrade only an empty queued Team shape created before graph persistence. */
export function upgradeQueuedTeamGraph(uow: RuntimeUnitOfWork, run: AgentRun, at: Date, generateId: () => string): 'upgraded' | 'invalid' | undefined {
  const plan = run.executionPlanSnapshot;
  if (run.status !== 'queued' || plan?.executionType !== 'team') return undefined;
  const nodes = uow.executionNodes.listByRun(run.runId);
  const entries = readEntries(uow, run.runId);
  if (nodes.length > 0 || entries.length > 0) return nodes.length === 0 && entries.length > 0 ? 'invalid' : undefined;
  const rootNodeId = run.rootNodeId ?? `${run.runId}:root`;
  if (run.rootNodeId === undefined || run.executionType !== 'team') {
    uow.runs.update({ ...run, rootNodeId, executionType: 'team', updatedAt: cloneDate(at) });
  }
  const participants = plan.participantSnapshots.length > 0 ? plan.participantSnapshots : plan.participants.map((participant) => ({
    ...participant, name: participant.agentId, instructions: '', modelId: plan.modelId,
    toolNames: plan.toolNames, acceptedTriggers: ['message'] as const,
  }));
  participants.forEach((participant, index) => uow.executionNodes.insert({
    nodeId: index === 0 ? rootNodeId : `${run.runId}:member:${index}`, runId: run.runId, tenantId: run.tenantId,
    ...(index === 0 ? {} : { parentNodeId: rootNodeId }), kind: index === 0 ? 'organizer' : 'member', role: participant.role,
    agentId: participant.agentId, agentRevision: participant.revision, status: index === 0 ? 'queued' : 'idle', depth: 0,
    createdAt: cloneDate(at), updatedAt: cloneDate(at),
  } satisfies RunExecutionNode));
  const entryId = generateId();
  uow.executionEntries.append({ entryId, tenantId: run.tenantId, runId: run.runId, nodeId: rootNodeId,
    sequence: uow.executionEntries.nextSequence(run.runId), kind: 'message', message: teamTriggerMessage(run, at),
    audience: 'public', visibility: 'session', createdAt: cloneDate(at) });
  uow.deliveries.insert({ deliveryId: runtimeDeliveryId(run.runId, rootNodeId), tenantId: run.tenantId, runId: run.runId,
    nodeId: rootNodeId, kind: 'message', batchId: `${run.runId}:initial`, depth: 0, status: 'queued', attempt: 0,
    sourceEntryId: entryId, createdAt: cloneDate(at), updatedAt: cloneDate(at) });
  if (!uow.executionBudgets.get(run.runId)) uow.executionBudgets.insert({ tenantId: run.tenantId, runId: run.runId,
    agentRuns: participants.length, messages: 1, tokens: 0, updatedAt: cloneDate(at) });
  return 'upgraded';
}

/** Recreate a missing batch resume after a crash between delivery and resume writes. */
export function ensureBatchResumes(uow: RuntimeUnitOfWork, run: AgentRun, at: Date, generateId: () => string): void {
  const groups = new Map<string, ReturnType<RuntimeUnitOfWork['deliveries']['listByRun']>>();
  for (const delivery of uow.deliveries.listByRun(run.runId)) {
    if (delivery.kind !== 'message' || delivery.requestedByNodeId === undefined) continue;
    const key = `${delivery.batchId}\u0000${delivery.requestedByNodeId}`;
    const list = groups.get(key) ?? []; list.push(delivery); groups.set(key, list);
  }
  for (const deliveries of groups.values()) {
    if (!deliveries.length || deliveries.some((delivery) => !['completed', 'failed', 'cancelled'].includes(delivery.status))) continue;
    const source = deliveries[0]; const requester = source.requestedByNodeId!;
    const resumeId = runtimeResumeDeliveryId(run.runId, requester, source.batchId);
    if (uow.deliveries.get(resumeId)) continue;
    uow.deliveries.insert({ deliveryId: resumeId, tenantId: run.tenantId, runId: run.runId, nodeId: requester,
      kind: 'resume', batchId: source.batchId, depth: source.depth, status: 'queued', attempt: 0,
      createdAt: cloneDate(at), updatedAt: cloneDate(at) });
    const node = uow.executionNodes.get(requester);
    if (node && node.status === 'idle') uow.executionNodes.update({ ...node, status: 'queued', updatedAt: cloneDate(at) });
    appendRunExecutionControlEntry(uow, run, { action: 'delivery-resume-queued', batchId: source.batchId,
      nodeId: requester, principalId: run.principalId }, at, generateId, requester);
  }
}

function readEntries(uow: RuntimeUnitOfWork, runId: string) {
  const entries = [] as ReturnType<RuntimeUnitOfWork['executionEntries']['listByRun']>;
  let after = 0;
  for (;;) {
    const page = uow.executionEntries.listByRun(runId, after, 500); entries.push(...page);
    if (page.length < 500) return entries;
    after = page.at(-1)?.sequence ?? after;
  }
}

function teamTriggerMessage(run: AgentRun, at: Date): Message {
  const content = run.trigger.type === 'message' ? structuredClone(run.trigger.content) : JSON.stringify(run.trigger.input);
  return { role: 'user', content, timestamp: at.getTime() } as Message;
}

const cloneDate = (value: Date): Date => new Date(value.getTime());
