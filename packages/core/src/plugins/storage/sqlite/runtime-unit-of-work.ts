import type Database from 'better-sqlite3';
import type { RuntimeUnitOfWork } from '../../../sdk/runtime-storage.js';
import { SqliteRuntimeArtifactRepository } from './runtime-artifact-repository.js';
import { SqliteRuntimeEventRepository } from './runtime-event-repository.js';
import { SqliteRuntimeIdempotencyRepository } from './runtime-idempotency-repository.js';
import { SqliteRuntimeRunRepository } from './runtime-run-repository.js';
import { SqliteRuntimeSessionRepository } from './runtime-session-repository.js';
import { SqliteRuntimeToolInvocationRepository } from './runtime-tool-invocation-repository.js';
import { SqliteRuntimeWorkItemRepository } from './runtime-work-item-repository.js';
import { invalidRuntimeInput } from './runtime-sqlite-error.js';

export interface RuntimeTransactionGuard { active: boolean }

function guardRepository<T extends object>(repository: T, guard: RuntimeTransactionGuard): T {
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        if (!guard.active) invalidRuntimeInput('RuntimeUnitOfWork is no longer active');
        return Reflect.apply(value, target, args);
      };
    },
  });
}

export function createSqliteRuntimeUnitOfWork(
  db: Database.Database,
  guard: RuntimeTransactionGuard,
): RuntimeUnitOfWork {
  return {
    sessions: guardRepository(new SqliteRuntimeSessionRepository(db), guard),
    runs: guardRepository(new SqliteRuntimeRunRepository(db), guard),
    events: guardRepository(new SqliteRuntimeEventRepository(db), guard),
    workItems: guardRepository(new SqliteRuntimeWorkItemRepository(db), guard),
    artifacts: guardRepository(new SqliteRuntimeArtifactRepository(db), guard),
    idempotency: guardRepository(new SqliteRuntimeIdempotencyRepository(db), guard),
    toolInvocations: guardRepository(new SqliteRuntimeToolInvocationRepository(db), guard),
  };
}
