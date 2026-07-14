import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Session, SessionSummary } from '../../../session.js';
import type { SessionStore } from '../../../sdk/storage-provider.js';
import { wrapSqliteError } from './errors.js';
import { toSession, toSessionSummary } from './session-converter.js';

export class SqliteSessionStore implements SessionStore {
  constructor(private db: Database.Database) {}

  async create(workspace: string): Promise<Session> {
    try {
      const now = new Date();
      const sessionId = randomUUID();
      this.db
        .prepare(
          `INSERT INTO sessions (id, workspace, title, pinned, current_turn, metadata_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(sessionId, workspace, null, 0, 0, '{}', now.toISOString(), now.toISOString());

      return {
        sessionId,
        conversation: [],
        currentTurn: 0,
        metadata: { workspace },
        createdAt: now,
        updatedAt: now,
      };
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', 'Failed to create session');
    }
  }

  async load(sessionId: string): Promise<Session | null> {
    try {
      const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as
        | import('./session-converter.js').SessionRow
        | undefined;
      if (!row) return null;

      const messages = this.db
        .prepare(
          'SELECT id, role, content_json, created_at FROM messages WHERE session_id = ? ORDER BY sequence'
        )
        .all(sessionId) as import('./session-converter.js').MessageRow[];

      return toSession(row, messages);
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', `Failed to load session ${sessionId}`);
    }
  }

  async save(session: Session): Promise<void> {
    const title = typeof session.metadata.title === 'string' ? session.metadata.title : null;
    const pinned = session.metadata.pinned === true ? 1 : 0;
    const workspace =
      typeof session.metadata.workspace === 'string' ? session.metadata.workspace : 'default';

    const metadata = { ...session.metadata };
    delete metadata.title;
    delete metadata.pinned;
    delete metadata.workspace;

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO sessions (id, workspace, title, pinned, current_turn, metadata_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          session.sessionId,
          workspace,
          title,
          pinned,
          session.currentTurn,
          JSON.stringify(metadata),
          session.createdAt.toISOString(),
          new Date().toISOString()
        );

      const messageIds = session.conversation.map((m) => m.id);
      if (messageIds.length > 0) {
        const placeholders = messageIds.map(() => '?').join(',');
        this.db
          .prepare(`DELETE FROM messages WHERE session_id = ? AND id NOT IN (${placeholders})`)
          .run(session.sessionId, ...messageIds);
      } else {
        this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(session.sessionId);
      }

      const insert = this.db.prepare(
        `INSERT OR REPLACE INTO messages (id, session_id, role, content_json, sequence, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (let i = 0; i < session.conversation.length; i++) {
        const msg = session.conversation[i];
        insert.run(
          msg.id,
          session.sessionId,
          msg.role,
          JSON.stringify(msg.content),
          i,
          new Date().toISOString()
        );
      }
    });

    try {
      transaction();
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', `Failed to save session ${session.sessionId}`);
    }
  }

  async delete(sessionId: string): Promise<void> {
    try {
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', `Failed to delete session ${sessionId}`);
    }
  }

  async listByWorkspace(workspace: string): Promise<SessionSummary[]> {
    return this.listWithWhere('workspace = ?', [workspace]);
  }

  async listAll(): Promise<SessionSummary[]> {
    return this.listWithWhere('1 = 1', []);
  }

  private listWithWhere(
    whereClause: string,
    params: (string | number)[]
  ): SessionSummary[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT id, title, pinned, updated_at,
            (SELECT COUNT(*) FROM messages WHERE session_id = sessions.id) AS message_count
           FROM sessions
           WHERE ${whereClause}
           ORDER BY updated_at DESC`
        )
        .all(...params) as Array<{
        id: string;
        title: string | null;
        pinned: number;
        updated_at: string;
        message_count: number;
      } >;

      return rows.map(toSessionSummary);
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', 'Failed to list sessions');
    }
  }
}
