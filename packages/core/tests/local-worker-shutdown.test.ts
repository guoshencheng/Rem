import type { RuntimeStorage } from '../src/sdk/runtime-storage.js';
import { describe, expect, it } from 'vitest';
import { createWorker, deferred, fakeStore, ManualScheduler, seedRun, successResult } from './helpers/local-worker-fixture.js';

describe('LocalRunWorker shutdown 与 scheduler 异常', () => {
  it('timeout 已持久化终态但 executor 未 settle 时 stop 保持 pending', async () => {
    const store = await fakeStore(); await seedRun(store);
    const scheduler = new ManualScheduler(); const entered = deferred<void>();
    const executor = deferred<typeof successResult>();
    const worker = createWorker(store, { execute: async () => { entered.resolve(); return executor.promise; } }, {
      scheduler, runTimeoutMs: 50,
    });
    const drain = worker.drainOne(); await entered.promise;
    scheduler.runDelay(50); await drain;
    expect(await store.getRun('run-1')).toMatchObject({ status: 'failed', errorCode: 'EXECUTION_TIMEOUT' });

    let stopped = false;
    const stopping = worker.stop().then(() => { stopped = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(stopped).toBe(false);
    executor.resolve(successResult);
    await stopping;
    expect(stopped).toBe(true);
    expect(await store.listArtifacts('run-1')).toEqual([]);
  });

  it('drain 因 lease 丢失拒绝时 stop 仍等待 executor settle', async () => {
    const store = await fakeStore(); await seedRun(store);
    const scheduler = new ManualScheduler(); const entered = deferred<void>();
    const executor = deferred<typeof successResult>();
    const worker = createWorker(store, { execute: async () => { entered.resolve(); return executor.promise; } }, {
      scheduler, leaseMs: 30, heartbeatMs: 10,
    });
    const drain = worker.drainOne(); await entered.promise;
    const stopping = worker.stop().then(
      () => ({ settled: true as const }),
      (error: unknown) => ({ settled: true as const, error }),
    );
    await store.transaction((uow) => {
      const work = uow.workItems.getByRun('run-1')!;
      uow.workItems.update({ ...work, leaseOwner: 'worker-b', attempt: work.attempt + 1 });
    });
    scheduler.runDelay(10);
    await expect(drain).rejects.toMatchObject({ code: 'RUN_CONFLICT' });
    let stopped = false;
    void stopping.then(() => { stopped = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(stopped).toBe(false);

    executor.resolve(successResult);
    const result = await stopping;
    expect(result.error).toMatchObject({ code: 'RUN_CONFLICT' });
  });

  it('execution timer setTimeout 抛错时归还 claim，允许立即重试', async () => {
    const store = await fakeStore(); await seedRun(store);
    const scheduler = new ThrowingScheduler('set-once'); let calls = 0;
    const worker = createWorker(store, { execute: async () => { calls += 1; return successResult; } }, { scheduler });
    await expect(worker.drainOne()).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(await store.getRun('run-1')).toMatchObject({ status: 'queued' });
    expect((await store.listEvents('run-1')).map((event) => event.type)).toEqual(['run.created']);
    await store.transaction((uow) => {
      const work = uow.workItems.getByRun('run-1')!;
      expect(work).toMatchObject({ status: 'queued', attempt: 1 });
      expect(work.leaseOwner).toBeUndefined(); expect(work.leaseExpiresAt).toBeUndefined();
    });
    await expect(worker.drainOne()).resolves.toBe(true);
    expect(calls).toBe(1);
    await store.transaction((uow) => expect(uow.workItems.getByRun('run-1'))
      .toMatchObject({ status: 'completed', attempt: 2 }));
  });

  it('timer arm 失败后的 claim 已被新 token 取代时不覆盖并报告冲突', async () => {
    const base = await fakeStore(); await seedRun(base);
    const storage = replaceLeaseAfterClaim(base);
    const worker = createWorker(storage, { execute: async () => successResult }, {
      scheduler: new ThrowingScheduler('set'),
    });
    await expect(worker.drainOne()).rejects.toMatchObject({ code: 'RUN_CONFLICT', retryable: true });
    await base.transaction((uow) => expect(uow.workItems.getByRun('run-1'))
      .toMatchObject({ status: 'leased', leaseOwner: 'worker-b', attempt: 2 }));
    expect((await base.listEvents('run-1')).map((event) => event.type)).toEqual(['run.created']);
  });

  it('start 调度失败可重试；clearTimeout 失败在成功持久化后暴露', async () => {
    const empty = await fakeStore(); const retryScheduler = new ThrowingScheduler('set-once');
    const polling = createWorker(empty, { execute: async () => successResult }, { scheduler: retryScheduler });
    expect(() => polling.start()).toThrow(expect.objectContaining({ code: 'INTERNAL_ERROR' }));
    expect(() => polling.start()).not.toThrow();
    await polling.stop();

    const store = await fakeStore(); await seedRun(store);
    const clearScheduler = new ThrowingScheduler('clear');
    const worker = createWorker(store, { execute: async () => successResult }, { scheduler: clearScheduler });
    await expect(worker.drainOne()).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(await store.getRun('run-1')).toMatchObject({ status: 'completed' });
  });

  it('后续 poll 调度失败后保存 health 且允许显式 restart', async () => {
    const store = await fakeStore(); const scheduler = new ThrowingScheduler('set-second');
    const observed = deferred<void>();
    const worker = createWorker(store, { execute: async () => successResult }, {
      scheduler, onPollError: () => observed.resolve(),
    });
    worker.start(); scheduler.runDelay(0);
    await observed.promise;
    expect(worker.health.lastPollError).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(() => worker.start()).not.toThrow();
    await worker.stop();
  });
});

class ThrowingScheduler {
  private setCalls = 0; private tasks = new Map<number, { callback: () => void; delayMs: number }>();
  constructor(private readonly mode: 'set' | 'set-once' | 'set-second' | 'clear') {}
  setTimeout(_callback: () => void, _delayMs: number): number {
    this.setCalls += 1;
    if (this.mode === 'set' || this.mode === 'set-once' && this.setCalls === 1
      || this.mode === 'set-second' && this.setCalls === 2) throw new Error('set failed');
    this.tasks.set(this.setCalls, { callback: _callback, delayMs: _delayMs });
    return this.setCalls;
  }
  clearTimeout(_handle: unknown): void {
    if (this.mode === 'clear') throw new Error('clear failed');
    this.tasks.delete(_handle as number);
  }
  runDelay(delayMs: number): void {
    const found = [...this.tasks].find(([, task]) => task.delayMs === delayMs);
    if (!found) throw new Error(`No timer scheduled for ${delayMs}ms`);
    this.tasks.delete(found[0]); found[1].callback();
  }
}

function replaceLeaseAfterClaim(storage: RuntimeStorage): RuntimeStorage {
  return {
    transaction: (operation) => storage.transaction(operation),
    getSession: (id) => storage.getSession(id), getRun: (id) => storage.getRun(id),
    listEvents: (id, after, limit) => storage.listEvents(id, after, limit),
    listArtifacts: (id) => storage.listArtifacts(id),
    claimWorkItem: async (owner, now, lease) => {
      const claimed = await storage.claimWorkItem(owner, now, lease);
      if (claimed) await storage.transaction((uow) => uow.workItems.update({
        ...claimed, leaseOwner: 'worker-b', attempt: claimed.attempt + 1,
      }));
      return claimed;
    },
    listRecoverableWorkItems: (now) => storage.listRecoverableWorkItems(now),
  };
}
