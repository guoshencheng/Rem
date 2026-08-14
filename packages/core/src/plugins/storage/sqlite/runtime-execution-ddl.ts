export const RUNTIME_EXECUTION_DDL = `
  CREATE TABLE IF NOT EXISTS runtime_execution_nodes (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, run_id TEXT NOT NULL, parent_node_id TEXT,
    kind TEXT NOT NULL, role TEXT NOT NULL, agent_id TEXT NOT NULL, agent_revision TEXT NOT NULL,
    status TEXT NOT NULL, depth INTEGER NOT NULL, created_at TEXT NOT NULL, started_at TEXT,
    finished_at TEXT, updated_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runtime_runs(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_runtime_execution_nodes_run ON runtime_execution_nodes(run_id, created_at, id);
  CREATE TABLE IF NOT EXISTS runtime_execution_entries (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, run_id TEXT NOT NULL, node_id TEXT NOT NULL,
    sequence INTEGER NOT NULL, kind TEXT NOT NULL, message_json TEXT, data_json TEXT,
    audience TEXT NOT NULL, visibility TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE (run_id, sequence), FOREIGN KEY (run_id) REFERENCES runtime_runs(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_runtime_execution_entries_run ON runtime_execution_entries(run_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_runtime_execution_entries_node ON runtime_execution_entries(run_id, node_id, sequence);
  CREATE TABLE IF NOT EXISTS runtime_deliveries (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, run_id TEXT NOT NULL, node_id TEXT NOT NULL,
    kind TEXT NOT NULL, batch_id TEXT NOT NULL, depth INTEGER NOT NULL, status TEXT NOT NULL,
    requested_by_node_id TEXT, source_entry_id TEXT, result_entry_id TEXT,
    attempt INTEGER NOT NULL DEFAULT 0, error_code TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runtime_runs(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_runtime_deliveries_run ON runtime_deliveries(run_id, created_at, id);
`;

export const RUNTIME_EXECUTION_GRAPH_INDEX_DDL = `
  CREATE INDEX IF NOT EXISTS idx_runtime_deliveries_batch ON runtime_deliveries(run_id, batch_id, status);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_runtime_deliveries_batch_target
    ON runtime_deliveries(run_id, kind, batch_id, node_id);
`;
