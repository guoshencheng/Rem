import type { Artifact } from '../domain/artifact/types.js';
import type { RunEvent } from '../domain/event/types.js';
import type { AgentRun, WorkItem } from '../domain/run/types.js';
import type { AgentSession } from '../domain/session/types.js';
import type { RuntimeUnitOfWork } from './runtime-storage-repositories.js';

export type { IdempotencyRecord, RuntimeArtifactRepository, RuntimeEventRepository,
  RuntimeIdempotencyRepository, RuntimeRunRepository, RuntimeSessionRepository,
  RuntimeToolInvocationRepository, RuntimeUnitOfWork, RuntimeWorkItemRepository,
} from './runtime-storage-repositories.js';

export type RuntimeTransactionCallback = (uow: RuntimeUnitOfWork) => unknown;
export type SynchronousRuntimeTransactionCallback<T extends RuntimeTransactionCallback> =
  T & (ReturnType<T> extends PromiseLike<unknown> ? never : unknown);

export interface RuntimeStorage {
  transaction<T extends RuntimeTransactionCallback>(
    operation: SynchronousRuntimeTransactionCallback<T>,
  ): Promise<ReturnType<T>>;
  getSession(sessionId: string): Promise<AgentSession | null>;
  getRun(runId: string): Promise<AgentRun | null>;
  listEvents(runId: string, afterSequence?: number, limit?: number): Promise<RunEvent[]>;
  listArtifacts(runId: string): Promise<Artifact[]>;
  claimWorkItem(owner: string, now: Date, leaseMs: number): Promise<WorkItem | null>;
  listRecoverableWorkItems(now: Date): Promise<WorkItem[]>;
}
