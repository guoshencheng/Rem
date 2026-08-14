import type { AgentRun } from '../../domain/run/types.js';
import type { RuntimeStorage } from '../../sdk/runtime-storage.js';
import type { RunSignalHub } from '../../runtime-events/run-signal-hub.js';
import type { TaskOutcome, ExecuteTaskOptions } from '../../domain/task/types.js';
import { getScopedRun } from '../runs/run-queries.js';
import { materializeTaskOutcome } from './task-outcome.js';

interface WaitTaskDeps {
  context: { tenantId: string };
  storage: RuntimeStorage;
  signals: RunSignalHub;
  waitPollMs: number;
}

export async function waitForTaskOutcome<TOutput extends import('../../domain/json/types.js').JsonValue = import('../../domain/json/types.js').JsonValue>(
  deps: WaitTaskDeps,
  runId: string,
  options?: ExecuteTaskOptions,
  initialRun?: AgentRun,
): Promise<TaskOutcome<TOutput>> {
  options?.signal?.throwIfAborted();
  const first = initialRun ?? await getScopedRun(deps.storage, deps.context.tenantId, runId);
  options?.signal?.throwIfAborted();
  const immediate = await materializeTaskOutcome(deps.storage, deps.context.tenantId, first);
  options?.signal?.throwIfAborted();
  if (immediate) return immediate as TaskOutcome<TOutput>;

  const subscription = deps.signals.subscribe(runId);
  const iterator = subscription[Symbol.asyncIterator]();
  const onAbort = (): void => subscription.close();
  options?.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    // Re-read once after subscribing to close the read→subscribe race window.
    const current = await getScopedRun(deps.storage, deps.context.tenantId, runId);
    options?.signal?.throwIfAborted();
    const racedOutcome = await materializeTaskOutcome(deps.storage, deps.context.tenantId, current);
    if (racedOutcome) return racedOutcome as TaskOutcome<TOutput>;
    for (;;) {
      const result = await iterator.next();
      options?.signal?.throwIfAborted();
      if (result.done) return pollAfterSignalClose(deps, runId, options?.signal) as Promise<TaskOutcome<TOutput>>;
      if (!isTaskOutcomeSignal(result.value.type)) continue;
      const updated = await getScopedRun(deps.storage, deps.context.tenantId, runId);
      const outcome = await materializeTaskOutcome(deps.storage, deps.context.tenantId, updated);
      if (outcome) return outcome as TaskOutcome<TOutput>;
    }
  } finally {
    options?.signal?.removeEventListener('abort', onAbort);
    subscription.close();
    await iterator.return?.();
  }
}

async function pollAfterSignalClose(deps: WaitTaskDeps, runId: string, signal?: AbortSignal): Promise<TaskOutcome> {
  for (;;) {
    signal?.throwIfAborted();
    const run = await getScopedRun(deps.storage, deps.context.tenantId, runId);
    const outcome = await materializeTaskOutcome(deps.storage, deps.context.tenantId, run);
    if (outcome) return outcome;
    await sleep(deps.waitPollMs, signal);
  }
}

function isTaskOutcomeSignal(type: string): boolean {
  return type === 'run.waiting' || type === 'run.completed' || type === 'run.failed' || type === 'run.cancelled';
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); return; }
    let settled = false;
    const onAbort = (): void => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true; signal?.removeEventListener('abort', onAbort); resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
