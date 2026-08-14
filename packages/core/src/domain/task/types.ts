import type { ContextPatch } from '../context/types.js';
import type { JsonValue } from '../json/types.js';
import type { RuntimeErrorCode } from '../error/types.js';
import type { Artifact } from '../artifact/types.js';
import type { AgentRun, RuntimeToolInvocation } from '../run/types.js';

export interface StartTaskInput {
  agentId: string;
  agentRevision?: string;
  sessionId?: string;
  input: JsonValue;
  contexts?: ContextPatch;
  idempotencyKey?: string;
}

export interface ExecuteTaskOptions {
  signal?: AbortSignal;
}

export interface TaskResult<TOutput extends JsonValue = JsonValue> {
  artifact: Artifact;
  value?: TOutput;
}

export type TaskOutcome<TOutput extends JsonValue = JsonValue> =
  | { status: 'completed'; run: AgentRun; result: TaskResult<TOutput> }
  | { status: 'waiting'; run: AgentRun; unknownInvocations: RuntimeToolInvocation[] }
  | { status: 'failed' | 'cancelled'; run: AgentRun; errorCode: RuntimeErrorCode };

export interface RuntimeTaskOperations {
  start(input: StartTaskInput): Promise<AgentRun>;
  wait<TOutput extends JsonValue = JsonValue>(runId: string, options?: ExecuteTaskOptions): Promise<TaskOutcome<TOutput>>;
  execute<TOutput extends JsonValue = JsonValue>(input: StartTaskInput, options?: ExecuteTaskOptions): Promise<TaskOutcome<TOutput>>;
}
