import type Database from 'better-sqlite3';
import type { AgentSession, RuntimeSessionEntry } from '../../../domain/session/types.js';
import type { RuntimeSessionRepository } from '../../../sdk/runtime-storage.js';
import type { RuntimeSessionEntryRow, RuntimeSessionRow } from './runtime-row-types.js';
import { mapSessionEntryRow, mapSessionRow } from './runtime-row-mappers.js';
import { sessionEntryToRow, sessionToRow } from './runtime-row-serializers.js';
import { sqliteAction } from './runtime-sqlite-error.js';

export class SqliteRuntimeSessionRepository implements RuntimeSessionRepository {
  constructor(private readonly db: Database.Database) {}

  insert(session: AgentSession): void {
    const row = sessionToRow(session);
    sqliteAction('inserting runtime session', () => this.db.prepare(`
      INSERT INTO runtime_sessions (id, tenant_id, contexts_json, created_at, updated_at)
      VALUES (@id, @tenant_id, @contexts_json, @created_at, @updated_at)
    `).run(row));
  }

  get(sessionId: string): AgentSession | null {
    return sqliteAction('reading runtime session', () => {
      const row = this.db.prepare('SELECT * FROM runtime_sessions WHERE id = ?').get(sessionId) as RuntimeSessionRow | undefined;
      return row ? mapSessionRow(row) : null;
    });
  }

  appendEntries(entries: RuntimeSessionEntry[]): void {
    sqliteAction('appending runtime session entries', () => {
      const insert = this.db.prepare(`
        INSERT INTO runtime_session_entries
          (id, tenant_id, session_id, run_id, sequence, message_json, metadata_json, created_at)
        VALUES (@id, @tenant_id, @session_id, @run_id, @sequence, @message_json, @metadata_json, @created_at)
      `);
      for (const entry of entries) insert.run(sessionEntryToRow(entry));
    });
  }

  nextEntrySequence(sessionId: string): number {
    return sqliteAction('reading runtime session entry sequence', () => {
      const row = this.db.prepare(`
        SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
        FROM runtime_session_entries WHERE session_id = ?
      `).get(sessionId) as { sequence: number };
      return row.sequence;
    });
  }

  listEntries(sessionId: string): RuntimeSessionEntry[] {
    return sqliteAction('listing runtime session entries', () => {
      const rows = this.db.prepare(`
        SELECT * FROM runtime_session_entries WHERE session_id = ? ORDER BY sequence ASC
      `).all(sessionId) as RuntimeSessionEntryRow[];
      return rows.map(mapSessionEntryRow);
    });
  }
}
