import type Database from 'better-sqlite3';
import type { RuntimeUnitOfWork } from '../../../sdk/runtime-storage.js';
import { SqliteRuntimeArtifactRepository } from './runtime-artifact-repository.js';
import { SqliteRuntimeEventRepository } from './runtime-event-repository.js';
import { SqliteRuntimeIdempotencyRepository } from './runtime-idempotency-repository.js';
import { SqliteRuntimeRunRepository } from './runtime-run-repository.js';
import { SqliteRuntimeSessionRepository } from './runtime-session-repository.js';
import { SqliteRuntimeToolInvocationRepository } from './runtime-tool-invocation-repository.js';
import { SqliteRuntimeWorkItemRepository } from './runtime-work-item-repository.js';

export function createSqliteRuntimeUnitOfWork(db: Database.Database): RuntimeUnitOfWork {
  return {
    sessions: new SqliteRuntimeSessionRepository(db),
    runs: new SqliteRuntimeRunRepository(db),
    events: new SqliteRuntimeEventRepository(db),
    workItems: new SqliteRuntimeWorkItemRepository(db),
    artifacts: new SqliteRuntimeArtifactRepository(db),
    idempotency: new SqliteRuntimeIdempotencyRepository(db),
    toolInvocations: new SqliteRuntimeToolInvocationRepository(db),
  };
}
