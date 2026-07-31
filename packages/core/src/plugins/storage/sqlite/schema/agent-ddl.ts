export const AGENT_DDL = `
  CREATE TABLE IF NOT EXISTS agent_profiles (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, system_prompt TEXT,
    model_json TEXT, tool_policy_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agent_threads (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, agent_profile_id TEXT NOT NULL,
    role TEXT NOT NULL, lifecycle TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_profile_id) REFERENCES agent_profiles(id) ON DELETE RESTRICT
  );
  CREATE INDEX IF NOT EXISTS idx_agent_threads_session ON agent_threads(session_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_threads_primary
    ON agent_threads(session_id) WHERE role = 'primary';
  CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_threads_organizer
    ON agent_threads(session_id) WHERE role = 'organizer';
  CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_threads_persistent_profile
    ON agent_threads(session_id, agent_profile_id) WHERE lifecycle = 'persistent';
`;
