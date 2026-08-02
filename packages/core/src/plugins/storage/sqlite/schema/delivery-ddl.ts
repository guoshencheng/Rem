export const DELIVERY_DDL = `
  CREATE TABLE IF NOT EXISTS message_deliveries (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    root_user_message_id TEXT NOT NULL,
    target_agent_thread_id TEXT NOT NULL,
    requested_by_agent_thread_id TEXT,
    status TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 0,
    depth INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (target_agent_thread_id) REFERENCES agent_threads(id) ON DELETE CASCADE,
    FOREIGN KEY (requested_by_agent_thread_id) REFERENCES agent_threads(id) ON DELETE RESTRICT,
    UNIQUE (kind, batch_id, target_agent_thread_id)
  );
  CREATE INDEX IF NOT EXISTS idx_message_deliveries_root
    ON message_deliveries(session_id, root_user_message_id, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_message_deliveries_target
    ON message_deliveries(target_agent_thread_id, status, created_at);
`;
