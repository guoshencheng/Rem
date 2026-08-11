import type { RuntimeError } from '../application/runtime/runtime-error.js';
import type { ResolvedLocalRunWorkerOptions } from './local-worker-options.js';
import { clearWorkerTimer, scheduleWorkerTimer } from './worker-timer.js';

export class WorkerPollLoop {
  private timerHandle: unknown;
  private timerToken?: symbol;
  private timerArmed = false;
  private generation = 0;
  private started = false;
  private lastError?: RuntimeError;

  constructor(
    private readonly options: ResolvedLocalRunWorkerOptions,
    private readonly drain: () => Promise<boolean>,
    private readonly normalizeError: (error: unknown) => RuntimeError,
  ) {}

  get health(): { lastPollError?: RuntimeError } {
    return this.lastError ? { lastPollError: this.lastError } : {};
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const generation = ++this.generation;
    try { this._schedule(0, generation); }
    catch (error) {
      this.started = false; this.generation += 1;
      throw this.normalizeError(error);
    }
  }

  stop(): RuntimeError | undefined {
    this.started = false;
    this.generation += 1;
    return this._clearTimer();
  }

  recordError(error: RuntimeError): void {
    if (this.lastError === error) return;
    this.lastError = error;
    let hookResult: void | PromiseLike<void>;
    try { hookResult = this.options.onPollError?.(error); }
    catch { return; }
    if (hookResult !== undefined) void Promise.resolve(hookResult).catch(() => {});
  }

  resetHealth(): void { this.lastError = undefined; }

  private _schedule(delayMs: number, generation: number): void {
    if (!this.started || generation !== this.generation) return;
    const token = Symbol('poll');
    this.timerToken = token;
    this.timerArmed = true;
    this.timerHandle = scheduleWorkerTimer(this.options.scheduler, () => {
      if (!this.timerArmed || this.timerToken !== token) return;
      this.timerArmed = false; this.timerToken = undefined; this.timerHandle = undefined;
      void this._poll(generation);
    }, delayMs);
  }

  private _clearTimer(): RuntimeError | undefined {
    if (!this.timerArmed) return undefined;
    this.timerArmed = false; this.timerToken = undefined;
    const error = clearWorkerTimer(this.options.scheduler, this.timerHandle);
    this.timerHandle = undefined;
    return error;
  }

  private async _poll(generation: number): Promise<void> {
    try { if (await this.drain()) this.resetHealth(); }
    catch (error) {
      const stable = this.normalizeError(error);
      if (this.lastError !== stable) this.recordError(stable);
    }
    finally {
      if (this.started && generation === this.generation) {
        try { this._schedule(this.options.pollMs, generation); }
        catch (error) {
          this.started = false; this.generation += 1;
          this.recordError(this.normalizeError(error));
        }
      }
    }
  }
}
