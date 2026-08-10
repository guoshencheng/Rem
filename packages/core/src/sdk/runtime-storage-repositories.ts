import type { Artifact } from '../domain/artifact/types.js';
import type { RunEvent } from '../domain/event/types.js';
import type { AgentRun, ToolInvocation, WorkItem } from '../domain/run/types.js';
import type { AgentSession, RuntimeSessionEntry } from '../domain/session/types.js';

export interface RuntimeSessionRepository {
  insert(session: AgentSession): void;
  get(sessionId: string): AgentSession | null;
  appendEntries(entries: RuntimeSessionEntry[]): void;
  listEntries(sessionId: string): RuntimeSessionEntry[];
}

export interface RuntimeRunRepository {
  insert(run: AgentRun): void;
  get(runId: string): AgentRun | null;
  update(run: AgentRun): void;
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
  operation: 'start-run';
  idempotencyKey: string;
  requestHash: string;
  resourceId: string;
  createdAt: Date;
}

export interface RuntimeIdempotencyRepository {
  get(tenantId: string, operation: 'start-run', key: string): IdempotencyRecord | null;
  insert(record: IdempotencyRecord): void;
}

export interface RuntimeToolInvocationRepository {
  insert(invocation: ToolInvocation): void;
  get(invocationId: string): ToolInvocation | null;
  update(invocation: ToolInvocation): void;
  listByRun(runId: string): ToolInvocation[];
}

export interface RuntimeUnitOfWork {
  sessions: RuntimeSessionRepository;
  runs: RuntimeRunRepository;
  events: RuntimeEventRepository;
  workItems: RuntimeWorkItemRepository;
  artifacts: RuntimeArtifactRepository;
  idempotency: RuntimeIdempotencyRepository;
  toolInvocations: RuntimeToolInvocationRepository;
}
