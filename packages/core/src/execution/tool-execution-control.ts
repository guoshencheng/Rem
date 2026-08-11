import { RuntimeError } from '../application/runtime/runtime-error.js';

export type ToolSettlement<T> =
  | { kind: 'fulfilled'; value: T }
  | { kind: 'rejected'; error: unknown }
  | { kind: 'aborted' };

export function assertToolNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RuntimeError('EXECUTION_CANCELLED', 'Tool execution cancelled');
}

export async function raceToolSettlement<T>(operation: Promise<T>, signal?: AbortSignal): Promise<ToolSettlement<T>> {
  const settlement = Promise.resolve(operation).then<ToolSettlement<T>, ToolSettlement<T>>(
    (value) => ({ kind: 'fulfilled', value }), (error: unknown) => ({ kind: 'rejected', error }),
  );
  if (!signal) return settlement;
  if (signal.aborted) return { kind: 'aborted' };
  let abort!: () => void;
  const aborted = new Promise<ToolSettlement<T>>((resolve) => {
    abort = () => resolve({ kind: 'aborted' });
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([settlement, aborted]); }
  finally { signal.removeEventListener('abort', abort); }
}
