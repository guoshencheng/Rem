import Database from 'better-sqlite3';

export const CURRENT_SCHEMA_VERSION = 9;

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
        active_leaf_id TEXT,
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
        tool_call_id TEXT,
        tool_name TEXT,
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

      CREATE TABLE IF NOT EXISTS session_entries (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        parent_id TEXT,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_entries_session
        ON session_entries(session_id);
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
      // If the existing todos table lacks the position column (e.g. it was created
      // prematurely by the current-schema CREATE TABLE IF NOT EXISTS), drop it so
      // we can rebuild from the correct shape.
      const columns = this.db.prepare('PRAGMA table_info(todos)').all() as { name: string }[];
      const hasPosition = columns.some((c) => c.name === 'position');
      if (!hasPosition) {
        this.db.exec('DROP TABLE IF EXISTS todos;');
        this.db.exec(`
          CREATE TABLE todos (
            session_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            content TEXT NOT NULL,
            status TEXT NOT NULL,
            priority TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (session_id, position)
          );
        `);
      }
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

    if (version < 8) {
      // Preserve tool call id/name for tool result messages so UI can merge
      // tool results back into the assistant message that requested them.
      this.db.exec(`
        ALTER TABLE messages ADD COLUMN tool_call_id TEXT;
        ALTER TABLE messages ADD COLUMN tool_name TEXT;
      `);
    }

    if (version < 9) {
      const cols = this.db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[];
      if (!cols.some((c) => c.name === 'active_leaf_id')) {
        this.db.exec('ALTER TABLE sessions ADD COLUMN active_leaf_id TEXT');
      }
      const sessions = this.db.prepare('SELECT id FROM sessions').all() as { id: string }[];
      for (const { id } of sessions) {
        const migrateSession = this.db.transaction(() => {
          const messages = this.db
            .prepare('SELECT role, content_json, tool_call_id, tool_name FROM messages WHERE session_id = ? ORDER BY sequence')
            .all(id) as { role: string; content_json: string; tool_call_id: string | null; tool_name: string | null }[];
          let parentId: string | null = null;
          let leafId: string | null = null;
          const insertEntry = this.db.prepare(
            'INSERT INTO session_entries (id, session_id, parent_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)'
          );
          for (const row of messages) {
            const entryId = crypto.randomUUID();
            const message = row.role === 'toolResult'
              ? { role: 'toolResult', toolCallId: row.tool_call_id ?? '', toolName: row.tool_name ?? '', content: JSON.parse(row.content_json), isError: false, timestamp: Date.now() }
              : { role: row.role, content: JSON.parse(row.content_json), timestamp: Date.now() };
            insertEntry.run(entryId, id, parentId, 'message', JSON.stringify({ message, messageId: entryId }), Date.now());
            parentId = entryId;
            leafId = entryId;
          }
          if (leafId) {
            this.db.prepare('UPDATE sessions SET active_leaf_id = ? WHERE id = ?').run(leafId, id);
          }
        });
        migrateSession();
      }
    }
  }
}
