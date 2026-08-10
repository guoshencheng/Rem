import type { RuntimeStorage } from '../sdk/runtime-storage.js';
import type { WorkItem } from '../domain/run/types.js';
import type { RunExecutor, RunExecutionResult } from './run-executor.js';
import type { LocalRunWorkerOptions, ResolvedLocalRunWorkerOptions } from './local-worker-options.js';
import type { InterruptReason } from './run-execution-control.js';
import { RunCancellation } from './run-cancellation.js';
import { RunCompletion } from './run-completion.js';
import { RunExecutionControl } from './run-execution-control.js';
import { executionFailure, readWorkerNow, resolveWorkerOptions, storageFailure } from './local-worker-options.js';
import { validateRunOutput } from './run-output-validation.js';

type ExecutionOutcome =
  | { kind: 'success'; result: RunExecutionResult }
  | { kind: 'error'; error: unknown }
  | { kind: 'interrupt'; reason: InterruptReason };

export class LocalRunWorker {
  private readonly options: ResolvedLocalRunWorkerOptions;
  private readonly completion: RunCompletion;
  private readonly cancellation: RunCancellation;
  private readonly active = new Map<string, RunExecutionControl>();
  private activeDrain?: Promise<boolean>;
  private pollHandle?: unknown;
  private started = false;

  constructor(
    private readonly storage: RuntimeStorage,
    private readonly executor: RunExecutor,
    options: LocalRunWorkerOptions,
  ) {
    this.options = resolveWorkerOptions(options);
    if (!storage || typeof storage.claimWorkItem !== 'function' || typeof storage.transaction !== 'function') {
      throw storageFailure(new TypeError('A RuntimeStorage is required'));
    }
    if (!executor || typeof executor.execute !== 'function') {
      throw new TypeError('A RunExecutor is required');
    }
    this.completion = new RunCompletion(storage, this.options);
    this.cancellation = new RunCancellation(storage, this.options);
  }

  drainOne(): Promise<boolean> {
    if (this.activeDrain) return this.activeDrain;
    const drain = this.performDrain();
    this.activeDrain = drain;
    void drain.finally(() => {
      if (this.activeDrain === drain) this.activeDrain = undefined;
    }).catch(() => {});
    return drain;
  }

  async cancel(runId: string): Promise<void> {
    try { await this.cancellation.request(runId); }
    catch (error) { throw storageFailure(error); }
    this.active.get(runId)?.cancel();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.schedulePoll(0);
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.pollHandle !== undefined) {
      this.options.scheduler.clearTimeout(this.pollHandle);
      this.pollHandle = undefined;
    }
    await this.activeDrain;
  }

  private async performDrain(): Promise<boolean> {
    let claimed;
    try {
      claimed = await this.storage.claimWorkItem(
        this.options.owner, readWorkerNow(this.options.now), this.options.leaseMs,
      );
    } catch (error) { throw storageFailure(error); }
    if (!claimed) return false;

    let start;
    try { start = await this.completion.start(claimed); }
    catch (error) { throw storageFailure(error); }
    if (start.kind === 'skip') return true;

    const control = new RunExecutionControl(this.options.scheduler, this.options.runTimeoutMs);
    this.active.set(claimed.runId, control);
    try {
      const execution = Promise.resolve().then(() => this.executor.execute({
        run: structuredClone(start.run), session: structuredClone(start.session), signal: control.controller.signal,
      })).then<ExecutionOutcome, ExecutionOutcome>(
        (result) => ({ kind: 'success', result }),
        (error: unknown) => ({ kind: 'error', error }),
      );
      const interrupt = control.interrupted.then<ExecutionOutcome>((reason) => ({ kind: 'interrupt', reason }));
      const outcome = await Promise.race([execution, interrupt]);
      control.clear(this.options.scheduler);
      await this.persistOutcome(claimed, outcome);
      return true;
    } finally {
      control.clear(this.options.scheduler);
      if (this.active.get(claimed.runId) === control) this.active.delete(claimed.runId);
    }
  }

  private async persistOutcome(claimed: WorkItem, outcome: ExecutionOutcome): Promise<void> {
    if (outcome.kind === 'success') {
      try {
        const output = validateRunOutput(outcome.result);
        await this.completion.succeed(claimed, output);
        return;
      } catch (error) {
        try { await this.completion.fail(claimed, { code: 'INTERNAL_ERROR', retryable: false }); }
        catch (failureError) { throw storageFailure(failureError); }
        return;
      }
    }
    const executorFailure = outcome.kind === 'error' ? executionFailure(outcome.error) : undefined;
    const failure = outcome.kind === 'interrupt'
      ? { code: outcome.reason === 'timeout' ? 'EXECUTION_TIMEOUT' as const : 'EXECUTION_CANCELLED' as const,
          retryable: false, cancelled: outcome.reason === 'cancelled' }
      : { ...executorFailure!, cancelled: executorFailure!.code === 'EXECUTION_CANCELLED' };
    try { await this.completion.fail(claimed, failure); }
    catch (error) { throw storageFailure(error); }
  }

  private schedulePoll(delayMs: number): void {
    this.pollHandle = this.options.scheduler.setTimeout(() => {
      this.pollHandle = undefined;
      void this.poll();
    }, delayMs);
  }

  private async poll(): Promise<void> {
    try { await this.drainOne(); }
    catch { /* Polling continues; explicit drainOne still exposes stable storage failures. */ }
    finally { if (this.started) this.schedulePoll(this.options.pollMs); }
  }
}

export type { LocalRunWorkerOptions, WorkerScheduler } from './local-worker-options.js';
