import type { WorkItem } from '../domain/run/types.js';
import type { RuntimeStorage } from '../sdk/runtime-storage.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';
import { storageFailure } from './local-worker-options.js';
import { latestValidDate, sameWorkLease, workLeaseConflict } from './work-lease-token.js';

async function releaseWorkClaim(
  storage: RuntimeStorage,
  claimed: WorkItem,
  owner: string,
  at: Date,
): Promise<void> {
  let released: true | 'missing' | null;
  try {
    released = await storage.transaction((uow) => {
      const live = uow.workItems.getByRun(claimed.runId);
      if (!live) return 'missing';
      if (!sameWorkLease(live, claimed, owner)) return null;
      const { leaseOwner: _owner, leaseExpiresAt: _expiry, ...rest } = live;
      uow.workItems.update({ ...rest, status: 'queued', updatedAt: latestValidDate(live.updatedAt, at) });
      return true;
    });
  } catch (error) { throw storageFailure(error); }
  if (released === 'missing') {
    throw new RuntimeError('STORAGE_UNAVAILABLE', 'Claimed work item is missing', true);
  }
  if (!released) throw workLeaseConflict();
}

export async function releaseWorkClaimAfterFailure(
  storage: RuntimeStorage,
  claimed: WorkItem,
  owner: string,
  at: Date,
  failure: RuntimeError,
): Promise<never> {
  try { await releaseWorkClaim(storage, claimed, owner, at); }
  catch (error) {
    const releaseFailure = error instanceof RuntimeError ? error : storageFailure(error);
    throw new RuntimeError(
      releaseFailure.code, releaseFailure.message, releaseFailure.retryable, releaseFailure.details,
      { cause: new AggregateError([releaseFailure, failure], 'Claim release failed after worker timer failure') },
    );
  }
  throw failure;
}
