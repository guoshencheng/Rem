import type { RunExecutionEntry, RunExecutionNode, RunDelivery } from '../../../domain/run/execution-models.js';
import type { RuntimeExecutionEntryRow, RuntimeExecutionNodeRow, RuntimeDeliveryRow } from './runtime-row-types.js';
import { invalidRuntimeInput } from './runtime-sqlite-error.js';

const json = (value: unknown, column: string): string => {
  try {
    const result = JSON.stringify(value);
    if (result === undefined) throw new TypeError(`${column} cannot encode undefined`);
    return result;
  } catch (error) { return invalidRuntimeInput(`Cannot encode ${column}`, error); }
};
const date = (value: Date, column: string): string => {
  try { return value.toISOString(); } catch (error) { return invalidRuntimeInput(`Cannot encode ${column}`, error); }
};

export const executionNodeToRow = (value: RunExecutionNode): RuntimeExecutionNodeRow => ({
  id: value.nodeId, tenant_id: value.tenantId, run_id: value.runId, parent_node_id: value.parentNodeId ?? null,
  kind: value.kind, role: value.role, agent_id: value.agentId, agent_revision: value.agentRevision,
  status: value.status, depth: value.depth, created_at: date(value.createdAt, 'created_at'),
  started_at: value.startedAt ? date(value.startedAt, 'started_at') : null,
  finished_at: value.finishedAt ? date(value.finishedAt, 'finished_at') : null,
  updated_at: date(value.updatedAt, 'updated_at'),
});

export const executionEntryToRow = (value: RunExecutionEntry): RuntimeExecutionEntryRow => ({
  id: value.entryId, tenant_id: value.tenantId, run_id: value.runId, node_id: value.nodeId,
  sequence: value.sequence, kind: value.kind, message_json: value.message === undefined ? null : json(value.message, 'message_json'),
  data_json: value.data === undefined ? null : json(value.data, 'data_json'), audience: value.audience,
  visibility: value.visibility, created_at: date(value.createdAt, 'created_at'),
});

export const deliveryToRow = (value: RunDelivery): RuntimeDeliveryRow => ({
  id: value.deliveryId, tenant_id: value.tenantId, run_id: value.runId, node_id: value.nodeId,
  kind: value.kind, batch_id: value.batchId, depth: value.depth, status: value.status,
  requested_by_node_id: value.requestedByNodeId ?? null, source_entry_id: value.sourceEntryId ?? null,
  result_entry_id: value.resultEntryId ?? null, attempt: value.attempt, error_code: value.errorCode ?? null,
  created_at: date(value.createdAt, 'created_at'), updated_at: date(value.updatedAt, 'updated_at'),
});
