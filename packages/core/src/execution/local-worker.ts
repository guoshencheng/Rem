import type { RuntimeStorage } from '../sdk/runtime-storage.js';
import type { RunExecutor } from './run-executor.js';
import type { LocalRunWorkerOptions, ResolvedLocalRunWorkerOptions } from './local-worker-options.js';
import type { ExecutionOutcome } from './run-outcome-types.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';
import { RunCancellation } from './run-cancellation.js';
import { RunCompletion } from './run-completion.js';
import { RunExecutionControl } from './run-execution-control.js';
import { RunLease } from './run-lease.js';
import { readWorkerNow, resolveWorkerOptions, storageFailure } from './local-worker-options.js';
import { recoverInterruptedRuns } from './recover-runtime.js';
import { RunOutcomePersistence } from './run-outcome-persistence.js';
import { releaseWorkClaimAfterFailure } from './work-claim-release.js';
import { WorkerPollLoop } from './worker-poll-loop.js';

interface ActiveExecution { control: RunExecutionControl; lease: RunLease }
export interface LocalRunWorkerHealth { lastPollError?: RuntimeError }

export class LocalRunWorker {
  private readonly options: ResolvedLocalRunWorkerOptions;
  private readonly completion: RunCompletion;
  private readonly outcomePersistence: RunOutcomePersistence;
  private readonly cancellation: RunCancellation;
  private readonly pollLoop: WorkerPollLoop;
  private readonly active = new Map<string, ActiveExecution>();
  private readonly executorSettlements = new Set<Promise<void>>();
  private activeDrain?: Promise<boolean>;

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
    this.outcomePersistence = new RunOutcomePersistence(this.completion);
    this.cancellation = new RunCancellation(storage, this.options);
    this.pollLoop = new WorkerPollLoop(this.options, () => this.drainOne(), stableWorkerError);
  }

  drainOne(): Promise<boolean> {
    if (this.activeDrain) return this.activeDrain;
    const drain = this._performDrain();
    this.activeDrain = drain;
    void drain.finally(() => {
      if (this.activeDrain === drain) this.activeDrain = undefined;
    }).catch(() => {});
    return drain;
  }

  async cancel(runId: string): Promise<void> {
    try { await this.cancellation.request(runId); }
    catch (error) { throw storageFailure(error); }
    this.active.get(runId)?.control.cancel();
  }

  get health(): LocalRunWorkerHealth {
    return this.pollLoop.health;
  }

  resetHealth(): void { this.pollLoop.resetHealth(); }

  start(): void { this.pollLoop.start(); }

  /** 重启恢复审计；须在 start() 前完成，避免 Worker 领取到崩溃残留的执行。 */
  async recover(): Promise<void> {
    try {
      await recoverInterruptedRuns(this.storage, {
        now: this.options.now,
        generateId: this.options.generateId,
        onEventCommitted: this.options.onEventCommitted,
      });
    } catch (error) { throw storageFailure(error); }
  }

  async stop(): Promise<void> {
    const clearError = this.pollLoop.stop();
    if (clearError) this.pollLoop.recordError(clearError);
    const drain = this.activeDrain;
    let drainFailure: { error: unknown } | undefined;
    try { await drain; }
    catch (error) { drainFailure = { error }; }
    await Promise.all([...this.executorSettlements]);
    if (drainFailure) throw drainFailure.error;
    if (clearError) throw clearError;
  }

  private async _performDrain(): Promise<boolean> {
    let claimed;
    const claimAt = readWorkerNow(this.options.now);
    try {
      claimed = await this.storage.claimWorkItem(
        this.options.owner, claimAt, this.options.leaseMs,
      );
    } catch (error) { throw storageFailure(error); }
    if (!claimed) return false;

    let control: RunExecutionControl;
    try { control = new RunExecutionControl(this.options.scheduler, this.options.runTimeoutMs); }
    catch (error) {
      return releaseWorkClaimAfterFailure(
        this.storage, claimed, this.options.owner, claimAt, stableWorkerError(error),
      );
    }
    let leaseError: RuntimeError | undefined;
    const lease = new RunLease(this.storage, claimed, this.options, (error) => {
      leaseError = error; control.interruptLeaseLost(); this.pollLoop.recordError(error);
    });
    const active = { control, lease };
    this.active.set(claimed.runId, active);
    let timerError: RuntimeError | undefined;
    try {
      await lease.renew();
      const start = await this.completion.start(lease.current());
      if (start.kind === 'skip') return true;
      try { lease.start(); }
      catch (error) {
        const stable = stableWorkerError(error); control.interruptLeaseLost();
        await this.completion.fail(lease.current(), { code: stable.code, retryable: stable.retryable });
        throw stable;
      }
      let outcome: ExecutionOutcome;
      const earlyInterrupt = control.interruptionReason;
      if (earlyInterrupt) outcome = { kind: 'interrupt', reason: earlyInterrupt };
      else {
        const execution = Promise.resolve().then(() => this.executor.execute({
          run: structuredClone(start.run), session: structuredClone(start.session), signal: control.controller.signal,
        }));
        const settlement = execution.then(() => {}, () => {});
        this.executorSettlements.add(settlement);
        void settlement.finally(() => this.executorSettlements.delete(settlement));
        const outcomePromise = execution.then<ExecutionOutcome, ExecutionOutcome>(
          (result) => ({ kind: 'success', result }),
          (error: unknown) => ({ kind: 'error', error }),
        );
        const interrupt = control.interrupted.then<ExecutionOutcome>((reason) => ({ kind: 'interrupt', reason }));
        outcome = await Promise.race([outcomePromise, interrupt]);
      }
      timerError = control.clear(this.options.scheduler);
      const leaseTimerError = await lease.stop();
      timerError ??= leaseTimerError;
      if (!leaseError && !(outcome.kind === 'interrupt' && outcome.reason === 'lease-lost')) {
        try { await lease.renew(); }
        catch (error) {
          leaseError = stableWorkerError(error); control.interruptLeaseLost();
          this.pollLoop.recordError(leaseError);
        }
      }
      if (leaseError) throw leaseError;
      await this.outcomePersistence.persist(lease.current(), outcome);
      if (timerError) { this.pollLoop.recordError(timerError); throw timerError; }
      return true;
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      throw storageFailure(error);
    } finally {
      timerError ??= control.clear(this.options.scheduler);
      const leaseTimerError = await lease.stop();
      timerError ??= leaseTimerError;
      if (this.active.get(claimed.runId) === active) this.active.delete(claimed.runId);
    }
  }

}

export type { LocalRunWorkerOptions, WorkerScheduler } from './local-worker-options.js';

function stableWorkerError(error: unknown): RuntimeError {
  return error instanceof RuntimeError
    ? error
    : new RuntimeError('INTERNAL_ERROR', 'Local worker operation failed', false, undefined, { cause: error });
}
