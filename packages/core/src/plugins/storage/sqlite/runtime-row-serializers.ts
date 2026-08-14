import type { Artifact } from '../../../domain/artifact/types.js';
import type { RunEvent } from '../../../domain/event/types.js';
import type { AgentRun, ToolInvocation, WorkItem } from '../../../domain/run/types.js';
import type { RunExecutionBudget } from '../../../domain/run/execution-models.js';
import type { AgentSession, RuntimeSessionEntry } from '../../../domain/session/types.js';
import type { IdempotencyRecord } from '../../../sdk/runtime-storage.js';
import type { RuntimeArtifactRow, RuntimeEventRow, RuntimeIdempotencyRow, RuntimeRunRow,
  RuntimeSessionEntryRow, RuntimeSessionRow, RuntimeToolInvocationRow, RuntimeWorkItemRow, RuntimeExecutionBudgetRow,
} from './runtime-row-types.js';
import { invalidRuntimeInput } from './runtime-sqlite-error.js';

function json(value: unknown, column: string): string {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError(`${column} cannot encode undefined`);
    return encoded;
  } catch (error) { return invalidRuntimeInput(`Cannot encode ${column}`, error); }
}

function date(value: Date, column: string): string {
  try { return value.toISOString(); }
  catch (error) { return invalidRuntimeInput(`Cannot encode ${column}`, error); }
}

export const sessionToRow = (value: AgentSession): RuntimeSessionRow => ({
  id: value.sessionId, tenant_id: value.tenantId, contexts_json: json({ ...value.contexts, ...(value.version === undefined ? {} : { __version: value.version }) }, 'contexts_json'),
  created_at: date(value.createdAt, 'created_at'), updated_at: date(value.updatedAt, 'updated_at'),
});

export const runToRow = (value: AgentRun): RuntimeRunRow => ({
  id: value.runId, tenant_id: value.tenantId, principal_id: value.principalId,
  session_id: value.sessionId, agent_id: value.agentId, agent_revision: value.agentRevision,
  status: value.status, trigger_json: json(value.trigger, 'trigger_json'),
  // v12 keeps the runtime table stable; the optional execution plan travels in
  // the snapshot envelope so old databases can read new Runs without a DDL cut.
  context_snapshot_json: json({
    ...value.contextSnapshot,
    ...(value.executionType === undefined ? {} : { __executionType: value.executionType }),
    ...(value.executionPlanSnapshot === undefined ? {} : { __executionPlanSnapshot: value.executionPlanSnapshot }),
    ...(value.primaryArtifactId === undefined ? {} : { __primaryArtifactId: value.primaryArtifactId }),
    ...(value.rootNodeId === undefined ? {} : { __rootNodeId: value.rootNodeId }),
  }, 'context_snapshot_json'),
  waiting_reason: value.waitingReason ?? null, error_code: value.errorCode ?? null,
  cancellation_requested_at: value.cancellationRequestedAt ? date(value.cancellationRequestedAt, 'cancellation_requested_at') : null,
  created_at: date(value.createdAt, 'created_at'), started_at: value.startedAt ? date(value.startedAt, 'started_at') : null,
  finished_at: value.finishedAt ? date(value.finishedAt, 'finished_at') : null, updated_at: date(value.updatedAt, 'updated_at'),
});

export const eventToRow = (value: RunEvent): RuntimeEventRow => ({
  id: value.eventId, sequence: value.sequence, schema_version: value.schemaVersion,
  tenant_id: value.tenantId, session_id: value.sessionId, run_id: value.runId, type: value.type,
  data_json: json(value.data, 'data_json'), occurred_at: date(value.occurredAt, 'occurred_at'),
});

export const workItemToRow = (value: WorkItem): RuntimeWorkItemRow => ({
  id: value.workItemId, run_id: value.runId, status: value.status, lease_owner: value.leaseOwner ?? null,
  lease_expires_at: value.leaseExpiresAt ? date(value.leaseExpiresAt, 'lease_expires_at') : null,
  attempt: value.attempt, created_at: date(value.createdAt, 'created_at'), updated_at: date(value.updatedAt, 'updated_at'),
});

export const sessionEntryToRow = (value: RuntimeSessionEntry): RuntimeSessionEntryRow => ({
  id: value.entryId, tenant_id: value.tenantId, session_id: value.sessionId, run_id: value.runId,
  sequence: value.sequence, message_json: json(value.message, 'message_json'),
  metadata_json: value.metadata === undefined ? null : json(value.metadata, 'metadata_json'),
  created_at: date(value.createdAt, 'created_at'),
});

export const artifactToRow = (value: Artifact): RuntimeArtifactRow => ({
  id: value.artifactId, tenant_id: value.tenantId, session_id: value.sessionId, run_id: value.runId,
  type: value.type, media_type: value.mediaType, name: value.name, data: value.data ?? null,
  uri: value.uri ?? null, metadata_json: value.metadata === undefined ? null : json(value.metadata, 'metadata_json'),
  created_at: date(value.createdAt, 'created_at'),
});

export const idempotencyToRow = (value: IdempotencyRecord): RuntimeIdempotencyRow => ({
  tenant_id: value.tenantId, operation: value.operation, idempotency_key: value.idempotencyKey,
  request_hash: value.requestHash, resource_id: value.resourceId, created_at: date(value.createdAt, 'created_at'),
});

export const toolInvocationToRow = (value: ToolInvocation): RuntimeToolInvocationRow => ({
  id: value.invocationId, tenant_id: value.tenantId, session_id: value.sessionId, run_id: value.runId,
  node_id: value.nodeId ?? 'root',
  tool_call_id: value.toolCallId, tool_name: value.toolName, status: value.status, side_effect: value.sideEffect,
  supports_idempotency_key: value.supportsIdempotencyKey ? 1 : 0, input_json: json(value.input, 'input_json'),
  result_json: value.result === undefined ? null : json(value.result, 'result_json'), error: value.error ?? null,
  created_at: date(value.createdAt, 'created_at'), updated_at: date(value.updatedAt, 'updated_at'),
});

export const executionBudgetToRow = (value: RunExecutionBudget): RuntimeExecutionBudgetRow => ({
  tenant_id: value.tenantId, run_id: value.runId, agent_runs: value.agentRuns,
  messages: value.messages, tokens: value.tokens, updated_at: date(value.updatedAt, 'updated_at'),
});
