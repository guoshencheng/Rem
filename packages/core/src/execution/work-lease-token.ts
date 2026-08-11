import type { WorkItem } from '../domain/run/types.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';

export function sameWorkLease(live: WorkItem, token: WorkItem, owner: string): boolean {
  const liveExpiry = live.leaseExpiresAt?.getTime();
  const tokenExpiry = token.leaseExpiresAt?.getTime();
  return live.workItemId === token.workItemId && live.runId === token.runId
    && live.status === 'leased' && live.leaseOwner === owner && live.attempt === token.attempt
    && Number.isFinite(liveExpiry) && liveExpiry === tokenExpiry;
}

export function latestValidDate(current: Date, candidate: Date): Date {
  const currentTime = current.getTime(); const candidateTime = candidate.getTime();
  if (!Number.isFinite(currentTime) || !Number.isFinite(candidateTime)) {
    throw new RuntimeError('STORAGE_UNAVAILABLE', 'Persisted work item contains an invalid timestamp', true);
  }
  return new Date(Math.max(currentTime, candidateTime));
}

export const workLeaseConflict = (): RuntimeError =>
  new RuntimeError('RUN_CONFLICT', 'Execution lease was lost', true);
