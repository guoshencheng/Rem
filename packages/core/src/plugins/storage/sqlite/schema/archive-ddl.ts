/** archived_messages 表的当前 schema DDL */
export const ARCHIVE_DDL = `
  CREATE TABLE IF NOT EXISTS archived_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    compressed_at TEXT NOT NULL,
    version INTEGER NOT NULL,
    parent_archive_id TEXT,
    conversation_snapshot TEXT NOT NULL,
    summary TEXT NOT NULL,
    token_usage_before TEXT,
    token_usage_after TEXT,
    metadata TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_archived_messages_session
    ON archived_messages(session_id);

  CREATE INDEX IF NOT EXISTS idx_archived_messages_version
    ON archived_messages(session_id, version);
`;
