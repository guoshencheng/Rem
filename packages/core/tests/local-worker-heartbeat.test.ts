import { describe, expect, it } from 'vitest';
import { baseTime, createWorker, deferred, fakeStore, ManualScheduler, seedRun, successResult } from './helpers/local-worker-fixture.js';

describe('LocalRunWorker heartbeat monotonicity', () => {
  it('Fake store 时钟回拨与前跳均保持 expiry/updatedAt 单调', async () => {
    const store = await fakeStore(); await seedRun(store);
    const scheduler = new ManualScheduler(); const entered = deferred<void>();
    const executor = deferred<typeof successResult>(); let now = baseTime;
    const worker = createWorker(store, { execute: async () => {
      entered.resolve(); return executor.promise;
    } }, { scheduler, leaseMs: 90, heartbeatMs: 30, now: () => now });
    const drain = worker.drainOne(); await entered.promise;

    now = new Date(baseTime.getTime() - 50);
    scheduler.runDelay(30);
    await waitForLease(store, baseTime.getTime() + 90, baseTime.getTime());
    now = new Date(baseTime.getTime() + 80);
    await expect(store.claimWorkItem('worker-b', now, 90)).resolves.toBeNull();

    now = new Date(baseTime.getTime() + 130);
    scheduler.runDelay(30);
    await waitForLease(store, baseTime.getTime() + 220, baseTime.getTime() + 130);
    await expect(store.claimWorkItem('worker-b', now, 90)).resolves.toBeNull();
    executor.resolve(successResult); await drain;
  });
});

async function waitForLease(
  store: Awaited<ReturnType<typeof fakeStore>>,
  expectedExpiry: number,
  expectedUpdatedAt: number,
): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    const work = await store.transaction((uow) => uow.workItems.getByRun('run-1'));
    if (work?.leaseExpiresAt?.getTime() === expectedExpiry && work.updatedAt.getTime() === expectedUpdatedAt) return;
    await Promise.resolve();
  }
  throw new Error(`Lease did not reach expiry=${expectedExpiry}, updatedAt=${expectedUpdatedAt}`);
}
