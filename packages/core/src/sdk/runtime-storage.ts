import type { Artifact } from '../domain/artifact/types.js';
import type { RunEvent } from '../domain/event/types.js';
import type { AgentRun, WorkItem } from '../domain/run/types.js';
import type { RunExecutionEntry, RunExecutionNode, RunDelivery, RunListOptions, ExecutionEntryListOptions } from '../domain/run/execution-models.js';
import type { AgentSession, RuntimeSessionEntry, RuntimeSessionSummary } from '../domain/session/types.js';
import type { RuntimeUnitOfWork } from './runtime-storage-repositories.js';

export type { IdempotencyRecord, RuntimeArtifactRepository, RuntimeEventRepository,
  RuntimeIdempotencyRepository, RuntimeRunRepository, RuntimeSessionRepository,
  RuntimeToolInvocationRepository, RuntimeExecutionBudgetRepository, RuntimeUnitOfWork, RuntimeWorkItemRepository,
} from './runtime-storage-repositories.js';
export type { RuntimeDeliveryRepository, RuntimeExecutionEntryRepository, RuntimeExecutionNodeRepository } from './runtime-execution-repositories.js';

export type RuntimeTransactionCallback = (uow: RuntimeUnitOfWork) => unknown;
export type SynchronousRuntimeTransactionCallback<T extends RuntimeTransactionCallback> =
  T & (Extract<ReturnType<T>, PromiseLike<unknown>> extends never ? unknown : never);

export interface RuntimeStorage {
  transaction<T extends RuntimeTransactionCallback>(
    operation: SynchronousRuntimeTransactionCallback<T>,
  ): Promise<ReturnType<T>>;
  getSession(sessionId: string): Promise<AgentSession | null>;
  listSessions(tenantId: string): Promise<RuntimeSessionSummary[]>;
  listSessionEntries(sessionId: string): Promise<RuntimeSessionEntry[]>;
  getRun(runId: string): Promise<AgentRun | null>;
  listRuns(tenantId: string, options?: RunListOptions): Promise<AgentRun[]>;
  listEvents(runId: string, afterSequence?: number, limit?: number): Promise<RunEvent[]>;
  listArtifacts(runId: string): Promise<Artifact[]>;
  getArtifact(artifactId: string): Promise<Artifact | null>;
  listExecutionNodes(runId: string): Promise<RunExecutionNode[]>;
  listExecutionEntries(runId: string, options?: ExecutionEntryListOptions): Promise<RunExecutionEntry[]>;
  listDeliveries(runId: string): Promise<RunDelivery[]>;
  claimWorkItem(owner: string, now: Date, leaseMs: number): Promise<WorkItem | null>;
  listRecoverableWorkItems(now: Date): Promise<WorkItem[]>;
}
