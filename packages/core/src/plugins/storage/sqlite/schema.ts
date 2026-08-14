import Database from 'better-sqlite3';
import { RUNTIME_DDL } from './runtime-ddl.js';
import { RUNTIME_EXECUTION_DDL, RUNTIME_EXECUTION_GRAPH_INDEX_DDL } from './runtime-execution-ddl.js';
import { migrateRuntimeToolInvocationNode } from './schema/runtime-tool-invocation-migration.js';
import { migrateRuntimeExecutionBudgets } from './schema/runtime-execution-budget-migration.js';
import { migrateRuntimeExecutionGraph } from './schema/runtime-execution-graph-migration.js';

export const CURRENT_SCHEMA_VERSION = 14;

export class SqliteSchemaManager {
  constructor(private db: Database.Database) {}

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      );
    `);
    const existing = this.db.prepare('SELECT version FROM schema_version').get() as
      | { version: number }
      | undefined;
    if (existing && existing.version > CURRENT_SCHEMA_VERSION) {
      throw new Error(`Unsupported schema version: ${existing.version}`);
    }
    this.db.exec(RUNTIME_DDL);
    migrateRuntimeToolInvocationNode(this.db);
    this.db.exec(RUNTIME_EXECUTION_DDL);
    migrateRuntimeExecutionGraph(this.db);
    this.db.exec(RUNTIME_EXECUTION_GRAPH_INDEX_DDL);
    migrateRuntimeExecutionBudgets(this.db);

    const row = this.db.prepare('SELECT version FROM schema_version').get() as
      | { version: number }
      | undefined;

    if (!row) {
      this.db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(CURRENT_SCHEMA_VERSION);
      return;
    }

    if (row.version === CURRENT_SCHEMA_VERSION) return;
    this.db.prepare('UPDATE schema_version SET version = ?').run(CURRENT_SCHEMA_VERSION);
  }
}
