import type Database from 'better-sqlite3';

/** Adds durable Delivery graph fields without touching unrelated tables. */
export function migrateRuntimeExecutionGraph(db: Database.Database): void {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_deliveries'").get();
  if (!table) return;
  const columns = new Set((db.prepare('PRAGMA table_info(runtime_deliveries)').all() as Array<{ name: string }>).map((row) => row.name));
  const additions: Array<[string, string]> = [
    ['requested_by_node_id', 'TEXT'],
    ['source_entry_id', 'TEXT'],
    ['result_entry_id', 'TEXT'],
    ['attempt', 'INTEGER NOT NULL DEFAULT 0'],
    ['error_code', 'TEXT'],
  ];
  db.transaction(() => {
    for (const [name, definition] of additions) {
      if (!columns.has(name)) db.exec(`ALTER TABLE runtime_deliveries ADD COLUMN ${name} ${definition}`);
    }
  })();
}
