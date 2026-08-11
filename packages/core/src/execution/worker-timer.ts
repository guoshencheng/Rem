import type { WorkerScheduler } from './local-worker-options.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';

export function scheduleWorkerTimer(
  scheduler: WorkerScheduler,
  callback: () => void,
  delayMs: number,
): unknown {
  try { return scheduler.setTimeout(callback, delayMs); }
  catch (cause) {
    throw new RuntimeError('INTERNAL_ERROR', 'Worker timer scheduling failed', false, undefined, { cause });
  }
}

export function clearWorkerTimer(scheduler: WorkerScheduler, handle: unknown): RuntimeError | undefined {
  try { scheduler.clearTimeout(handle); return undefined; }
  catch (cause) {
    return new RuntimeError('INTERNAL_ERROR', 'Worker timer cleanup failed', false, undefined, { cause });
  }
}
