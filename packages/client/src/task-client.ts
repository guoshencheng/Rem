import type { Artifact, JsonValue, Run, RuntimeToolInvocation, StartTaskInput, TaskOutcome, ExecuteTaskOptions } from 'rem-agent-core';
import { RuntimeClientError } from './client-error.js';
import type { RuntimeHttpClient } from './http-client.js';
import { subscribeToRun } from './sse-client.js';
import { RUNTIME_ERROR_CODES } from './runtime-error-codes.js';

export interface RuntimeClientTasks {
  start(input: StartTaskInput): Promise<Run>;
  wait<TOutput extends JsonValue = JsonValue>(runId: string, options?: ExecuteTaskOptions): Promise<TaskOutcome<TOutput>>;
  execute<TOutput extends JsonValue = JsonValue>(input: StartTaskInput, options?: ExecuteTaskOptions): Promise<TaskOutcome<TOutput>>;
}

export function createRuntimeClientTasks(http: RuntimeHttpClient): RuntimeClientTasks {
  return {
    start: (input) => http.startRun(toStartRunInput(input)),
    wait: (runId, options) => waitForRemoteTask(http, runId, options),
    execute: async (input, options) => {
      const run = await http.startRun(toStartRunInput(input));
      return waitForRemoteTask(http, run.runId, options, run);
    },
  };
}

async function waitForRemoteTask<TOutput extends JsonValue = JsonValue>(
  http: RuntimeHttpClient,
  runId: string,
  options?: ExecuteTaskOptions,
  initialRun?: Run,
): Promise<TaskOutcome<TOutput>> {
  options?.signal?.throwIfAborted();
  const controller = new AbortController();
  const onAbort = (): void => controller.abort(options?.signal?.reason);
  options?.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    let current = initialRun ?? await http.getRun(runId);
    options?.signal?.throwIfAborted();
    const immediate = await materializeRemoteOutcome(http, current);
    options?.signal?.throwIfAborted();
    if (immediate) return immediate as TaskOutcome<TOutput>;
    const iterator = subscribeToRun(http, runId, { signal: controller.signal })[Symbol.asyncIterator]();
    try {
      for (;;) {
        let result: IteratorResult<import('rem-agent-core').RunSignal>;
        try { result = await iterator.next(); }
        catch (error) {
          options?.signal?.throwIfAborted();
          return pollRemoteTask(http, runId, controller.signal) as Promise<TaskOutcome<TOutput>>;
        }
        if (result.done) return pollRemoteTask(http, runId, controller.signal) as Promise<TaskOutcome<TOutput>>;
        if (!isActionableSignal(result.value.type)) continue;
        current = await http.getRun(runId);
        const outcome = await materializeRemoteOutcome(http, current);
        if (outcome) return outcome as TaskOutcome<TOutput>;
      }
    } finally { await iterator.return?.(); }
  } finally {
    options?.signal?.removeEventListener('abort', onAbort);
    controller.abort();
  }
}

async function pollRemoteTask(http: RuntimeHttpClient, runId: string, signal: AbortSignal): Promise<TaskOutcome> {
  for (;;) {
    const run = await http.getRun(runId);
    const outcome = await materializeRemoteOutcome(http, run);
    if (outcome) return outcome;
    await sleep(100, signal);
  }
}

async function materializeRemoteOutcome(http: RuntimeHttpClient, run: Run): Promise<TaskOutcome | undefined> {
  if (run.trigger.type !== 'task') throw new RuntimeClientError('INVALID_INPUT', 'Run is not a task run', 200);
  if (run.status === 'waiting') {
    const unknownInvocations = (await http.listToolInvocations(run.runId)).filter((invocation) => invocation.status === 'unknown');
    return { status: 'waiting', run, unknownInvocations };
  }
  if (run.status === 'failed' || run.status === 'cancelled') {
    return { status: run.status, run, errorCode: stableErrorCode(run.errorCode) };
  }
  if (run.status !== 'completed') return undefined;
  if (!run.primaryArtifactId) throw new RuntimeClientError('INTERNAL_ERROR', 'Completed task has no primary Artifact', 200);
  const artifact = await http.getArtifact(run.primaryArtifactId);
  assertArtifact(artifact, run);
  return { status: 'completed', run, result: decodeTaskArtifact(artifact) };
}

function decodeTaskArtifact(artifact: Artifact): { artifact: Artifact; value?: JsonValue } {
  if (artifact.data !== undefined && typeof artifact.data !== 'string') {
    throw new RuntimeClientError('INTERNAL_ERROR', 'Primary Artifact data is invalid', 200);
  }
  if (artifact.uri !== undefined && typeof artifact.uri !== 'string') {
    throw new RuntimeClientError('INTERNAL_ERROR', 'Primary Artifact URI is invalid', 200);
  }
  if (artifact.data === undefined) {
    if (artifact.uri === undefined) throw new RuntimeClientError('INTERNAL_ERROR', 'Primary Artifact has no data or URI', 200);
    return { artifact };
  }
  if (artifact.mediaType === 'text/plain') return { artifact, value: artifact.data };
  if (artifact.mediaType !== 'application/json') throw new RuntimeClientError('INTERNAL_ERROR', 'Primary Artifact media type is unsupported', 200);
  try {
    const value: unknown = JSON.parse(artifact.data);
    if (!isJsonValue(value)) throw new Error('Artifact JSON is not canonical');
    return { artifact, value };
  } catch (cause) {
    throw new RuntimeClientError('INTERNAL_ERROR', 'Primary Artifact JSON is invalid', 200, false, undefined, { cause });
  }
}

function assertArtifact(artifact: Artifact, run: Run): void {
  if (artifact.tenantId !== run.tenantId || artifact.runId !== run.runId || artifact.sessionId !== run.sessionId || artifact.type !== 'result') {
    throw new RuntimeClientError('INTERNAL_ERROR', 'Primary Artifact does not belong to the task Run', 200);
  }
}

function stableErrorCode(value: string | undefined): typeof RUNTIME_ERROR_CODES[number] {
  return RUNTIME_ERROR_CODES.includes(value as typeof RUNTIME_ERROR_CODES[number])
    ? value as typeof RUNTIME_ERROR_CODES[number]
    : 'INTERNAL_ERROR';
}

function toStartRunInput(input: StartTaskInput) {
  const { input: taskInput, ...rest } = input;
  return { ...rest, trigger: { type: 'task' as const, input: taskInput } };
}

function isActionableSignal(type: string): boolean {
  return type === 'run.waiting' || type === 'run.completed' || type === 'run.failed' || type === 'run.cancelled';
}

function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, seen));
  return Object.values(value as Record<string, unknown>).every((item) => isJsonValue(item, seen));
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); return; }
    let settled = false;
    const onAbort = (): void => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener('abort', onAbort);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true; signal.removeEventListener('abort', onAbort); resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
