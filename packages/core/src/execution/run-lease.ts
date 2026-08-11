import type { RuntimeError } from '../application/runtime/runtime-error.js';
import type { WorkItem } from '../domain/run/types.js';
import type { RuntimeStorage } from '../sdk/runtime-storage.js';
import type { ResolvedLocalRunWorkerOptions } from './local-worker-options.js';
import { RuntimeError as StableRuntimeError } from '../application/runtime/runtime-error.js';
import { readWorkerNow, storageFailure } from './local-worker-options.js';
import { latestValidDate, sameWorkLease, workLeaseConflict } from './work-lease-token.js';
import { clearWorkerTimer, scheduleWorkerTimer } from './worker-timer.js';

export class RunLease {
  private token: WorkItem;
  private timerHandle: unknown;
  private timerArmed = false;
  private stopped = false;
  private renewal?: Promise<void>;

  constructor(
    private readonly storage: RuntimeStorage,
    claimed: WorkItem,
    private readonly options: ResolvedLocalRunWorkerOptions,
    private readonly onLost: (error: RuntimeError) => void,
  ) { this.token = structuredClone(claimed); }

  current(): WorkItem { return structuredClone(this.token); }

  async renew(): Promise<void> {
    const at = readWorkerNow(this.options.now);
    const proposedExpiry = new Date(at.getTime() + this.options.leaseMs);
    if (!Number.isFinite(proposedExpiry.getTime()) || proposedExpiry.getTime() <= at.getTime()) {
      throw new StableRuntimeError('INVALID_INPUT', 'Lease renewal must produce a valid expiry');
    }
    let renewed: WorkItem | 'missing' | null;
    try {
      renewed = await this.storage.transaction((uow) => {
        const live = uow.workItems.getByRun(this.token.runId);
        if (!live) return 'missing';
        if (!sameWorkLease(live, this.token, this.options.owner)) return null;
        const next = {
          ...live,
          leaseExpiresAt: latestValidDate(live.leaseExpiresAt!, proposedExpiry),
          updatedAt: latestValidDate(live.updatedAt, at),
        };
        uow.workItems.update(next);
        return structuredClone(next);
      });
    } catch (error) { throw storageFailure(error); }
    if (renewed === 'missing') {
      throw new StableRuntimeError('STORAGE_UNAVAILABLE', 'Claimed work item is missing', true);
    }
    if (!renewed) throw workLeaseConflict();
    this.token = renewed;
  }

  start(): void {
    if (this.stopped || this.timerArmed) return;
    this._schedule();
  }

  async stop(): Promise<RuntimeError | undefined> {
    this.stopped = true;
    let clearError: RuntimeError | undefined;
    if (this.timerArmed) {
      this.timerArmed = false;
      clearError = clearWorkerTimer(this.options.scheduler, this.timerHandle);
      this.timerHandle = undefined;
    }
    await this.renewal;
    return clearError;
  }

  private _schedule(): void {
    this.timerArmed = true;
    try {
      this.timerHandle = scheduleWorkerTimer(this.options.scheduler, () => {
        if (!this.timerArmed) return;
        this.timerArmed = false;
        this.timerHandle = undefined;
        this.renewal = this._heartbeat();
      }, this.options.heartbeatMs);
    } catch (error) {
      this.timerArmed = false;
      throw error;
    }
  }

  private async _heartbeat(): Promise<void> {
    try {
      await this.renew();
      if (!this.stopped) this._schedule();
    } catch (error) {
      const stable = error instanceof StableRuntimeError ? error : storageFailure(error);
      this.stopped = true;
      this.onLost(stable);
    } finally { this.renewal = undefined; }
  }
}
