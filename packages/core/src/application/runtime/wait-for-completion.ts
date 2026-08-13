import type { RunSignal } from '../../domain/event/types.js';
import type { AgentRun } from '../../domain/run/types.js';
import { isTerminalRunStatus } from '../../domain/run/run-state.js';
import { getScopedRun } from '../runs/run-queries.js';
import type { ScopedRuntimeDeps } from './types.js';

type WaitDeps = Pick<ScopedRuntimeDeps, 'context' | 'storage' | 'signals' | 'waitPollMs'>;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 不依赖 Signal 送达：每次收到 Signal 后重读持久化 Run，并以短轮询兜底。
 */
export async function waitForRunCompletion(
  deps: WaitDeps,
  runId: string,
  signal?: AbortSignal,
): Promise<AgentRun> {
  signal?.throwIfAborted();
  const subscription = deps.signals.subscribe(runId);
  const iterator = subscription[Symbol.asyncIterator]();
  let pending: Promise<IteratorResult<RunSignal>> | undefined;
  try {
    for (;;) {
      const run = await getScopedRun(deps.storage, deps.context.tenantId, runId);
      if (isTerminalRunStatus(run.status)) return run;
      signal?.throwIfAborted();
      pending ??= iterator.next();
      const outcome = await Promise.race([
        pending.then((result) => ({ kind: 'signal' as const, result })),
        sleep(deps.waitPollMs).then(() => ({ kind: 'tick' as const })),
      ]);
      if (outcome.kind === 'signal') pending = undefined;
    }
  } finally {
    // 先 close() 再 return()：此时可能还有 in-flight 的 pending = iterator.next()，
    // 生成器停在 hub 的 waiter 上；close() 会 resolve waiter 让生成器恢复并自然结束，
    // 否则排队的 return() 永远无法被处理（死锁）。close 后 parked next() 以 done 兑现，不产生 rejection。
    subscription.close();
    await iterator.return?.();
  }
}
