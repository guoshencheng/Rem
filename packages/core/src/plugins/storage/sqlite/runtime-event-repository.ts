import type Database from 'better-sqlite3';
import type { RunEvent } from '../../../domain/event/types.js';
import type { RuntimeEventRepository } from '../../../sdk/runtime-storage.js';
import type { RuntimeEventRow } from './runtime-row-types.js';
import { mapEventRow } from './runtime-row-mappers.js';
import { eventToRow } from './runtime-row-serializers.js';
import { invalidRuntimeInput, sqliteAction } from './runtime-sqlite-error.js';

function validateList(afterSequence: number, limit: number): void {
  if (!Number.isInteger(afterSequence) || afterSequence < 0) invalidRuntimeInput('Event cursor must be a non-negative integer');
  if (!Number.isInteger(limit) || limit <= 0) invalidRuntimeInput('Event limit must be a positive integer');
}

export class SqliteRuntimeEventRepository implements RuntimeEventRepository {
  constructor(private readonly db: Database.Database) {}

  append(event: RunEvent): void {
    const row = eventToRow(event);
    sqliteAction('appending runtime event', () => this.db.prepare(`
      INSERT INTO runtime_events
        (id, sequence, schema_version, tenant_id, session_id, run_id, type, data_json, occurred_at)
      VALUES (@id, @sequence, @schema_version, @tenant_id, @session_id, @run_id, @type, @data_json, @occurred_at)
    `).run(row));
  }

  nextSequence(runId: string): number {
    return sqliteAction('reading runtime event sequence', () => {
      const row = this.db.prepare('SELECT MAX(sequence) AS maximum FROM runtime_events WHERE run_id = ?').get(runId) as { maximum: number | null };
      return (row.maximum ?? 0) + 1;
    });
  }

  list(runId: string, afterSequence: number, limit: number): RunEvent[] {
    validateList(afterSequence, limit);
    return sqliteAction('listing runtime events', () => {
      const rows = this.db.prepare(`
        SELECT * FROM runtime_events WHERE run_id = ? AND sequence > ?
        ORDER BY sequence ASC LIMIT ?
      `).all(runId, afterSequence, limit) as RuntimeEventRow[];
      return rows.map(mapEventRow);
    });
  }
}
