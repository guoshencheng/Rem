import type Database from 'better-sqlite3';
import type { WorkItem } from '../../../domain/run/types.js';
import type { RuntimeWorkItemRepository } from '../../../sdk/runtime-storage.js';
import type { RuntimeWorkItemRow } from './runtime-row-types.js';
import { mapWorkItemRow } from './runtime-row-mappers.js';
import { workItemToRow } from './runtime-row-serializers.js';
import { runtimeConflict, sqliteAction } from './runtime-sqlite-error.js';

const compareWork = (left: WorkItem, right: WorkItem): number => {
  const byTime = left.createdAt.getTime() - right.createdAt.getTime();
  if (byTime) return byTime;
  return left.workItemId === right.workItemId ? 0 : left.workItemId < right.workItemId ? -1 : 1;
};

export class SqliteRuntimeWorkItemRepository implements RuntimeWorkItemRepository {
  constructor(private readonly db: Database.Database) {}

  insert(item: WorkItem): void {
    const row = workItemToRow(item);
    sqliteAction('inserting runtime work item', () => this.db.prepare(`
      INSERT INTO runtime_work_items
        (id, run_id, status, lease_owner, lease_expires_at, attempt, created_at, updated_at)
      VALUES (@id, @run_id, @status, @lease_owner, @lease_expires_at, @attempt, @created_at, @updated_at)
    `).run(row));
  }

  getByRun(runId: string): WorkItem | null {
    return sqliteAction('reading runtime work item', () => {
      const row = this.db.prepare('SELECT * FROM runtime_work_items WHERE run_id = ?').get(runId) as RuntimeWorkItemRow | undefined;
      return row ? mapWorkItemRow(row) : null;
    });
  }

  update(item: WorkItem): void {
    const row = workItemToRow(item);
    sqliteAction('updating runtime work item', () => {
      const result = this.db.prepare(`
        UPDATE runtime_work_items SET run_id=@run_id, status=@status, lease_owner=@lease_owner,
          lease_expires_at=@lease_expires_at, attempt=@attempt, created_at=@created_at,
          updated_at=@updated_at WHERE id=@id
      `).run(row);
      if (result.changes !== 1) runtimeConflict('Runtime work item does not exist');
    });
  }

  listRecoverable(now: Date): WorkItem[] {
    const rows = sqliteAction('listing recoverable runtime work items', () => this.db.prepare(`
      SELECT * FROM runtime_work_items
      WHERE status = 'queued' OR (status = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
    `).all(now.toISOString()) as RuntimeWorkItemRow[]);
    return rows.map(mapWorkItemRow).sort(compareWork);
  }

  listClaimCandidates(now: Date): WorkItem[] {
    return sqliteAction('listing runtime claim candidates', () => {
      const isoNow = now.toISOString();
      const queued = this.db.prepare("SELECT MIN(created_at) AS value FROM runtime_work_items WHERE status = 'queued'").get() as { value: string | null };
      const leased = this.db.prepare(`
        SELECT MIN(created_at) AS value FROM runtime_work_items
        WHERE status = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
      `).get(isoNow) as { value: string | null };
      const earliest = [queued.value, leased.value].filter((value): value is string => value !== null).sort()[0];
      if (earliest === undefined) return [];
      const rows = this.db.prepare(`
        SELECT * FROM runtime_work_items WHERE created_at = ? AND status = 'queued'
        UNION ALL
        SELECT * FROM runtime_work_items WHERE created_at = ? AND status = 'leased'
          AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
      `).all(earliest, earliest, isoNow) as RuntimeWorkItemRow[];
      // Only the equal-time bucket needs JS sorting to preserve raw UTF-16 id order.
      return rows.map(mapWorkItemRow).sort(compareWork);
    });
  }

  claim(candidate: WorkItem, owner: string, now: Date, expiresAt: Date): WorkItem | null {
    const oldExpiry = candidate.leaseExpiresAt?.toISOString() ?? null;
    return sqliteAction('claiming runtime work item', () => {
      const result = this.db.prepare(`
        UPDATE runtime_work_items SET status='leased', lease_owner=@owner,
          lease_expires_at=@expiresAt, attempt=attempt + 1, updated_at=@now
        WHERE id=@id AND status=@oldStatus
          AND ((lease_expires_at IS NULL AND @oldExpiry IS NULL) OR lease_expires_at=@oldExpiry)
          AND (status='queued' OR (status='leased' AND lease_expires_at IS NOT NULL AND lease_expires_at <= @now))
      `).run({ id: candidate.workItemId, owner, expiresAt: expiresAt.toISOString(), now: now.toISOString(), oldStatus: candidate.status, oldExpiry });
      if (result.changes !== 1) return null;
      const row = this.db.prepare('SELECT * FROM runtime_work_items WHERE id = ?').get(candidate.workItemId) as RuntimeWorkItemRow;
      return mapWorkItemRow(row);
    });
  }
}
