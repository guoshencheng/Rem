import type { Artifact } from '../../domain/artifact/types.js';
import type { RunExecutionEntry, RunExecutionNode, RunDelivery, RunListOptions, ExecutionEntryListOptions, ToolInvocationResolution } from '../../domain/run/execution-models.js';
import type { RuntimeToolInvocation, AgentRun } from '../../domain/run/types.js';

export interface RuntimeRunListResult {
  items: AgentRun[];
  nextCursor?: string;
}

export interface RuntimeRunOperations {
  list(options?: RunListOptions): Promise<RuntimeRunListResult>;
  listExecutionNodes(runId: string): Promise<RunExecutionNode[]>;
  listExecutionEntries(runId: string, options?: ExecutionEntryListOptions): Promise<RunExecutionEntry[]>;
  listDeliveries(runId: string): Promise<RunDelivery[]>;
  listToolInvocations(runId: string): Promise<RuntimeToolInvocation[]>;
  resolveToolInvocation(runId: string, invocationId: string, resolution: ToolInvocationResolution, principalId?: string): Promise<AgentRun>;
}

export interface RuntimeArtifactOperations {
  listByRun(runId: string): Promise<Artifact[]>;
  get(artifactId: string): Promise<Artifact>;
}

export type { RuntimeTaskOperations } from '../../domain/task/types.js';

export interface SessionContextPatchInput {
  patch: import('../../domain/context/types.js').ContextPatch;
  expectedVersion: number;
}
