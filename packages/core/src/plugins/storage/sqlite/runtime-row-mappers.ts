import type { Message } from '@earendil-works/pi-ai';
import type { Artifact } from '../../../domain/artifact/types.js';
import type { ContextSet } from '../../../domain/context/types.js';
import type { RunEvent } from '../../../domain/event/types.js';
import type { AgentRun, RunStatus, RunTrigger, ToolInvocation, WorkItem } from '../../../domain/run/types.js';
import type { AgentSession, RuntimeSessionEntry } from '../../../domain/session/types.js';
import type { ResolvedContextSnapshot } from '../../../domain/context/types.js';
import type { IdempotencyRecord } from '../../../sdk/runtime-storage.js';
import type { RuntimeArtifactRow, RuntimeEventRow, RuntimeIdempotencyRow, RuntimeRunRow,
  RuntimeSessionEntryRow, RuntimeSessionRow, RuntimeToolInvocationRow, RuntimeWorkItemRow,
} from './runtime-row-types.js';
import { corruptRuntimeRow } from './runtime-sqlite-error.js';

function json<T>(value: string, column: string): T {
  try { return JSON.parse(value) as T; }
  catch (error) { return corruptRuntimeRow(`Invalid JSON in ${column}`, error); }
}

function date(value: string, column: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return corruptRuntimeRow(`Invalid date in ${column}`, new RangeError(value));
  return parsed;
}

const optionalDate = (value: string | null, column: string): Date | undefined => value === null ? undefined : date(value, column);

export const mapSessionRow = (row: RuntimeSessionRow): AgentSession => ({
  sessionId: row.id, tenantId: row.tenant_id, contexts: json<ContextSet>(row.contexts_json, 'contexts_json'),
  createdAt: date(row.created_at, 'created_at'), updatedAt: date(row.updated_at, 'updated_at'),
});

export const mapRunRow = (row: RuntimeRunRow): AgentRun => ({
  runId: row.id, tenantId: row.tenant_id, principalId: row.principal_id, sessionId: row.session_id,
  agentId: row.agent_id, agentRevision: row.agent_revision, status: row.status as RunStatus,
  trigger: json<RunTrigger>(row.trigger_json, 'trigger_json'),
  contextSnapshot: json<ResolvedContextSnapshot>(row.context_snapshot_json, 'context_snapshot_json'),
  waitingReason: row.waiting_reason as AgentRun['waitingReason'] ?? undefined,
  errorCode: row.error_code ?? undefined, cancellationRequestedAt: optionalDate(row.cancellation_requested_at, 'cancellation_requested_at'),
  createdAt: date(row.created_at, 'created_at'), startedAt: optionalDate(row.started_at, 'started_at'),
  finishedAt: optionalDate(row.finished_at, 'finished_at'), updatedAt: date(row.updated_at, 'updated_at'),
});

export const mapEventRow = (row: RuntimeEventRow): RunEvent => ({
  eventId: row.id, sequence: row.sequence, schemaVersion: row.schema_version as 1,
  tenantId: row.tenant_id, sessionId: row.session_id, runId: row.run_id, type: row.type,
  data: json<unknown>(row.data_json, 'data_json'), occurredAt: date(row.occurred_at, 'occurred_at'),
});

export const mapWorkItemRow = (row: RuntimeWorkItemRow): WorkItem => ({
  workItemId: row.id, runId: row.run_id, status: row.status as WorkItem['status'],
  leaseOwner: row.lease_owner ?? undefined, leaseExpiresAt: optionalDate(row.lease_expires_at, 'lease_expires_at'),
  attempt: row.attempt, createdAt: date(row.created_at, 'created_at'), updatedAt: date(row.updated_at, 'updated_at'),
});

export const mapSessionEntryRow = (row: RuntimeSessionEntryRow): RuntimeSessionEntry => ({
  entryId: row.id, tenantId: row.tenant_id, sessionId: row.session_id, runId: row.run_id,
  sequence: row.sequence, message: json<Message>(row.message_json, 'message_json'),
  metadata: row.metadata_json === null ? undefined : json<Record<string, unknown>>(row.metadata_json, 'metadata_json'),
  createdAt: date(row.created_at, 'created_at'),
});

export const mapArtifactRow = (row: RuntimeArtifactRow): Artifact => ({
  artifactId: row.id, tenantId: row.tenant_id, sessionId: row.session_id, runId: row.run_id,
  type: row.type, mediaType: row.media_type, name: row.name, data: row.data ?? undefined,
  uri: row.uri ?? undefined, metadata: row.metadata_json === null ? undefined : json<Record<string, unknown>>(row.metadata_json, 'metadata_json'),
  createdAt: date(row.created_at, 'created_at'),
});

export const mapIdempotencyRow = (row: RuntimeIdempotencyRow): IdempotencyRecord => ({
  tenantId: row.tenant_id, operation: row.operation as 'start-run', idempotencyKey: row.idempotency_key,
  requestHash: row.request_hash, resourceId: row.resource_id, createdAt: date(row.created_at, 'created_at'),
});

export const mapToolInvocationRow = (row: RuntimeToolInvocationRow): ToolInvocation => ({
  invocationId: row.id, tenantId: row.tenant_id, sessionId: row.session_id, runId: row.run_id,
  toolCallId: row.tool_call_id, toolName: row.tool_name, status: row.status as ToolInvocation['status'],
  sideEffect: row.side_effect as ToolInvocation['sideEffect'], supportsIdempotencyKey: row.supports_idempotency_key !== 0,
  input: json<unknown>(row.input_json, 'input_json'), result: row.result_json === null ? undefined : json<unknown>(row.result_json, 'result_json'),
  error: row.error ?? undefined, createdAt: date(row.created_at, 'created_at'), updatedAt: date(row.updated_at, 'updated_at'),
});
