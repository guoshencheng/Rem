import type { Artifact } from '../../domain/artifact/types.js';
import type { AgentRun, RuntimeToolInvocation } from '../../domain/run/types.js';
import type { RuntimeStorage } from '../../sdk/runtime-storage.js';
import type { TaskOutcome, TaskResult } from '../../domain/task/types.js';
import type { JsonValue } from '../../domain/json/types.js';
import { cloneCanonicalJson } from '../contexts/canonical-json.js';
import { RuntimeError } from '../runtime/runtime-error.js';
import { RUNTIME_ERROR_CODES, type RuntimeErrorCode } from '../../domain/error/types.js';

export async function materializeTaskOutcome(
  storage: RuntimeStorage,
  tenantId: string,
  run: AgentRun,
): Promise<TaskOutcome | undefined> {
  if (run.trigger.type !== 'task') throw new RuntimeError('INVALID_INPUT', 'Run is not a task run');
  if (run.status === 'waiting') {
    let unknownInvocations: RuntimeToolInvocation[];
    try {
      unknownInvocations = await storage.transaction((uow) => uow.toolInvocations.listByRun(run.runId)
        .filter((invocation) => invocation.status === 'unknown')
        .sort(compareInvocation));
    } catch (error) { throw storageFailure(error); }
    return { status: 'waiting', run, unknownInvocations };
  }
  if (run.status === 'failed' || run.status === 'cancelled') {
    return { status: run.status, run, errorCode: stableErrorCode(run.errorCode) };
  }
  if (run.status !== 'completed') return undefined;
  if (!run.primaryArtifactId) throw new RuntimeError('INTERNAL_ERROR', 'Completed task has no primary Artifact');
  let artifact: Artifact | null;
  try { artifact = await storage.getArtifact(run.primaryArtifactId); }
  catch (error) { throw storageFailure(error); }
  assertPrimaryArtifact(artifact, run, tenantId);
  return { status: 'completed', run, result: decodeArtifact(artifact) };
}

function decodeArtifact(artifact: Artifact): TaskResult {
  if (artifact.data !== undefined && typeof artifact.data !== 'string') throw new RuntimeError('INTERNAL_ERROR', 'Primary Artifact data is invalid');
  if (artifact.uri !== undefined && typeof artifact.uri !== 'string') throw new RuntimeError('INTERNAL_ERROR', 'Primary Artifact URI is invalid');
  if (artifact.data === undefined) {
    if (artifact.uri === undefined) throw new RuntimeError('INTERNAL_ERROR', 'Primary Artifact has no data or URI');
    return { artifact: structuredClone(artifact) };
  }
  if (artifact.mediaType === 'text/plain') return { artifact: structuredClone(artifact), value: artifact.data };
  if (artifact.mediaType !== 'application/json') throw new RuntimeError('INTERNAL_ERROR', 'Primary Artifact media type is unsupported');
  try {
    const value = cloneCanonicalJson(JSON.parse(artifact.data)) as JsonValue;
    return { artifact: structuredClone(artifact), value };
  } catch (cause) {
    throw new RuntimeError('INTERNAL_ERROR', 'Primary Artifact JSON is invalid', false, undefined, { cause });
  }
}

function assertPrimaryArtifact(artifact: Artifact | null, run: AgentRun, tenantId: string): asserts artifact is Artifact {
  if (!artifact || artifact.tenantId !== tenantId || artifact.runId !== run.runId
    || artifact.sessionId !== run.sessionId || artifact.type !== 'result') {
    throw new RuntimeError('INTERNAL_ERROR', 'Primary Artifact does not belong to the task Run');
  }
}

function stableErrorCode(value: string | undefined): RuntimeErrorCode {
  return RUNTIME_ERROR_CODES.includes(value as RuntimeErrorCode) ? value as RuntimeErrorCode : 'INTERNAL_ERROR';
}

function compareInvocation(left: RuntimeToolInvocation, right: RuntimeToolInvocation): number {
  return left.createdAt.getTime() - right.createdAt.getTime() || left.invocationId.localeCompare(right.invocationId);
}

function storageFailure(error: unknown): RuntimeError {
  return error instanceof RuntimeError ? error : new RuntimeError('STORAGE_UNAVAILABLE', 'Runtime storage operation failed', true, undefined, { cause: error });
}
