import type Database from 'better-sqlite3';
import type { Artifact } from '../../../domain/artifact/types.js';
import type { RunEvent } from '../../../domain/event/types.js';
import type { AgentRun, WorkItem } from '../../../domain/run/types.js';
import type { AgentSession } from '../../../domain/session/types.js';
import type { RuntimeStorage, RuntimeTransactionCallback, SynchronousRuntimeTransactionCallback } from '../../../sdk/runtime-storage.js';
import type { RuntimeArtifactRow, RuntimeRunRow, RuntimeSessionRow } from './runtime-row-types.js';
import { mapArtifactRow, mapRunRow, mapSessionRow } from './runtime-row-mappers.js';
import { invalidRuntimeInput, mapSqliteFailure, sqliteAction } from './runtime-sqlite-error.js';
import { createSqliteRuntimeUnitOfWork } from './runtime-unit-of-work.js';
import { SqliteRuntimeEventRepository } from './runtime-event-repository.js';
import { SqliteRuntimeWorkItemRepository } from './runtime-work-item-repository.js';

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  ((typeof value === 'object' && value !== null) || typeof value === 'function')
  && typeof (value as { then?: unknown }).then === 'function';

export class SqliteRuntimeStore implements RuntimeStorage {
  private tail = Promise.resolve();

  constructor(private readonly db: Database.Database) {
    this.db.pragma('busy_timeout = 5000');
  }

  async transaction<T extends RuntimeTransactionCallback>(
    operation: SynchronousRuntimeTransactionCallback<T>,
  ): Promise<ReturnType<T>> {
    return this.lock(() => {
      let callbackFailure: unknown;
      let callbackFailed = false;
      try {
        return this.db.transaction(() => {
          let result: ReturnType<T>;
          try { result = operation(createSqliteRuntimeUnitOfWork(this.db)) as ReturnType<T>; }
          catch (error) { callbackFailed = true; callbackFailure = error; throw error; }
          if (isThenable(result)) {
            void Promise.resolve(result).catch(() => {});
            invalidRuntimeInput('RuntimeStorage transaction callback must be synchronous');
          }
          return result;
        }).immediate() as ReturnType<T>;
      } catch (error) {
        if (callbackFailed && error === callbackFailure) throw error;
        return mapSqliteFailure(error, 'running runtime transaction');
      }
    });
  }

  async getSession(sessionId: string): Promise<AgentSession | null> {
    return this.lock(() => sqliteAction('reading runtime session', () => {
      const row = this.db.prepare('SELECT * FROM runtime_sessions WHERE id = ?').get(sessionId) as RuntimeSessionRow | undefined;
      return row ? mapSessionRow(row) : null;
    }));
  }

  async getRun(runId: string): Promise<AgentRun | null> {
    return this.lock(() => sqliteAction('reading runtime run', () => {
      const row = this.db.prepare('SELECT * FROM runtime_runs WHERE id = ?').get(runId) as RuntimeRunRow | undefined;
      return row ? mapRunRow(row) : null;
    }));
  }

  async listEvents(runId: string, afterSequence = 0, limit = 100): Promise<RunEvent[]> {
    return this.lock(() => new SqliteRuntimeEventRepository(this.db).list(runId, afterSequence, limit));
  }

  async listArtifacts(runId: string): Promise<Artifact[]> {
    return this.lock(() => sqliteAction('listing runtime artifacts', () => {
      const rows = this.db.prepare('SELECT * FROM runtime_artifacts WHERE run_id = ? ORDER BY created_at, id').all(runId) as RuntimeArtifactRow[];
      return rows.map(mapArtifactRow);
    }));
  }

  async claimWorkItem(owner: string, now: Date, leaseMs: number): Promise<WorkItem | null> {
    const leaseOwner = owner.trim();
    const expiresAt = new Date(now.getTime() + leaseMs);
    if (!leaseOwner) invalidRuntimeInput('Lease owner is required');
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0 || !Number.isFinite(now.getTime())
      || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
      invalidRuntimeInput('Lease duration must produce a valid expiry');
    }
    return this.lock(() => {
      try {
        return this.db.transaction(() => {
          const repository = new SqliteRuntimeWorkItemRepository(this.db);
          for (const candidate of repository.listRecoverable(now)) {
            const claimed = repository.claim(candidate, leaseOwner, now, expiresAt);
            if (claimed) return claimed;
          }
          return null;
        }).immediate();
      } catch (error) { return mapSqliteFailure(error, 'claiming runtime work item'); }
    });
  }

  async listRecoverableWorkItems(now: Date): Promise<WorkItem[]> {
    if (!Number.isFinite(now.getTime())) invalidRuntimeInput('Recovery time must be valid');
    return this.lock(() => new SqliteRuntimeWorkItemRepository(this.db).listRecoverable(now));
  }

  private async lock<T>(operation: () => T): Promise<T> {
    const previous = this.tail;
    let release: (() => void) | undefined;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return operation(); }
    finally { release!(); }
  }
}
