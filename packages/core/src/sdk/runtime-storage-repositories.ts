import type { Artifact } from '../domain/artifact/types.js';
import type { RunEvent } from '../domain/event/types.js';
import type { AgentRun, ToolInvocation, WorkItem } from '../domain/run/types.js';
import type { AgentSession, RuntimeSessionEntry, RuntimeSessionSummary } from '../domain/session/types.js';
import type { RunExecutionEntry, RunExecutionNode, RunDelivery, RunExecutionBudget, RunListOptions } from '../domain/run/execution-models.js';
import type { RuntimeDeliveryRepository, RuntimeExecutionEntryRepository, RuntimeExecutionNodeRepository } from './runtime-execution-repositories.js';

export interface RuntimeSessionRepository {
  insert(session: AgentSession): void;
  get(sessionId: string): AgentSession | null;
  listByTenant(tenantId: string): RuntimeSessionSummary[];
  appendEntries(entries: RuntimeSessionEntry[]): void;
  nextEntrySequence(sessionId: string): number;
  listEntries(sessionId: string): RuntimeSessionEntry[];
  update(session: AgentSession): void;
}

export interface RuntimeRunRepository {
  insert(run: AgentRun): void;
  get(runId: string): AgentRun | null;
  update(run: AgentRun): void;
  listByTenant(tenantId: string, options?: RunListOptions): AgentRun[];
}

export interface RuntimeEventRepository {
  append(event: RunEvent): void;
  nextSequence(runId: string): number;
  list(runId: string, afterSequence: number, limit: number): RunEvent[];
}

export interface RuntimeWorkItemRepository {
  insert(item: WorkItem): void;
  getByRun(runId: string): WorkItem | null;
  update(item: WorkItem): void;
}

export interface RuntimeArtifactRepository {
  insert(artifact: Artifact): void;
  listByRun(runId: string): Artifact[];
}

export interface IdempotencyRecord {
  tenantId: string;
  operation: 'start-run' | 'resolve-tool-invocation';
  idempotencyKey: string;
  requestHash: string;
  resourceId: string;
  createdAt: Date;
}

export interface RuntimeIdempotencyRepository {
  get(tenantId: string, operation: IdempotencyRecord['operation'], key: string): IdempotencyRecord | null;
  insert(record: IdempotencyRecord): void;
}

export interface RuntimeToolInvocationRepository {
  insert(invocation: ToolInvocation): void;
  get(invocationId: string): ToolInvocation | null;
  getByRunAndCall(runId: string, toolCallId: string, nodeId?: string): ToolInvocation | null;
  update(invocation: ToolInvocation): void;
  listByRun(runId: string): ToolInvocation[];
}

export interface RuntimeExecutionBudgetRepository {
  insert(budget: RunExecutionBudget): void;
  get(runId: string): RunExecutionBudget | null;
  update(budget: RunExecutionBudget): void;
}

export interface RuntimeUnitOfWork {
  sessions: RuntimeSessionRepository;
  runs: RuntimeRunRepository;
  events: RuntimeEventRepository;
  workItems: RuntimeWorkItemRepository;
  artifacts: RuntimeArtifactRepository;
  idempotency: RuntimeIdempotencyRepository;
  toolInvocations: RuntimeToolInvocationRepository;
  executionBudgets: RuntimeExecutionBudgetRepository;
  executionNodes: RuntimeExecutionNodeRepository;
  executionEntries: RuntimeExecutionEntryRepository;
  deliveries: RuntimeDeliveryRepository;
}
