export interface RuntimeSessionRow {
  id: string; tenant_id: string; contexts_json: string; created_at: string; updated_at: string;
}

export interface RuntimeRunRow {
  id: string; tenant_id: string; principal_id: string; session_id: string;
  agent_id: string; agent_revision: string; status: string; trigger_json: string;
  context_snapshot_json: string; waiting_reason: string | null; error_code: string | null;
  cancellation_requested_at: string | null; created_at: string; started_at: string | null;
  finished_at: string | null; updated_at: string;
}

export interface RuntimeEventRow {
  id: string; sequence: number; schema_version: number; tenant_id: string;
  session_id: string; run_id: string; type: string; data_json: string; occurred_at: string;
}

export interface RuntimeWorkItemRow {
  id: string; run_id: string; status: string; lease_owner: string | null;
  lease_expires_at: string | null; attempt: number; created_at: string; updated_at: string;
}

export interface RuntimeSessionEntryRow {
  id: string; tenant_id: string; session_id: string; run_id: string; sequence: number;
  message_json: string; metadata_json: string | null; created_at: string;
}

export interface RuntimeArtifactRow {
  id: string; tenant_id: string; session_id: string; run_id: string; type: string;
  media_type: string; name: string; data: string | null; uri: string | null;
  metadata_json: string | null; created_at: string;
}

export interface RuntimeIdempotencyRow {
  tenant_id: string; operation: string; idempotency_key: string; request_hash: string;
  resource_id: string; created_at: string;
}

export interface RuntimeToolInvocationRow {
  id: string; tenant_id: string; session_id: string; run_id: string; node_id: string; tool_call_id: string;
  tool_name: string; status: string; side_effect: string; supports_idempotency_key: number;
  input_json: string; result_json: string | null; error: string | null;
  created_at: string; updated_at: string;
}

export interface RuntimeExecutionNodeRow {
  id: string; tenant_id: string; run_id: string; parent_node_id: string | null;
  kind: string; role: string; agent_id: string; agent_revision: string; status: string;
  depth: number; created_at: string; started_at: string | null; finished_at: string | null; updated_at: string;
}

export interface RuntimeExecutionEntryRow {
  id: string; tenant_id: string; run_id: string; node_id: string; sequence: number; kind: string;
  message_json: string | null; data_json: string | null; audience: string; visibility: string; created_at: string;
}

export interface RuntimeDeliveryRow {
  id: string; tenant_id: string; run_id: string; node_id: string; kind: string; batch_id: string;
  depth: number; status: string; requested_by_node_id: string | null; source_entry_id: string | null;
  result_entry_id: string | null; attempt: number; error_code: string | null; created_at: string; updated_at: string;
}

export interface RuntimeExecutionBudgetRow {
  tenant_id: string; run_id: string; agent_runs: number; messages: number; tokens: number; updated_at: string;
}
