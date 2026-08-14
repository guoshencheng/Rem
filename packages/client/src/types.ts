import type {
  AgentDefinition,
  Run,
  Session,
  Artifact,
  RunEvent,
  RunLiveSignal,
  RunSignal,
  StartRunInput,
  RuntimeSessionEntry,
  RuntimeSessionSummary,
  RunExecutionNode,
  RunExecutionEntry,
  RunDelivery,
  RuntimeToolInvocation,
  ToolInvocationResolution,
  ContextPatch,
  RuntimeHealth,
} from 'rem-agent-core';

export interface RuntimeClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  headers?: HeadersInit;
}

export interface RuntimeClientHealth { get(): Promise<RuntimeHealth>; }

export interface ListEventsOptions {
  afterSequence?: number;
  limit?: number;
}

export interface SubscribeOptions {
  signal?: AbortSignal;
}

export interface WaitForCompletionOptions {
  signal?: AbortSignal;
  pollMs?: number;
}

export interface RuntimeClientAgents {
  list(): Promise<AgentDefinition[]>;
  get(agentId: string, revision?: string): Promise<AgentDefinition>;
}

export interface RuntimeClientSessions {
  list(): Promise<RuntimeSessionSummary[]>;
  create(): Promise<Session>;
  get(sessionId: string): Promise<Session>;
  listEntries(sessionId: string): Promise<RuntimeSessionEntry[]>;
  patchContexts(sessionId: string, patch: ContextPatch, expectedVersion: number): Promise<Session>;
}

export interface RuntimeClientRuns {
  list(options?: { sessionId?: string; status?: Run['status']; cursor?: string; limit?: number }): Promise<{ items: Run[]; nextCursor?: string }>;
  start(input: StartRunInput): Promise<Run>;
  get(runId: string): Promise<Run>;
  cancel(runId: string): Promise<Run>;
  listEvents(runId: string, options?: ListEventsOptions): Promise<RunEvent[]>;
  subscribe(runId: string, options?: SubscribeOptions): AsyncIterable<RunSignal>;
  waitForCompletion(runId: string, options?: WaitForCompletionOptions): Promise<Run>;
  listExecutionNodes(runId: string): Promise<RunExecutionNode[]>;
  listExecutionEntries(runId: string, options?: ListEventsOptions): Promise<RunExecutionEntry[]>;
  listDeliveries(runId: string): Promise<RunDelivery[]>;
  listToolInvocations(runId: string): Promise<RuntimeToolInvocation[]>;
  resolveToolInvocation(runId: string, invocationId: string, resolution: ToolInvocationResolution): Promise<Run>;
}

export type { RunLiveSignal };

export interface RuntimeClientArtifacts {
  listByRun(runId: string): Promise<Artifact[]>;
  get(artifactId: string): Promise<Artifact>;
}
