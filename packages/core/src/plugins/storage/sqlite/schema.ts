import Database from 'better-sqlite3';

export const CURRENT_SCHEMA_VERSION = 4;

export class SqliteSchemaManager {
  constructor(private db: Database.Database) {}

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        workspace TEXT NOT NULL,
        title TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        current_turn INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_workspace_updated
        ON sessions(workspace, updated_at DESC);

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content_json TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session_sequence
        ON messages(session_id, sequence);

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

      CREATE TABLE IF NOT EXISTS todos (
        session_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, position),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_todos_session
        ON todos(session_id);

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

      CREATE TABLE IF NOT EXISTS workspaces (
        path TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      );
    `);

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

    this.migrateFrom(row.version);
    this.db.prepare('UPDATE schema_version SET version = ?').run(CURRENT_SCHEMA_VERSION);
  }

  private migrateFrom(version: number): void {
    if (version < 2) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS todos (
          session_id TEXT NOT NULL,
          position INTEGER NOT NULL,
          content TEXT NOT NULL,
          status TEXT NOT NULL,
          priority TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (session_id, position),
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_todos_session
          ON todos(session_id);
      `);
    }

    if (version < 3) {
      this.db.exec(`
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
      `);
    }

    if (version < 4) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS workspaces (
          path TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL
        );
      `);
    }
  }
}
