/** workspaces 表的当前 schema DDL */
export const WORKSPACE_DDL = `
  CREATE TABLE IF NOT EXISTS workspaces (
    path TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  );
`;
