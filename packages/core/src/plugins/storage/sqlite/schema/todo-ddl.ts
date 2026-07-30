/** todos 表的当前 schema DDL（每 session 一行 JSON） */
export const TODO_DDL = `
  CREATE TABLE IF NOT EXISTS todos (
    session_id TEXT PRIMARY KEY,
    todos_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;
