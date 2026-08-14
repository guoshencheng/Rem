import type Database from 'better-sqlite3';
import type { AgentRun } from '../../../domain/run/types.js';
import type { RuntimeRunRepository } from '../../../sdk/runtime-storage.js';
import type { RunListOptions } from '../../../domain/run/execution-models.js';
import type { RuntimeRunRow } from './runtime-row-types.js';
import { mapRunRow } from './runtime-row-mappers.js';
import { runToRow } from './runtime-row-serializers.js';
import { runtimeConflict, sqliteAction } from './runtime-sqlite-error.js';
import { decodeRunCursor } from '../../../domain/run/run-cursor.js';

export class SqliteRuntimeRunRepository implements RuntimeRunRepository {
  constructor(private readonly db: Database.Database) {}

  insert(run: AgentRun): void {
    const row = runToRow(run);
    sqliteAction('inserting runtime run', () => this.db.prepare(`
      INSERT INTO runtime_runs
        (id, tenant_id, principal_id, session_id, agent_id, agent_revision, status,
         trigger_json, context_snapshot_json, waiting_reason, error_code,
         cancellation_requested_at, created_at, started_at, finished_at, updated_at)
      VALUES (@id, @tenant_id, @principal_id, @session_id, @agent_id, @agent_revision, @status,
        @trigger_json, @context_snapshot_json, @waiting_reason, @error_code,
        @cancellation_requested_at, @created_at, @started_at, @finished_at, @updated_at)
    `).run(row));
  }

  get(runId: string): AgentRun | null {
    return sqliteAction('reading runtime run', () => {
      const row = this.db.prepare('SELECT * FROM runtime_runs WHERE id = ?').get(runId) as RuntimeRunRow | undefined;
      return row ? mapRunRow(row) : null;
    });
  }

  update(run: AgentRun): void {
    const row = runToRow(run);
    sqliteAction('updating runtime run', () => {
      const result = this.db.prepare(`
        UPDATE runtime_runs SET tenant_id=@tenant_id, principal_id=@principal_id,
          session_id=@session_id, agent_id=@agent_id, agent_revision=@agent_revision,
          status=@status, trigger_json=@trigger_json, context_snapshot_json=@context_snapshot_json,
          waiting_reason=@waiting_reason, error_code=@error_code,
          cancellation_requested_at=@cancellation_requested_at, created_at=@created_at,
          started_at=@started_at, finished_at=@finished_at, updated_at=@updated_at
        WHERE id=@id
      `).run(row);
      if (result.changes !== 1) runtimeConflict('Runtime run does not exist');
    });
  }

  listByTenant(tenantId: string, options: RunListOptions = {}): AgentRun[] {
    return sqliteAction('listing runtime runs', () => {
      const conditions = ['tenant_id = @tenant_id'];
      const values: Record<string, unknown> = { tenant_id: tenantId };
      if (options.sessionId) { conditions.push('session_id = @session_id'); values.session_id = options.sessionId; }
      if (options.status) { conditions.push('status = @status'); values.status = options.status; }
      if (options.cursor) {
        const cursor = decodeRunCursor(options.cursor);
        conditions.push('(created_at < @cursor_created OR (created_at = @cursor_created AND id < @cursor_id))');
        values.cursor_created = cursor.createdAt; values.cursor_id = cursor.runId;
      }
      const limit = Math.min(options.limit ?? 100, 1000);
      const rows = this.db.prepare(`SELECT * FROM runtime_runs WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT @limit`).all({ ...values, limit }) as RuntimeRunRow[];
      return rows.map(mapRunRow);
    });
  }
}
