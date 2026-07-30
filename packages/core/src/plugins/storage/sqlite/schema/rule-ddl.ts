/** rules 表的当前 schema DDL */
export const RULE_DDL = `
  CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    permission TEXT NOT NULL,
    pattern TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_rules_source
    ON rules(source);
`;
