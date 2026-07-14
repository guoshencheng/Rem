import Database from 'better-sqlite3';

export const CURRENT_SCHEMA_VERSION = 7;

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
        session_id TEXT PRIMARY KEY,
        todos_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

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

    if (version < 5) {
      // SQLite does not support ALTER TABLE ... ADD PRIMARY KEY.
      // Rebuild the todos table with id as PRIMARY KEY.
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS todos_new (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          position INTEGER NOT NULL,
          content TEXT NOT NULL,
          status TEXT NOT NULL,
          priority TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_todos_new_session_position
          ON todos_new(session_id, position);

        CREATE INDEX IF NOT EXISTS idx_todos_new_session
          ON todos_new(session_id);

        INSERT OR IGNORE INTO todos_new (id, session_id, position, content, status, priority, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), session_id, position, content, status, priority, created_at, updated_at
        FROM todos;

        DROP TABLE todos;
        ALTER TABLE todos_new RENAME TO todos;
      `);
    }

    if (version < 6) {
      // Rebuild todos as one JSON row per session.
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS todos_new (
          session_id TEXT PRIMARY KEY,
          todos_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        INSERT OR IGNORE INTO todos_new (session_id, todos_json, created_at, updated_at)
        SELECT session_id,
               json_group_array(json_object('content', content, 'status', status, 'priority', priority)),
               MIN(created_at),
               MAX(updated_at)
        FROM todos
        GROUP BY session_id;

        DROP TABLE todos;
        ALTER TABLE todos_new RENAME TO todos;
      `);
    }

    if (version < 7) {
      // Drop the FK to sessions: todos is a standalone JSON-per-session row.
      // The FK made todowrite fail (SQLITE_CONSTRAINT_FOREIGNKEY) whenever it
      // ran before the session row was persisted. Cleanup on session delete is
      // now handled explicitly in SqliteSessionStore.delete().
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS todos_new (
          session_id TEXT PRIMARY KEY,
          todos_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        INSERT OR IGNORE INTO todos_new (session_id, todos_json, created_at, updated_at)
        SELECT session_id, todos_json, created_at, updated_at FROM todos;

        DROP TABLE todos;
        ALTER TABLE todos_new RENAME TO todos;
      `);
    }
  }
}
