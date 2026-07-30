import Database from 'better-sqlite3';
import { generateId } from '../../../shared/generate-id.js';
import type { Session, SessionSummary } from '../../../session/model.js';
import type { SessionStore } from '../../../sdk/storage-provider.js';
import type { SessionTreeEntry } from '../../../session/tree/types.js';
import { buildConversationFromEntries } from '../../../session/tree/context-builder.js';
import { wrapSqliteError } from './errors.js';
import { toSession, toSessionSummary } from './session-converter.js';
import { toSessionTreeEntry, type SessionEntryRow } from './session-entry-rows.js';
import { reconcileSessionEntries } from './session-reconcile.js';

export class SqliteSessionStore implements SessionStore {
  constructor(private db: Database.Database) {}

  async create(workspace: string): Promise<Session> {
    try {
      const now = new Date();
      const sessionId = generateId();
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
        metadata: { workspace, schemaVersion: 2 },
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

      const entries = await this.listEntries(sessionId);
      const leafId = await this.getActiveLeafId(sessionId);
      const messages = buildConversationFromEntries(entries, leafId);

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
          `INSERT INTO sessions (id, workspace, title, pinned, current_turn, metadata_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             workspace = excluded.workspace,
             title = excluded.title,
             pinned = excluded.pinned,
             current_turn = excluded.current_turn,
             metadata_json = excluded.metadata_json,
             updated_at = excluded.updated_at`
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
    });

    try {
      transaction();
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', `Failed to save session ${session.sessionId}`);
    }

    await reconcileSessionEntries(this, session);
  }

  updateEntry(entry: SessionTreeEntry): void {
    this.db
      .prepare('UPDATE session_entries SET payload = ? WHERE id = ?')
      .run(JSON.stringify(entry.payload), entry.id);
  }

  async delete(sessionId: string): Promise<void> {
    try {
      // todos has no FK to sessions (see schema v7), so clean it up explicitly.
      this.db.prepare('DELETE FROM todos WHERE session_id = ?').run(sessionId);
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', `Failed to delete session ${sessionId}`);
    }
  }

  async appendEntry(entry: SessionTreeEntry): Promise<void> {
    try {
      const tx = this.db.transaction(() => {
        this.db
          .prepare(
            'INSERT INTO session_entries (id, session_id, parent_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)'
          )
          .run(entry.id, entry.sessionId, entry.parentId, entry.type, JSON.stringify(entry.payload), entry.timestamp);
        this.db.prepare('UPDATE sessions SET active_leaf_id = ? WHERE id = ?').run(entry.id, entry.sessionId);
      });
      tx();
    } catch (err) {
      throw wrapSqliteError(err, 'DB_QUERY', `Failed to append entry ${entry.id}`);
    }
  }

  async getActiveLeafId(sessionId: string): Promise<string | null> {
    const row = this.db.prepare('SELECT active_leaf_id FROM sessions WHERE id = ?').get(sessionId) as
      | { active_leaf_id: string | null }
      | undefined;
    return row?.active_leaf_id ?? null;
  }

  async listEntries(sessionId: string): Promise<SessionTreeEntry[]> {
    const rows = this.db
      .prepare('SELECT id, session_id, parent_id, type, payload, created_at FROM session_entries WHERE session_id = ? ORDER BY rowid')
      .all(sessionId) as SessionEntryRow[];
    return rows.map(toSessionTreeEntry);
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
            (SELECT COUNT(*) FROM session_entries WHERE session_id = sessions.id AND type = 'message') AS message_count
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
