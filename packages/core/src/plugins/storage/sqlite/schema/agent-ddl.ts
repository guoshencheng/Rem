export const AGENT_DDL = `
  CREATE TABLE IF NOT EXISTS agent_threads (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, agent_id TEXT NOT NULL,
    role TEXT NOT NULL, lifecycle TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_agent_threads_session ON agent_threads(session_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_threads_primary
    ON agent_threads(session_id) WHERE role = 'primary';
  CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_threads_organizer
    ON agent_threads(session_id) WHERE role = 'organizer';
  CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_threads_persistent_agent
    ON agent_threads(session_id, agent_id) WHERE lifecycle = 'persistent';
`;
