import type { Message } from '@earendil-works/pi-ai';
import type { Artifact } from '../../../domain/artifact/types.js';
import type { ContextSet, ResolvedContextSnapshot } from '../../../domain/context/types.js';
import type { RunEvent } from '../../../domain/event/types.js';
import type { AgentRun, RunStatus, RunTrigger, ToolInvocation, WorkItem } from '../../../domain/run/types.js';
import type { AgentSession, RuntimeSessionEntry } from '../../../domain/session/types.js';
import type { IdempotencyRecord } from '../../../sdk/runtime-storage.js';
import type { RuntimeArtifactRow, RuntimeEventRow, RuntimeIdempotencyRow, RuntimeRunRow,
  RuntimeSessionEntryRow, RuntimeSessionRow, RuntimeToolInvocationRow, RuntimeWorkItemRow,
} from './runtime-row-types.js';
import { requirePlainObject, runtimeBoolean, runtimeDate, runtimeEnum, runtimeInteger, runtimeIntegerEnum,
  runtimeJson, runtimeOptionalDate, runtimeOptionalEnum, runtimeOptionalText, runtimeText,
  validateContextSet, validateContextSnapshot, validateMessage, validateTrigger,
} from './runtime-row-validation.js';

const runStatuses = ['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled'] as const;
const workStatuses = ['queued', 'leased', 'completed', 'failed'] as const;
const toolStatuses = ['planned', 'executing', 'succeeded', 'failed', 'unknown'] as const;
const sideEffects = ['none', 'idempotent', 'non-idempotent'] as const;

export const mapSessionRow = (row: RuntimeSessionRow): AgentSession => ({
  sessionId: runtimeText(row.id, 'id'), tenantId: runtimeText(row.tenant_id, 'tenant_id'),
  contexts: runtimeJson<ContextSet>(row.contexts_json, 'contexts_json', validateContextSet),
  createdAt: runtimeDate(row.created_at, 'created_at'), updatedAt: runtimeDate(row.updated_at, 'updated_at'),
});

export const mapRunRow = (row: RuntimeRunRow): AgentRun => ({
  runId: runtimeText(row.id, 'id'), tenantId: runtimeText(row.tenant_id, 'tenant_id'),
  principalId: runtimeText(row.principal_id, 'principal_id'), sessionId: runtimeText(row.session_id, 'session_id'),
  agentId: runtimeText(row.agent_id, 'agent_id'), agentRevision: runtimeText(row.agent_revision, 'agent_revision'),
  status: runtimeEnum(row.status, 'status', runStatuses) as RunStatus,
  trigger: runtimeJson<RunTrigger>(row.trigger_json, 'trigger_json', validateTrigger),
  contextSnapshot: runtimeJson<ResolvedContextSnapshot>(row.context_snapshot_json, 'context_snapshot_json', validateContextSnapshot),
  waitingReason: runtimeOptionalEnum(row.waiting_reason, 'waiting_reason', ['recovery'] as const),
  errorCode: runtimeOptionalText(row.error_code, 'error_code'),
  cancellationRequestedAt: runtimeOptionalDate(row.cancellation_requested_at, 'cancellation_requested_at'),
  createdAt: runtimeDate(row.created_at, 'created_at'), startedAt: runtimeOptionalDate(row.started_at, 'started_at'),
  finishedAt: runtimeOptionalDate(row.finished_at, 'finished_at'), updatedAt: runtimeDate(row.updated_at, 'updated_at'),
});

export const mapEventRow = (row: RuntimeEventRow): RunEvent => ({
  eventId: runtimeText(row.id, 'id'), sequence: runtimeInteger(row.sequence, 'sequence', 1),
  schemaVersion: runtimeIntegerEnum(row.schema_version, 'schema_version', [1] as const),
  tenantId: runtimeText(row.tenant_id, 'tenant_id'), sessionId: runtimeText(row.session_id, 'session_id'),
  runId: runtimeText(row.run_id, 'run_id'), type: runtimeText(row.type, 'type'),
  data: runtimeJson<unknown>(row.data_json, 'data_json'), occurredAt: runtimeDate(row.occurred_at, 'occurred_at'),
});

export const mapWorkItemRow = (row: RuntimeWorkItemRow): WorkItem => ({
  workItemId: runtimeText(row.id, 'id'), runId: runtimeText(row.run_id, 'run_id'),
  status: runtimeEnum(row.status, 'status', workStatuses), leaseOwner: runtimeOptionalText(row.lease_owner, 'lease_owner'),
  leaseExpiresAt: runtimeOptionalDate(row.lease_expires_at, 'lease_expires_at'),
  attempt: runtimeInteger(row.attempt, 'attempt', 0), createdAt: runtimeDate(row.created_at, 'created_at'),
  updatedAt: runtimeDate(row.updated_at, 'updated_at'),
});

export const mapSessionEntryRow = (row: RuntimeSessionEntryRow): RuntimeSessionEntry => ({
  entryId: runtimeText(row.id, 'id'), tenantId: runtimeText(row.tenant_id, 'tenant_id'),
  sessionId: runtimeText(row.session_id, 'session_id'), runId: runtimeText(row.run_id, 'run_id'),
  sequence: runtimeInteger(row.sequence, 'sequence', 1),
  message: runtimeJson<Message>(row.message_json, 'message_json', validateMessage),
  metadata: row.metadata_json === null ? undefined : runtimeJson<Record<string, unknown>>(row.metadata_json, 'metadata_json', requirePlainObject),
  createdAt: runtimeDate(row.created_at, 'created_at'),
});

export const mapArtifactRow = (row: RuntimeArtifactRow): Artifact => ({
  artifactId: runtimeText(row.id, 'id'), tenantId: runtimeText(row.tenant_id, 'tenant_id'),
  sessionId: runtimeText(row.session_id, 'session_id'), runId: runtimeText(row.run_id, 'run_id'),
  type: runtimeText(row.type, 'type'), mediaType: runtimeText(row.media_type, 'media_type'),
  name: runtimeText(row.name, 'name'), data: runtimeOptionalText(row.data, 'data', true), uri: runtimeOptionalText(row.uri, 'uri'),
  metadata: row.metadata_json === null ? undefined : runtimeJson<Record<string, unknown>>(row.metadata_json, 'metadata_json', requirePlainObject),
  createdAt: runtimeDate(row.created_at, 'created_at'),
});

export const mapIdempotencyRow = (row: RuntimeIdempotencyRow): IdempotencyRecord => ({
  tenantId: runtimeText(row.tenant_id, 'tenant_id'),
  operation: runtimeEnum(row.operation, 'operation', ['start-run'] as const),
  idempotencyKey: runtimeText(row.idempotency_key, 'idempotency_key'), requestHash: runtimeText(row.request_hash, 'request_hash'),
  resourceId: runtimeText(row.resource_id, 'resource_id'), createdAt: runtimeDate(row.created_at, 'created_at'),
});

export const mapToolInvocationRow = (row: RuntimeToolInvocationRow): ToolInvocation => ({
  invocationId: runtimeText(row.id, 'id'), tenantId: runtimeText(row.tenant_id, 'tenant_id'),
  sessionId: runtimeText(row.session_id, 'session_id'), runId: runtimeText(row.run_id, 'run_id'),
  toolCallId: runtimeText(row.tool_call_id, 'tool_call_id'), toolName: runtimeText(row.tool_name, 'tool_name'),
  status: runtimeEnum(row.status, 'status', toolStatuses), sideEffect: runtimeEnum(row.side_effect, 'side_effect', sideEffects),
  supportsIdempotencyKey: runtimeBoolean(row.supports_idempotency_key, 'supports_idempotency_key'),
  input: runtimeJson<unknown>(row.input_json, 'input_json'),
  result: row.result_json === null ? undefined : runtimeJson<unknown>(row.result_json, 'result_json'),
  error: runtimeOptionalText(row.error, 'error', true), createdAt: runtimeDate(row.created_at, 'created_at'),
  updatedAt: runtimeDate(row.updated_at, 'updated_at'),
});
