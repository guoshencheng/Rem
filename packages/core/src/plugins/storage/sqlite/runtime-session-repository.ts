import type Database from 'better-sqlite3';
import type { AgentSession, RuntimeSessionEntry, RuntimeSessionSummary } from '../../../domain/session/types.js';
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

  listByTenant(tenantId: string): RuntimeSessionSummary[] {
    return sqliteAction('listing runtime sessions', () => {
      const rows = this.db.prepare(`
        SELECT s.*,
          COALESCE(SUM(CASE WHEN json_extract(e.message_json, '$.role') IN ('user', 'assistant') THEN 1 ELSE 0 END), 0)
            AS message_count
        FROM runtime_sessions s
        LEFT JOIN runtime_session_entries e ON e.session_id = s.id
        WHERE s.tenant_id = ?
        GROUP BY s.id
        ORDER BY s.updated_at DESC, s.id ASC
      `).all(tenantId) as Array<RuntimeSessionRow & { message_count: number }>;
      return rows.map((row) => ({ ...mapSessionRow(row), messageCount: row.message_count }));
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

  update(session: AgentSession): void {
    const row = sessionToRow(session);
    sqliteAction('updating runtime session', () => {
      const result = this.db.prepare('UPDATE runtime_sessions SET tenant_id=@tenant_id,contexts_json=@contexts_json,created_at=@created_at,updated_at=@updated_at WHERE id=@id').run(row);
      if (result.changes !== 1) throw new Error('Runtime session does not exist');
    });
  }
}
