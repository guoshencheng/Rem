import type { RuntimeStorage } from '../src/sdk/runtime-storage.js';
import { describe, expect, it } from 'vitest';
import { createWorker, deferred, fakeStore, ManualScheduler, seedRun, successResult } from './helpers/local-worker-fixture.js';

describe('LocalRunWorker health', () => {
  it('后台 poll 保存稳定错误并调用 hook；hook 抛错不破坏链，成功后清除 health', async () => {
    const base = await fakeStore(); const scheduler = new ManualScheduler();
    const firstPoll = deferred<void>(); const secondPoll = deferred<void>();
    let fail = true; let calls = 0; const observed: string[] = [];
    const storage = wrapClaims(base, async (...args) => {
      calls += 1;
      if (fail) { firstPoll.resolve(); throw new Error('offline'); }
      const result = await base.claimWorkItem(...args); secondPoll.resolve(); return result;
    });
    const worker = createWorker(storage, { execute: async () => successResult }, {
      scheduler,
      onPollError: (error) => { observed.push(error.code); throw new Error('hook failure'); },
    });

    worker.start(); scheduler.runDelay(0); await firstPoll.promise;
    await Promise.resolve(); await Promise.resolve();
    expect(worker.health.lastPollError).toMatchObject({ code: 'STORAGE_UNAVAILABLE', retryable: true });
    expect(observed).toEqual(['STORAGE_UNAVAILABLE']);
    expect(scheduler.pendingDelays).toEqual([10]);

    fail = false; scheduler.runDelay(10); await secondPoll.promise;
    await Promise.resolve(); await Promise.resolve();
    expect(worker.health).toEqual({}); expect(calls).toBe(2);
    await worker.stop();
  });

  it('heartbeat 续租事务异常会 abort 并进入 health', async () => {
    const base = await fakeStore(); await seedRun(base);
    const scheduler = new ManualScheduler(); const entered = deferred<void>();
    const executor = deferred<typeof successResult>(); let transactions = 0; let signal: AbortSignal | undefined;
    const storage: RuntimeStorage = {
      transaction: ((operation) => {
        transactions += 1;
        if (transactions === 3) return Promise.reject(new Error('renewal unavailable'));
        return base.transaction(operation);
      }) as RuntimeStorage['transaction'],
      getSession: (id) => base.getSession(id), getRun: (id) => base.getRun(id),
      listEvents: (id, after, limit) => base.listEvents(id, after, limit), listArtifacts: (id) => base.listArtifacts(id),
      claimWorkItem: (owner, now, lease) => base.claimWorkItem(owner, now, lease),
      listRecoverableWorkItems: (now) => base.listRecoverableWorkItems(now),
    };
    const worker = createWorker(storage, { execute: async (input) => {
      signal = input.signal; entered.resolve(); return executor.promise;
    } }, { scheduler, leaseMs: 30, heartbeatMs: 10 });
    const drain = worker.drainOne(); await entered.promise;
    scheduler.runDelay(10);
    await expect(drain).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    expect(signal?.aborted).toBe(true);
    expect(worker.health.lastPollError).toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    executor.resolve(successResult); await Promise.resolve();
    expect(await base.listArtifacts('run-1')).toEqual([]);
  });

  it('非法输出后的失败事务也失败时，后台 poll 可观察存储错误', async () => {
    const base = await fakeStore(); await seedRun(base);
    const scheduler = new ManualScheduler(); const observed = deferred<string>(); let transactions = 0;
    const storage: RuntimeStorage = {
      transaction: ((operation) => {
        transactions += 1;
        if (transactions === 4) return Promise.reject(new Error('failure transaction unavailable'));
        return base.transaction(operation);
      }) as RuntimeStorage['transaction'],
      getSession: (id) => base.getSession(id), getRun: (id) => base.getRun(id),
      listEvents: (id, after, limit) => base.listEvents(id, after, limit), listArtifacts: (id) => base.listArtifacts(id),
      claimWorkItem: (owner, now, lease) => base.claimWorkItem(owner, now, lease),
      listRecoverableWorkItems: (now) => base.listRecoverableWorkItems(now),
    };
    const worker = createWorker(storage, { execute: async () => ({ sessionEntries: null, artifacts: [] }) as never }, {
      scheduler, onPollError: (error) => observed.resolve(error.code),
    });
    worker.start(); scheduler.runDelay(0);
    await expect(observed.promise).resolves.toBe('STORAGE_UNAVAILABLE');
    expect(worker.health.lastPollError).toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    expect(await base.getRun('run-1')).toMatchObject({ status: 'running' });
    await worker.stop();
  });
});

function wrapClaims(
  storage: RuntimeStorage,
  claim: RuntimeStorage['claimWorkItem'],
): RuntimeStorage {
  return {
    transaction: (operation) => storage.transaction(operation),
    getSession: (id) => storage.getSession(id), getRun: (id) => storage.getRun(id),
    listEvents: (id, after, limit) => storage.listEvents(id, after, limit),
    listArtifacts: (id) => storage.listArtifacts(id), claimWorkItem: claim,
    listRecoverableWorkItems: (now) => storage.listRecoverableWorkItems(now),
  };
}
