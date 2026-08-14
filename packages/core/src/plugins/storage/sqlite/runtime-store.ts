import type Database from 'better-sqlite3';
import type { Artifact } from '../../../domain/artifact/types.js';
import type { RunEvent } from '../../../domain/event/types.js';
import type { AgentRun, WorkItem } from '../../../domain/run/types.js';
import type { RunExecutionEntry, RunExecutionNode, RunDelivery, RunListOptions, ExecutionEntryListOptions } from '../../../domain/run/execution-models.js';
import type { AgentSession, RuntimeSessionEntry, RuntimeSessionSummary } from '../../../domain/session/types.js';
import type { RuntimeStorage, RuntimeTransactionCallback, SynchronousRuntimeTransactionCallback } from '../../../sdk/runtime-storage.js';
import type { RuntimeArtifactRow, RuntimeRunRow, RuntimeSessionRow } from './runtime-row-types.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mapArtifactRow, mapRunRow, mapSessionRow } from './runtime-row-mappers.js';
import { invalidRuntimeInput, mapSqliteFailure, rejectedRuntimeInput, sqliteAction } from './runtime-sqlite-error.js';
import { createSqliteRuntimeUnitOfWork } from './runtime-unit-of-work.js';
import { SqliteRuntimeEventRepository } from './runtime-event-repository.js';
import { SqliteRuntimeWorkItemRepository } from './runtime-work-item-repository.js';
import { SqliteRuntimeSessionRepository } from './runtime-session-repository.js';
import { SqliteRuntimeRunRepository } from './runtime-run-repository.js';
import { SqliteRuntimeDeliveryRepository, SqliteRuntimeExecutionEntryRepository, SqliteRuntimeExecutionNodeRepository } from './runtime-execution-repositories.js';

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  ((typeof value === 'object' && value !== null) || typeof value === 'function')
  && typeof (value as { then?: unknown }).then === 'function';

export class SqliteRuntimeStore implements RuntimeStorage {
  private tail = Promise.resolve();
  private activeCallback = false;
  private readonly callbackContext = new AsyncLocalStorage<boolean>();

  constructor(private readonly db: Database.Database) {
    this.db.pragma('busy_timeout = 5000');
  }

  transaction<T extends RuntimeTransactionCallback>(
    operation: SynchronousRuntimeTransactionCallback<T>,
  ): Promise<ReturnType<T>> {
    if (this.isCallbackContext()) return this.rejectReentrant('transaction');
    return this.lock(() => {
      let callbackFailure: unknown;
      let callbackFailed = false;
      try {
        return this.db.transaction(() => {
          let result: ReturnType<T>;
          const guard = { active: true };
          const unitOfWork = createSqliteRuntimeUnitOfWork(this.db, guard);
          this.activeCallback = true;
          try {
            result = this.callbackContext.run(true, () => operation(unitOfWork)) as ReturnType<T>;
          }
          catch (error) { callbackFailed = true; callbackFailure = error; throw error; }
          finally { guard.active = false; this.activeCallback = false; }
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

  getSession(sessionId: string): Promise<AgentSession | null> {
    if (this.isCallbackContext()) return this.rejectReentrant('getSession');
    return this.lock(() => sqliteAction('reading runtime session', () => {
      const row = this.db.prepare('SELECT * FROM runtime_sessions WHERE id = ?').get(sessionId) as RuntimeSessionRow | undefined;
      return row ? mapSessionRow(row) : null;
    }));
  }

  listSessions(tenantId: string): Promise<RuntimeSessionSummary[]> {
    if (this.isCallbackContext()) return this.rejectReentrant('listSessions');
    return this.lock(() => new SqliteRuntimeSessionRepository(this.db).listByTenant(tenantId));
  }

  listSessionEntries(sessionId: string): Promise<RuntimeSessionEntry[]> {
    if (this.isCallbackContext()) return this.rejectReentrant('listSessionEntries');
    return this.lock(() => new SqliteRuntimeSessionRepository(this.db).listEntries(sessionId));
  }

  listRuns(tenantId: string, options?: RunListOptions): Promise<AgentRun[]> {
    if (this.isCallbackContext()) return this.rejectReentrant('listRuns');
    return this.lock(() => new SqliteRuntimeRunRepository(this.db).listByTenant(tenantId, options));
  }

  getRun(runId: string): Promise<AgentRun | null> {
    if (this.isCallbackContext()) return this.rejectReentrant('getRun');
    return this.lock(() => sqliteAction('reading runtime run', () => {
      const row = this.db.prepare('SELECT * FROM runtime_runs WHERE id = ?').get(runId) as RuntimeRunRow | undefined;
      return row ? mapRunRow(row) : null;
    }));
  }

  listEvents(runId: string, afterSequence = 0, limit = 100): Promise<RunEvent[]> {
    if (this.isCallbackContext()) return this.rejectReentrant('listEvents');
    return this.lock(() => new SqliteRuntimeEventRepository(this.db).list(runId, afterSequence, limit));
  }

  listArtifacts(runId: string): Promise<Artifact[]> {
    if (this.isCallbackContext()) return this.rejectReentrant('listArtifacts');
    return this.lock(() => sqliteAction('listing runtime artifacts', () => {
      const rows = this.db.prepare('SELECT * FROM runtime_artifacts WHERE run_id = ? ORDER BY created_at, id').all(runId) as RuntimeArtifactRow[];
      return rows.map(mapArtifactRow);
    }));
  }

  getArtifact(artifactId: string): Promise<Artifact | null> {
    if (this.isCallbackContext()) return this.rejectReentrant('getArtifact');
    return this.lock(() => sqliteAction('reading runtime artifact', () => {
      const row = this.db.prepare('SELECT * FROM runtime_artifacts WHERE id = ?').get(artifactId) as RuntimeArtifactRow | undefined;
      return row ? mapArtifactRow(row) : null;
    }));
  }

  listExecutionNodes(runId: string): Promise<RunExecutionNode[]> {
    if (this.isCallbackContext()) return this.rejectReentrant('listExecutionNodes');
    return this.lock(() => new SqliteRuntimeExecutionNodeRepository(this.db).listByRun(runId));
  }

  listExecutionEntries(runId: string, options: ExecutionEntryListOptions = {}): Promise<RunExecutionEntry[]> {
    if (this.isCallbackContext()) return this.rejectReentrant('listExecutionEntries');
    return this.lock(() => new SqliteRuntimeExecutionEntryRepository(this.db).listByRun(runId, options.afterSequence ?? 0, Math.min(options.limit ?? 100, 1000)));
  }

  listDeliveries(runId: string): Promise<RunDelivery[]> {
    if (this.isCallbackContext()) return this.rejectReentrant('listDeliveries');
    return this.lock(() => new SqliteRuntimeDeliveryRepository(this.db).listByRun(runId));
  }

  claimWorkItem(owner: string, now: Date, leaseMs: number): Promise<WorkItem | null> {
    if (this.isCallbackContext()) return this.rejectReentrant('claimWorkItem');
    const leaseOwner = owner.trim();
    const expiresAt = new Date(now.getTime() + leaseMs);
    if (!leaseOwner) return rejectedRuntimeInput('Lease owner is required');
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0 || !Number.isFinite(now.getTime())
      || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
      return rejectedRuntimeInput('Lease duration must produce a valid expiry');
    }
    return this.lock(() => {
      try {
        return this.db.transaction(() => {
          const repository = new SqliteRuntimeWorkItemRepository(this.db);
          for (const candidate of repository.listClaimCandidates(now)) {
            const claimed = repository.claim(candidate, leaseOwner, now, expiresAt);
            if (claimed) return claimed;
          }
          return null;
        }).immediate();
      } catch (error) { return mapSqliteFailure(error, 'claiming runtime work item'); }
    });
  }

  listRecoverableWorkItems(now: Date): Promise<WorkItem[]> {
    if (this.isCallbackContext()) return this.rejectReentrant('listRecoverableWorkItems');
    if (!Number.isFinite(now.getTime())) return rejectedRuntimeInput('Recovery time must be valid');
    return this.lock(() => new SqliteRuntimeWorkItemRepository(this.db).listRecoverable(now));
  }

  private rejectReentrant<T>(operation: string): Promise<T> {
    return rejectedRuntimeInput(`RuntimeStorage ${operation} cannot run inside a transaction callback`);
  }

  private isCallbackContext(): boolean {
    return this.activeCallback || this.callbackContext.getStore() === true;
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
