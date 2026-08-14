import type { ContextSet } from '../../domain/context/types.js';
import type { AgentRun, WorkItem } from '../../domain/run/types.js';
import type { AgentSession } from '../../domain/session/types.js';
import type { StartRunInput } from './types.js';
import type { RunDelivery, RunExecutionBudget, RunExecutionEntry, RunExecutionNode } from '../../domain/run/execution-models.js';
import type { Message } from '@earendil-works/pi-ai';
import { runtimeDeliveryId } from '../../execution/runtime-delivery-state.js';

export interface PreparedRunRecords {
  session?: AgentSession;
  run: AgentRun;
  eventId: string;
  workItem: WorkItem;
  nodes: RunExecutionNode[];
  deliveries: RunDelivery[];
  executionEntries: RunExecutionEntry[];
  budget: RunExecutionBudget;
}

export function prepareRunRecords(input: {
  tenantId: string;
  principalId: string;
  runInput: StartRunInput;
  agentRevision: string;
  contexts: ContextSet;
  snapshot: AgentRun['contextSnapshot'];
  at: Date;
  executionPlan: AgentRun['executionPlanSnapshot'];
  generateId: () => string;
}): PreparedRunRecords {
  const { tenantId, principalId, runInput, agentRevision, contexts, snapshot, at, executionPlan, generateId } = input;
  const sessionId = runInput.sessionId ?? generateId();
  const session = runInput.sessionId === undefined ? {
    sessionId, tenantId, contexts, version: 0, createdAt: cloneDate(at), updatedAt: cloneDate(at),
  } : undefined;
  const runId = generateId();
  const rootNodeId = `${runId}:root`;
  const participants = executionPlan?.participants ?? [{ agentId: runInput.agentId, revision: agentRevision, role: 'root' as const }];
  const team = executionPlan?.executionType === 'team';
  const nodes: RunExecutionNode[] = participants.map((participant, index) => ({
    nodeId: index === 0 ? rootNodeId : `${runId}:member:${index}`, runId, tenantId,
    kind: participant.role === 'root' ? 'root' : participant.role, role: participant.role,
    agentId: participant.agentId, agentRevision: participant.revision,
    status: team && index > 0 ? 'idle' : 'queued', depth: 0,
    createdAt: cloneDate(at), updatedAt: cloneDate(at), ...(index === 0 ? {} : { parentNodeId: rootNodeId }),
  }));
  const initialEntryId = team ? generateId() : undefined;
  const initialMessage = team ? teamTriggerMessage(runInput, at) : undefined;
  const deliveries: RunDelivery[] = (team ? nodes.slice(0, 1) : nodes).map((node) => ({
    deliveryId: runtimeDeliveryId(runId, node.nodeId), tenantId, runId, nodeId: node.nodeId,
    kind: 'message', batchId: `${runId}:initial`, depth: node.depth, status: 'queued', attempt: 0,
    ...(initialEntryId === undefined ? {} : { sourceEntryId: initialEntryId }),
    createdAt: cloneDate(at), updatedAt: cloneDate(at),
  }));
  const executionEntries: RunExecutionEntry[] = initialEntryId === undefined || initialMessage === undefined ? [] : [{
    entryId: initialEntryId, tenantId, runId, nodeId: rootNodeId, sequence: 1, kind: 'message',
    message: initialMessage, audience: 'public', visibility: 'session', createdAt: cloneDate(at),
  }];
  return {
    ...(session ? { session } : {}),
    run: {
      runId, tenantId, principalId, sessionId, agentId: runInput.agentId, agentRevision,
      status: 'queued', trigger: runInput.trigger, executionType: executionPlan?.executionType,
      executionPlanSnapshot: executionPlan, rootNodeId, contextSnapshot: structuredClone(snapshot),
      createdAt: cloneDate(at), updatedAt: cloneDate(at),
    },
    eventId: generateId(),
    workItem: { workItemId: generateId(), runId, status: 'queued', attempt: 0, createdAt: cloneDate(at), updatedAt: cloneDate(at) },
    nodes, deliveries,
    executionEntries,
    budget: { tenantId, runId, agentRuns: nodes.length, messages: executionEntries.length, tokens: 0, updatedAt: cloneDate(at) },
  };
}

function teamTriggerMessage(input: StartRunInput, at: Date): Message {
  const content = input.trigger.type === 'message' ? structuredClone(input.trigger.content) : JSON.stringify(input.trigger.input);
  return { role: 'user', content, timestamp: at.getTime() } as Message;
}

function cloneDate(value: Date): Date { return new Date(value.getTime()); }
