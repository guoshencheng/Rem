import type { WorkerScheduler } from './local-worker-options.js';
import type { RuntimeError } from '../application/runtime/runtime-error.js';
import { clearWorkerTimer, scheduleWorkerTimer } from './worker-timer.js';

export type InterruptReason = 'cancelled' | 'timeout' | 'lease-lost';

export class RunExecutionControl {
  readonly controller = new AbortController();
  readonly interrupted: Promise<InterruptReason>;
  private resolveInterrupt!: (reason: InterruptReason) => void;
  private timeoutHandle: unknown;
  private timeoutArmed = false;
  private reason?: InterruptReason;

  get interruptionReason(): InterruptReason | undefined { return this.reason; }

  constructor(scheduler: WorkerScheduler, timeoutMs: number) {
    this.interrupted = new Promise((resolve) => { this.resolveInterrupt = resolve; });
    this.timeoutArmed = true;
    this.timeoutHandle = scheduleWorkerTimer(scheduler, () => {
      if (!this.timeoutArmed) return;
      this.timeoutArmed = false;
      this._interrupt('timeout');
    }, timeoutMs);
  }

  cancel(): void { this._interrupt('cancelled'); }

  clear(scheduler: WorkerScheduler): RuntimeError | undefined {
    if (!this.timeoutArmed) return undefined;
    this.timeoutArmed = false;
    const error = clearWorkerTimer(scheduler, this.timeoutHandle);
    this.timeoutHandle = undefined;
    return error;
  }

  interruptLeaseLost(): void { this._interrupt('lease-lost'); }

  private _interrupt(reason: InterruptReason): void {
    if (this.reason !== undefined) return;
    this.reason = reason;
    this.controller.abort();
    this.resolveInterrupt(reason);
  }
}
