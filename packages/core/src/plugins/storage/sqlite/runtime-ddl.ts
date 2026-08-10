export const RUNTIME_TABLE_NAMES = [
  'runtime_sessions',
  'runtime_runs',
  'runtime_events',
  'runtime_work_items',
  'runtime_session_entries',
  'runtime_artifacts',
  'runtime_idempotency',
  'runtime_tool_invocations',
] as const;

export type RuntimeTableName = (typeof RUNTIME_TABLE_NAMES)[number];

export const RUNTIME_DDL = `
  CREATE TABLE IF NOT EXISTS runtime_sessions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    contexts_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_runtime_sessions_tenant_updated
    ON runtime_sessions(tenant_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS runtime_runs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    agent_revision TEXT NOT NULL,
    status TEXT NOT NULL,
    trigger_json TEXT NOT NULL,
    context_snapshot_json TEXT NOT NULL,
    waiting_reason TEXT,
    error_code TEXT,
    cancellation_requested_at TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES runtime_sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_runtime_runs_session_created
    ON runtime_runs(session_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS runtime_events (
    id TEXT PRIMARY KEY,
    sequence INTEGER NOT NULL,
    schema_version INTEGER NOT NULL,
    tenant_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    type TEXT NOT NULL,
    data_json TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    UNIQUE (run_id, sequence),
    FOREIGN KEY (session_id) REFERENCES runtime_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (run_id) REFERENCES runtime_runs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS runtime_work_items (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    lease_owner TEXT,
    lease_expires_at TEXT,
    attempt INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runtime_runs(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_runtime_work_claim
    ON runtime_work_items(status, lease_expires_at, created_at);

  CREATE TABLE IF NOT EXISTS runtime_session_entries (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    message_json TEXT NOT NULL,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (session_id, sequence),
    FOREIGN KEY (session_id) REFERENCES runtime_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (run_id) REFERENCES runtime_runs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS runtime_artifacts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    type TEXT NOT NULL,
    media_type TEXT NOT NULL,
    name TEXT NOT NULL,
    data TEXT,
    uri TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES runtime_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (run_id) REFERENCES runtime_runs(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_runtime_artifacts_run ON runtime_artifacts(run_id);

  CREATE TABLE IF NOT EXISTS runtime_idempotency (
    tenant_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, operation, idempotency_key)
  );

  CREATE TABLE IF NOT EXISTS runtime_tool_invocations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    tool_call_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    status TEXT NOT NULL,
    side_effect TEXT NOT NULL,
    supports_idempotency_key INTEGER NOT NULL,
    input_json TEXT NOT NULL,
    result_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (run_id, tool_call_id),
    FOREIGN KEY (session_id) REFERENCES runtime_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (run_id) REFERENCES runtime_runs(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_runtime_tool_invocations_run
    ON runtime_tool_invocations(run_id);
`;
