import type Database from 'better-sqlite3';
import type { IdempotencyRecord, RuntimeIdempotencyRepository } from '../../../sdk/runtime-storage.js';
import type { RuntimeIdempotencyRow } from './runtime-row-types.js';
import { mapIdempotencyRow } from './runtime-row-mappers.js';
import { idempotencyToRow } from './runtime-row-serializers.js';
import { sqliteAction } from './runtime-sqlite-error.js';

export class SqliteRuntimeIdempotencyRepository implements RuntimeIdempotencyRepository {
  constructor(private readonly db: Database.Database) {}

  get(tenantId: string, operation: 'start-run', key: string): IdempotencyRecord | null {
    return sqliteAction('reading runtime idempotency record', () => {
      const row = this.db.prepare(`
        SELECT * FROM runtime_idempotency WHERE tenant_id = ? AND operation = ? AND idempotency_key = ?
      `).get(tenantId, operation, key) as RuntimeIdempotencyRow | undefined;
      return row ? mapIdempotencyRow(row) : null;
    });
  }

  insert(record: IdempotencyRecord): void {
    const row = idempotencyToRow(record);
    sqliteAction('inserting runtime idempotency record', () => this.db.prepare(`
      INSERT INTO runtime_idempotency
        (tenant_id, operation, idempotency_key, request_hash, resource_id, created_at)
      VALUES (@tenant_id, @operation, @idempotency_key, @request_hash, @resource_id, @created_at)
    `).run(row));
  }
}
