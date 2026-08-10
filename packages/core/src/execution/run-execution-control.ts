import type { WorkerScheduler } from './local-worker-options.js';

export type InterruptReason = 'cancelled' | 'timeout';

export class RunExecutionControl {
  readonly controller = new AbortController();
  readonly interrupted: Promise<InterruptReason>;
  private resolveInterrupt!: (reason: InterruptReason) => void;
  private timeoutHandle: unknown;
  private reason?: InterruptReason;

  constructor(scheduler: WorkerScheduler, timeoutMs: number) {
    this.interrupted = new Promise((resolve) => { this.resolveInterrupt = resolve; });
    this.timeoutHandle = scheduler.setTimeout(() => this.interrupt('timeout'), timeoutMs);
  }

  cancel(): void { this.interrupt('cancelled'); }

  clear(scheduler: WorkerScheduler): void {
    if (this.timeoutHandle === undefined) return;
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
