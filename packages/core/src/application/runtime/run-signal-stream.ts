import type { RunSignal } from '../../domain/event/types.js';
import { isTerminalRunStatus } from '../../domain/run/run-state.js';
import { isTerminalRunSignal } from '../../runtime-events/run-signal-hub.js';
import { getScopedRun } from '../runs/run-queries.js';
import type { ScopedRuntimeDeps } from './types.js';

type StreamDeps = Pick<ScopedRuntimeDeps, 'context' | 'storage' | 'signals'>;

/**
 * subscribe 的 AsyncIterable：先读持久化 Run 状态，已终态则立即结束；
 * 否则挂到 SignalHub 上转发 Signal，收到终态 Signal 后结束。
 */
export function createRunSignalStream(
  deps: StreamDeps,
  runId: string,
  signal?: AbortSignal,
): AsyncIterable<RunSignal> {
  return {
    [Symbol.asyncIterator]() {
      return iterate(deps, runId, signal);
    },
  };
}

async function* iterate(deps: StreamDeps, runId: string, signal?: AbortSignal): AsyncGenerator<RunSignal> {
  const tenantId = deps.context.tenantId;
  const run = await getScopedRun(deps.storage, tenantId, runId);
  if (isTerminalRunStatus(run.status) || signal?.aborted) return;

  const subscription = deps.signals.subscribe(runId);
  const onAbort = (): void => subscription.close();
  signal?.addEventListener('abort', onAbort);
  try {
    // 订阅与首次读取之间存在终态窗口；此时 Signal 已错过，直接结束。
    const current = await getScopedRun(deps.storage, tenantId, runId);
    if (isTerminalRunStatus(current.status)) return;
    for await (const runSignal of subscription) {
      yield runSignal;
      if (isTerminalRunSignal(runSignal.type)) return;
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    subscription.close();
  }
}
