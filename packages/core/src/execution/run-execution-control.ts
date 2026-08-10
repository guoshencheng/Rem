import type { WorkerScheduler } from './local-worker-options.js';

export type InterruptReason = 'cancelled' | 'timeout';

export class RunExecutionControl {
  readonly controller = new AbortController();
  readonly interrupted: Promise<InterruptReason>;
  private resolveInterrupt!: (reason: InterruptReason) => void;
  private timeoutHandle: unknown;
  private timeoutArmed = false;
  private reason?: InterruptReason;

  constructor(scheduler: WorkerScheduler, timeoutMs: number) {
    this.interrupted = new Promise((resolve) => { this.resolveInterrupt = resolve; });
    this.timeoutArmed = true;
    this.timeoutHandle = scheduler.setTimeout(() => {
      if (!this.timeoutArmed) return;
      this.timeoutArmed = false;
      this.interrupt('timeout');
    }, timeoutMs);
  }

  cancel(): void { this.interrupt('cancelled'); }

  clear(scheduler: WorkerScheduler): void {
    if (!this.timeoutArmed) return;
    this.timeoutArmed = false;
    scheduler.clearTimeout(this.timeoutHandle);
    this.timeoutHandle = undefined;
  }

  private interrupt(reason: InterruptReason): void {
    if (this.reason !== undefined) return;
    this.reason = reason;
    this.controller.abort();
    this.resolveInterrupt(reason);
  }
}
