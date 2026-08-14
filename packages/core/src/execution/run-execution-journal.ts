import type { Message } from '@earendil-works/pi-ai';
import type { AgentRun } from '../domain/run/types.js';
import type { JsonValue } from '../domain/json/types.js';
import type { RuntimeStorage } from '../sdk/runtime-storage.js';
import { generateId as defaultGenerateId } from '../shared/generate-id.js';
import { consumeExecutionMessage } from './run-execution-budget.js';
import { cloneCanonicalJson } from '../application/contexts/canonical-json.js';

/** Persists complete messages only; token deltas remain a live-signal concern. */
export async function appendRunExecutionMessage(
  storage: RuntimeStorage,
  run: AgentRun,
  message: Message,
  now: Date,
): Promise<void> {
  await storage.transaction((uow) => {
    consumeExecutionMessage(uow, run, message, now);
    const nodeId = run.rootNodeId ?? `${run.runId}:root`;
    const publicRoot = nodeId === `${run.runId}:root`;
    const team = run.executionPlanSnapshot?.executionType === 'team';
    uow.executionEntries.append({
      entryId: defaultGenerateId(), tenantId: run.tenantId, runId: run.runId,
      nodeId, sequence: uow.executionEntries.nextSequence(run.runId),
      kind: message.role === 'toolResult' ? 'tool-result' : 'message', message: structuredClone(message),
      audience: publicRoot && !team ? 'public' : message.role === 'user' && publicRoot ? 'public' : 'internal',
      visibility: (publicRoot && !team) || (message.role === 'user' && publicRoot) ? 'session' : 'run',
      createdAt: new Date(now.getTime()),
    });
  });
}

export async function appendRunExecutionControl(
  storage: RuntimeStorage,
  run: AgentRun,
  data: Record<string, unknown>,
  now: Date,
  generateId: () => string = defaultGenerateId,
): Promise<void> {
  await storage.transaction((uow) => appendRunExecutionControlEntry(uow, run, data, now, generateId));
}

export function appendRunExecutionControlEntry(
  uow: import('../sdk/runtime-storage.js').RuntimeUnitOfWork,
  run: AgentRun,
  data: Record<string, unknown>,
  now: Date,
  generateId: () => string = defaultGenerateId,
  nodeId?: string,
): void {
  uow.executionEntries.append({
    entryId: generateId(), tenantId: run.tenantId, runId: run.runId,
    nodeId: nodeId ?? run.rootNodeId ?? `${run.runId}:root`, sequence: uow.executionEntries.nextSequence(run.runId),
    kind: 'control', data: cloneCanonicalJson(data, { omitUndefinedProperties: true }) as JsonValue, audience: 'internal', visibility: 'run',
    createdAt: new Date(now.getTime()),
  });
}
