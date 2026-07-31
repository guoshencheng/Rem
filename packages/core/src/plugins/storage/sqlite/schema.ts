import Database from 'better-sqlite3';
import { SESSION_DDL } from './schema/session-ddl.js';
import { TODO_DDL } from './schema/todo-ddl.js';
import { ARCHIVE_DDL } from './schema/archive-ddl.js';
import { WORKSPACE_DDL } from './schema/workspace-ddl.js';
import { runMigrations } from './schema/migrations.js';
import { AGENT_DDL } from './schema/agent-ddl.js';

export const CURRENT_SCHEMA_VERSION = 10;

export class SqliteSchemaManager {
  constructor(private db: Database.Database) {}

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      );
    `);
    this.db.exec(SESSION_DDL);
    this.db.exec(TODO_DDL);
    this.db.exec(ARCHIVE_DDL);
    this.db.exec(WORKSPACE_DDL);
    this.db.exec(AGENT_DDL);

    const row = this.db.prepare('SELECT version FROM schema_version').get() as
      | { version: number }
      | undefined;

    if (!row) {
      this.db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(CURRENT_SCHEMA_VERSION);
      return;
    }

    if (row.version === CURRENT_SCHEMA_VERSION) return;
    if (row.version > CURRENT_SCHEMA_VERSION) {
      throw new Error(`Unsupported schema version: ${row.version}`);
    }

    runMigrations(this.db, row.version);
    this.db.prepare('UPDATE schema_version SET version = ?').run(CURRENT_SCHEMA_VERSION);
  }
}
