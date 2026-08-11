import type { RuntimeStorage } from '../src/sdk/runtime-storage.js';
import { describe, expect, it } from 'vitest';
import { createWorker, deferred, fakeStore, ManualScheduler, seedRun, successResult } from './helpers/local-worker-fixture.js';

describe('LocalRunWorker health', () => {
  it('后台 poll 保存稳定错误并调用 hook；hook 抛错不破坏链，成功后清除 health', async () => {
    const base = await fakeStore(); const scheduler = new ManualScheduler();
    const firstPoll = deferred<void>(); const secondPoll = deferred<void>(); const thirdPoll = deferred<void>();
    let fail = true; let calls = 0; const observed: string[] = [];
    const storage = wrapClaims(base, async (...args) => {
      calls += 1;
      if (fail) { firstPoll.resolve(); throw new Error('offline'); }
      const result = await base.claimWorkItem(...args);
      if (calls === 2) secondPoll.resolve(); else thirdPoll.resolve();
      return result;
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
    expect(worker.health.lastPollError).toMatchObject({ code: 'STORAGE_UNAVAILABLE' });

    await seedRun(base); scheduler.runDelay(10); await thirdPoll.promise;
    await waitForRunStatus(base, 'completed');
    await waitForHealthClear(worker);
    expect(worker.health).toEqual({}); expect(calls).toBe(3);
    await worker.stop();
  });

  it.each([
    ['rejected Promise', () => Promise.reject(new Error('async hook failure'))],
    ['rejecting thenable', () => ({ then: (_resolve: (value: void) => void, reject: (error: unknown) => void) => {
      reject(new Error('thenable hook failure'));
    } }) as unknown as PromiseLike<void>],
  ])('%s hook rejection 被消费且不破坏 poll 链', async (_name, createResult) => {
    const base = await fakeStore(); const scheduler = new ManualScheduler(); const first = deferred<void>();
    const second = deferred<void>(); let calls = 0; let hooks = 0;
    const storage = wrapClaims(base, async (...args) => {
      calls += 1;
      if (calls === 1) { first.resolve(); throw new Error('offline'); }
      const result = await base.claimWorkItem(...args); second.resolve(); return result;
    });
    const worker = createWorker(storage, { execute: async () => successResult }, {
      scheduler, onPollError: () => { hooks += 1; return createResult(); },
    });
    worker.start(); scheduler.runDelay(0); await first.promise;
    await waitForDelay(scheduler, 10);
    scheduler.runDelay(10); await second.promise;
    await Promise.resolve(); await Promise.resolve();
    expect(hooks).toBe(1); expect(calls).toBe(2);
    expect(worker.health.lastPollError).toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    worker.resetHealth(); expect(worker.health).toEqual({});
    await worker.stop();
  });

  it('heartbeat 续租事务异常只通知一次 hook，并 abort 与进入 health', async () => {
    const base = await fakeStore(); await seedRun(base);
    const scheduler = new ManualScheduler(); const entered = deferred<void>();
    const executor = deferred<typeof successResult>(); const observed = deferred<void>();
    let transactions = 0; let signal: AbortSignal | undefined; let notifications = 0;
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
    } }, { scheduler, leaseMs: 30, heartbeatMs: 10,
      onPollError: () => { notifications += 1; observed.resolve(); } });
    worker.start(); scheduler.runDelay(0); await entered.promise;
    scheduler.runDelay(10);
    await observed.promise; await waitForDelay(scheduler, 10);
    expect(signal?.aborted).toBe(true);
    expect(worker.health.lastPollError).toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    expect(notifications).toBe(1);
    executor.resolve(successResult); await worker.stop();
    expect(await base.listArtifacts('run-1')).toEqual([]);
  });

  it('claim 归还事务失败优先报告存储错误，后续空 poll 不清 health', async () => {
    const base = await fakeStore(); await seedRun(base);
    const scheduler = new FailExecutionTimerScheduler(); const observed = deferred<void>();
    const secondClaim = deferred<void>(); let claims = 0;
    const storage: RuntimeStorage = {
      transaction: () => Promise.reject(new Error('release unavailable')),
      getSession: (id) => base.getSession(id), getRun: (id) => base.getRun(id),
      listEvents: (id, after, limit) => base.listEvents(id, after, limit), listArtifacts: (id) => base.listArtifacts(id),
      claimWorkItem: async (owner, now, lease) => {
        claims += 1; const claimed = await base.claimWorkItem(owner, now, lease);
        if (claims === 2) secondClaim.resolve(); return claimed;
      },
      listRecoverableWorkItems: (now) => base.listRecoverableWorkItems(now),
    };
    const worker = createWorker(storage, { execute: async () => successResult }, {
      scheduler, onPollError: () => observed.resolve(),
    });
    worker.start(); scheduler.runDelay(0); await observed.promise;
    expect(worker.health.lastPollError).toMatchObject({ code: 'STORAGE_UNAVAILABLE', retryable: true });
    await base.transaction((uow) => expect(uow.workItems.getByRun('run-1'))
      .toMatchObject({ status: 'leased', attempt: 1 }));

    scheduler.runDelay(10); await secondClaim.promise;
    await Promise.resolve(); await Promise.resolve();
    expect(worker.health.lastPollError).toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    await worker.stop();
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

async function waitForDelay(scheduler: ManualScheduler, delayMs: number): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (scheduler.pendingDelays.includes(delayMs)) return;
    await Promise.resolve();
  }
  throw new Error(`Timer ${delayMs} was not scheduled`);
}

async function waitForRunStatus(storage: RuntimeStorage, status: string): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if ((await storage.getRun('run-1'))?.status === status) return;
    await Promise.resolve();
  }
  throw new Error(`Run did not reach ${status}`);
}

async function waitForHealthClear(worker: ReturnType<typeof createWorker>): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (worker.health.lastPollError === undefined) return;
    await Promise.resolve();
  }
  throw new Error('Worker health did not recover');
}

class FailExecutionTimerScheduler extends ManualScheduler {
  private calls = 0;
  override setTimeout(callback: () => void, delayMs: number): number {
    this.calls += 1;
    if (this.calls === 2) throw new Error('execution timer failed');
    return super.setTimeout(callback, delayMs);
  }
}
