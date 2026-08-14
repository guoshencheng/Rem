import type { Message } from '@earendil-works/pi-ai';
import type { Artifact } from '../../../domain/artifact/types.js';
import type { ContextSet, ResolvedContextSnapshot } from '../../../domain/context/types.js';
import type { RunEvent } from '../../../domain/event/types.js';
import type { AgentRun, RunStatus, RunTrigger, ToolInvocation, WorkItem } from '../../../domain/run/types.js';
import type { RunExecutionBudget } from '../../../domain/run/execution-models.js';
import type { AgentSession, RuntimeSessionEntry } from '../../../domain/session/types.js';
import type { IdempotencyRecord } from '../../../sdk/runtime-storage.js';
import type { RuntimeArtifactRow, RuntimeEventRow, RuntimeIdempotencyRow, RuntimeRunRow,
  RuntimeSessionEntryRow, RuntimeSessionRow, RuntimeToolInvocationRow, RuntimeWorkItemRow, RuntimeExecutionBudgetRow,
} from './runtime-row-types.js';
import { validateMessage } from './runtime-message-validation.js';
import { requirePlainObject, runtimeBoolean, runtimeDate, runtimeEnum, runtimeInteger, runtimeIntegerEnum,
  runtimeJson, runtimeOptionalDate, runtimeOptionalEnum, runtimeOptionalText, runtimeText,
  validateContextSet, validateContextSnapshot, validateExecutionPlanSnapshot, validateTrigger,
} from './runtime-row-validation.js';

const runStatuses = ['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled'] as const;
const workStatuses = ['queued', 'leased', 'completed', 'failed'] as const;
const toolStatuses = ['planned', 'executing', 'succeeded', 'failed', 'unknown'] as const;
const sideEffects = ['none', 'idempotent', 'non-idempotent'] as const;

export const mapSessionRow = (row: RuntimeSessionRow): AgentSession => ({
  sessionId: runtimeText(row.id, 'id'), tenantId: runtimeText(row.tenant_id, 'tenant_id'),
  ...mapSessionContexts(row),
  createdAt: runtimeDate(row.created_at, 'created_at'), updatedAt: runtimeDate(row.updated_at, 'updated_at'),
});

function mapSessionContexts(row: RuntimeSessionRow): Pick<AgentSession, 'contexts' | 'version'> {
  const value = runtimeJson<ContextSet & { __version?: unknown }>(row.contexts_json, 'contexts_json', validateContextSet);
  const version = value.__version;
  const contexts = { ...value };
  delete contexts.__version;
  return { contexts: contexts as ContextSet, ...(Number.isSafeInteger(version) && (version as number) >= 0 ? { version: version as number } : {}) };
}

export const mapRunRow = (row: RuntimeRunRow): AgentRun => ({
  runId: runtimeText(row.id, 'id'), tenantId: runtimeText(row.tenant_id, 'tenant_id'),
  principalId: runtimeText(row.principal_id, 'principal_id'), sessionId: runtimeText(row.session_id, 'session_id'),
  agentId: runtimeText(row.agent_id, 'agent_id'), agentRevision: runtimeText(row.agent_revision, 'agent_revision'),
  status: runtimeEnum(row.status, 'status', runStatuses) as RunStatus,
  trigger: runtimeJson<RunTrigger>(row.trigger_json, 'trigger_json', validateTrigger),
  ...mapExecutionFields(row),
  waitingReason: runtimeOptionalEnum(row.waiting_reason, 'waiting_reason', ['recovery', 'tool-result-unknown'] as const),
  errorCode: runtimeOptionalText(row.error_code, 'error_code'),
  cancellationRequestedAt: runtimeOptionalDate(row.cancellation_requested_at, 'cancellation_requested_at'),
  createdAt: runtimeDate(row.created_at, 'created_at'), startedAt: runtimeOptionalDate(row.started_at, 'started_at'),
  finishedAt: runtimeOptionalDate(row.finished_at, 'finished_at'), updatedAt: runtimeDate(row.updated_at, 'updated_at'),
});

function mapExecutionFields(row: RuntimeRunRow): Pick<AgentRun, 'contextSnapshot' | 'executionType' | 'executionPlanSnapshot' | 'primaryArtifactId' | 'rootNodeId'> {
  const snapshot = runtimeJson<ResolvedContextSnapshot & Record<string, unknown>>(
    row.context_snapshot_json, 'context_snapshot_json', validateContextSnapshot,
  );
  const executionType = snapshot.__executionType;
  const plan = snapshot.__executionPlanSnapshot;
  if (plan !== undefined) validateExecutionPlanSnapshot(plan, 'context_snapshot_json.__executionPlanSnapshot');
  const primaryArtifactId = snapshot.__primaryArtifactId;
  const rootNodeId = snapshot.__rootNodeId;
  const contextSnapshot = { ...snapshot };
  delete contextSnapshot.__executionType;
  delete contextSnapshot.__executionPlanSnapshot;
  delete contextSnapshot.__primaryArtifactId;
  delete contextSnapshot.__rootNodeId;
  return {
    contextSnapshot: contextSnapshot as ResolvedContextSnapshot,
    ...(executionType === 'single-agent' || executionType === 'team' ? { executionType } : {}),
    ...(plan !== undefined ? { executionPlanSnapshot: plan as AgentRun['executionPlanSnapshot'] } : {}),
    ...(typeof primaryArtifactId === 'string' ? { primaryArtifactId } : {}),
    ...(typeof rootNodeId === 'string' ? { rootNodeId } : {}),
  };
}

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
  operation: runtimeEnum(row.operation, 'operation', ['start-run', 'resolve-tool-invocation'] as const),
  idempotencyKey: runtimeText(row.idempotency_key, 'idempotency_key'), requestHash: runtimeText(row.request_hash, 'request_hash'),
  resourceId: runtimeText(row.resource_id, 'resource_id'), createdAt: runtimeDate(row.created_at, 'created_at'),
});

export const mapToolInvocationRow = (row: RuntimeToolInvocationRow): ToolInvocation => ({
  invocationId: runtimeText(row.id, 'id'), tenantId: runtimeText(row.tenant_id, 'tenant_id'),
  sessionId: runtimeText(row.session_id, 'session_id'), runId: runtimeText(row.run_id, 'run_id'),
  ...(row.node_id === 'root' ? {} : { nodeId: runtimeText(row.node_id, 'node_id') }),
  toolCallId: runtimeText(row.tool_call_id, 'tool_call_id'), toolName: runtimeText(row.tool_name, 'tool_name'),
  status: runtimeEnum(row.status, 'status', toolStatuses), sideEffect: runtimeEnum(row.side_effect, 'side_effect', sideEffects),
  supportsIdempotencyKey: runtimeBoolean(row.supports_idempotency_key, 'supports_idempotency_key'),
  input: runtimeJson<unknown>(row.input_json, 'input_json'),
  result: row.result_json === null ? undefined : runtimeJson<unknown>(row.result_json, 'result_json'),
  error: runtimeOptionalText(row.error, 'error', true), createdAt: runtimeDate(row.created_at, 'created_at'),
  updatedAt: runtimeDate(row.updated_at, 'updated_at'),
});

export const mapExecutionBudgetRow = (row: RuntimeExecutionBudgetRow): RunExecutionBudget => ({
  tenantId: runtimeText(row.tenant_id, 'tenant_id'), runId: runtimeText(row.run_id, 'run_id'),
  agentRuns: runtimeInteger(row.agent_runs, 'agent_runs', 0), messages: runtimeInteger(row.messages, 'messages', 0),
  tokens: runtimeInteger(row.tokens, 'tokens', 0), updatedAt: runtimeDate(row.updated_at, 'updated_at'),
});
