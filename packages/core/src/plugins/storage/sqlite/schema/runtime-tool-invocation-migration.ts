import type Database from 'better-sqlite3';

type TableColumn = { name: string };
type TableIndex = { name: string; unique: number };
type IndexColumn = { name: string };

/**
 * Adds node scoping to databases created before execution nodes were introduced.
 * The table is rebuilt so the old `(run_id, tool_call_id)` uniqueness constraint
 * cannot prevent two team nodes from using the same model tool call id.
 */
export function migrateRuntimeToolInvocationNode(db: Database.Database): void {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runtime_tool_invocations'")
    .get() as { name: string } | undefined;
  if (!table) return;

  const columns = db.prepare('PRAGMA table_info(runtime_tool_invocations)').all() as TableColumn[];
  const hasNodeId = columns.some(({ name }) => name === 'node_id');
  if (hasNodeId && !hasLegacyCallUnique(db)) return;
  const nodeExpression = hasNodeId ? 'node_id' : "'root'";

  const foreignKeys = db.pragma('foreign_keys') as number;
  if (foreignKeys) db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE runtime_tool_invocations_node_new (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          run_id TEXT NOT NULL,
          node_id TEXT NOT NULL DEFAULT 'root',
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
          UNIQUE (run_id, node_id, tool_call_id),
          FOREIGN KEY (tenant_id, session_id, run_id)
            REFERENCES runtime_runs(tenant_id, session_id, id) ON DELETE CASCADE
        );
        INSERT INTO runtime_tool_invocations_node_new (
          id, tenant_id, session_id, run_id, node_id, tool_call_id, tool_name,
          status, side_effect, supports_idempotency_key, input_json, result_json,
          error, created_at, updated_at
        )
        SELECT id, tenant_id, session_id, run_id, ${nodeExpression}, tool_call_id, tool_name,
          status, side_effect, supports_idempotency_key, input_json, result_json,
          error, created_at, updated_at
        FROM runtime_tool_invocations;
        DROP TABLE runtime_tool_invocations;
        ALTER TABLE runtime_tool_invocations_node_new RENAME TO runtime_tool_invocations;
        CREATE INDEX IF NOT EXISTS idx_runtime_tool_invocations_run
          ON runtime_tool_invocations(run_id);
      `);
    })();
  } finally {
    if (foreignKeys) db.pragma('foreign_keys = ON');
  }

  const violations = db.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) throw new Error('Foreign key check failed after runtime tool invocation migration');
}

function hasLegacyCallUnique(db: Database.Database): boolean {
  const indexes = db.prepare('PRAGMA index_list(runtime_tool_invocations)').all() as TableIndex[];
  return indexes.some((index) => {
    if (index.unique !== 1) return false;
    const columns = db.prepare(`PRAGMA index_info(${quoteIdentifier(index.name)})`).all() as IndexColumn[];
    return columns.map(({ name }) => name).join(',') === 'run_id,tool_call_id';
  });
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
