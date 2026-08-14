import type { Message } from '@earendil-works/pi-ai';
import type { RunExecutionEntry, RunExecutionNode, RunDelivery, ExecutionEntryAudience } from '../../../domain/run/execution-models.js';
import type { RuntimeExecutionEntryRow, RuntimeExecutionNodeRow, RuntimeDeliveryRow } from './runtime-row-types.js';
import { validateMessage } from './runtime-message-validation.js';
import { runtimeDate, runtimeEnum, runtimeInteger, runtimeJson, runtimeOptionalDate, runtimeOptionalText, runtimeText } from './runtime-row-validation.js';

const nodeKinds = ['root', 'organizer', 'member', 'delegated'] as const;
const nodeStatuses = ['queued', 'idle', 'running', 'waiting', 'completed', 'failed', 'cancelled'] as const;
const entryKinds = ['message', 'tool-result', 'control'] as const;
const audiences = ['public', 'organizer', 'internal'] as const;
const visibilities = ['session', 'run'] as const;
const deliveryKinds = ['message', 'resume'] as const;
const deliveryStatuses = ['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled'] as const;
const parse = <T>(value: string, column: string): T => runtimeJson<T>(value, column);

export function mapExecutionNodeRow(row: RuntimeExecutionNodeRow): RunExecutionNode {
  return {
    nodeId: runtimeText(row.id, 'id'), tenantId: runtimeText(row.tenant_id, 'tenant_id'), runId: runtimeText(row.run_id, 'run_id'),
    parentNodeId: runtimeOptionalText(row.parent_node_id, 'parent_node_id'), kind: runtimeEnum(row.kind, 'kind', nodeKinds),
    role: runtimeText(row.role, 'role'), agentId: runtimeText(row.agent_id, 'agent_id'), agentRevision: runtimeText(row.agent_revision, 'agent_revision'),
    status: runtimeEnum(row.status, 'status', nodeStatuses), depth: runtimeInteger(row.depth, 'depth', 0),
    createdAt: runtimeDate(row.created_at, 'created_at'), startedAt: runtimeOptionalDate(row.started_at, 'started_at'),
    finishedAt: runtimeOptionalDate(row.finished_at, 'finished_at'), updatedAt: runtimeDate(row.updated_at, 'updated_at'),
  };
}

export function mapExecutionEntryRow(row: RuntimeExecutionEntryRow): RunExecutionEntry {
  const message = row.message_json === null ? undefined : runtimeJson<Message>(row.message_json, 'message_json', validateMessage);
  return {
    entryId: runtimeText(row.id, 'id'), tenantId: runtimeText(row.tenant_id, 'tenant_id'), runId: runtimeText(row.run_id, 'run_id'),
    nodeId: runtimeText(row.node_id, 'node_id'), sequence: runtimeInteger(row.sequence, 'sequence', 1), kind: runtimeEnum(row.kind, 'kind', entryKinds),
    ...(message === undefined ? {} : { message }),
    ...(row.data_json === null ? {} : { data: parse<unknown>(row.data_json, 'data_json') as RunExecutionEntry['data'] }),
    audience: runtimeEnum(row.audience, 'audience', audiences) as ExecutionEntryAudience,
    visibility: runtimeEnum(row.visibility, 'visibility', visibilities), createdAt: runtimeDate(row.created_at, 'created_at'),
  };
}

export function mapDeliveryRow(row: RuntimeDeliveryRow): RunDelivery {
  return {
    deliveryId: runtimeText(row.id, 'id'), tenantId: runtimeText(row.tenant_id, 'tenant_id'), runId: runtimeText(row.run_id, 'run_id'),
    nodeId: runtimeText(row.node_id, 'node_id'), kind: runtimeEnum(row.kind, 'kind', deliveryKinds), batchId: runtimeText(row.batch_id, 'batch_id'),
    depth: runtimeInteger(row.depth, 'depth', 0), status: runtimeEnum(row.status, 'status', deliveryStatuses),
    requestedByNodeId: runtimeOptionalText(row.requested_by_node_id, 'requested_by_node_id'),
    sourceEntryId: runtimeOptionalText(row.source_entry_id, 'source_entry_id'),
    resultEntryId: runtimeOptionalText(row.result_entry_id, 'result_entry_id'),
    attempt: runtimeInteger(row.attempt, 'attempt', 0), errorCode: runtimeOptionalText(row.error_code, 'error_code'),
    createdAt: runtimeDate(row.created_at, 'created_at'), updatedAt: runtimeDate(row.updated_at, 'updated_at'),
  };
}
