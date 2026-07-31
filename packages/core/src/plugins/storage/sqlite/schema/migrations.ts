import Database from 'better-sqlite3';
import { AGENT_DDL } from './agent-ddl.js';

/** 版本迁移：从旧 schema 版本逐级升级到 CURRENT_SCHEMA_VERSION（由 schema.ts 调用） */
export function runMigrations(db: Database.Database, version: number): void {
    if (version < 2) {
      db.exec(`
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
      db.exec(`
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
      const columns = db.prepare('PRAGMA table_info(todos)').all() as { name: string }[];
      const hasPosition = columns.some((c) => c.name === 'position');
      if (!hasPosition) {
        db.exec('DROP TABLE IF EXISTS todos;');
        db.exec(`
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
      db.exec(`
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
      db.exec(`
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
      db.exec(`
        ALTER TABLE messages ADD COLUMN tool_call_id TEXT;
        ALTER TABLE messages ADD COLUMN tool_name TEXT;
      `);
    }

    if (version < 9) {
      const cols = db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[];
      if (!cols.some((c) => c.name === 'active_leaf_id')) {
        db.exec('ALTER TABLE sessions ADD COLUMN active_leaf_id TEXT');
      }
      const sessions = db.prepare('SELECT id FROM sessions').all() as { id: string }[];
      for (const { id } of sessions) {
        const migrateSession = db.transaction(() => {
          const messages = db
            .prepare('SELECT role, content_json, tool_call_id, tool_name FROM messages WHERE session_id = ? ORDER BY sequence')
            .all(id) as { role: string; content_json: string; tool_call_id: string | null; tool_name: string | null }[];
          let parentId: string | null = null;
          let leafId: string | null = null;
          const insertEntry = db.prepare(
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
            db.prepare('UPDATE sessions SET active_leaf_id = ? WHERE id = ?').run(leafId, id);
          }
        });
        migrateSession();
      }
    }
    if (version < 10) db.exec(AGENT_DDL);
}
