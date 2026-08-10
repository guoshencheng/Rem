import { describe, expect, it } from 'vitest';
import { createWorker, deferred, fakeStore, ManualScheduler, seedRun, successResult } from './helpers/local-worker-fixture.js';

describe('LocalRunWorker 竞争与计时', () => {
  it('timeout 主动 abort 并完成 failed；迟到成功不再写入', async () => {
    const store = await fakeStore(); await seedRun(store);
    const scheduler = new ManualScheduler();
    const entered = deferred<void>();
    const result = deferred<typeof successResult>();
    let signal: AbortSignal | undefined;
    const worker = createWorker(store, { execute: async (input) => {
      signal = input.signal; entered.resolve(); return result.promise;
    } }, { scheduler, runTimeoutMs: 50 });

    const drain = worker.drainOne();
    await entered.promise;
    scheduler.runDelay(50);
    await drain;

    expect(signal?.aborted).toBe(true);
    expect(await store.getRun('run-1')).toMatchObject({ status: 'failed', errorCode: 'EXECUTION_TIMEOUT' });
    result.resolve(successResult);
    await Promise.resolve();
    expect(await store.listArtifacts('run-1')).toEqual([]);
    expect((await store.listEvents('run-1')).map((event) => event.type)).toEqual([
      'run.created', 'run.started', 'run.failed',
    ]);
  });

  it('两个 worker 竞争只执行一次，同实例并发 drain 不重入', async () => {
    const store = await fakeStore(); await seedRun(store);
    const entered = deferred<void>();
    const result = deferred<typeof successResult>();
    let calls = 0;
    const executor = { execute: async () => { calls += 1; entered.resolve(); return result.promise; } };
    const workerA = createWorker(store, executor, { owner: 'worker-a' });
    const workerB = createWorker(store, executor, { owner: 'worker-b' });

    const first = workerA.drainOne();
    const same = workerA.drainOne();
    const competitor = workerB.drainOne();
    await entered.promise;
    result.resolve(successResult);

    expect(await Promise.all([first, same, competitor])).toEqual([true, true, false]);
    expect(calls).toBe(1);
    expect(await store.listArtifacts('run-1')).toHaveLength(1);
  });

  it('恢复 claim 后仍 queued 的过期租约，但不重放已 running 的不确定执行', async () => {
    const queuedStore = await fakeStore();
    await seedRun(queuedStore, { workStatus: 'leased', leaseOwner: 'dead', leaseExpiresAt: new Date(0) });
    let queuedCalls = 0;
    await createWorker(queuedStore, { execute: async () => { queuedCalls += 1; return successResult; } }).drainOne();
    expect(queuedCalls).toBe(1);
    expect(await queuedStore.getRun('run-1')).toMatchObject({ status: 'completed' });

    const runningStore = await fakeStore();
    await seedRun(runningStore, { status: 'running', workStatus: 'leased', leaseOwner: 'dead', leaseExpiresAt: new Date(0) });
    let runningCalls = 0;
    await createWorker(runningStore, { execute: async () => { runningCalls += 1; return successResult; } }).drainOne();
    expect(runningCalls).toBe(0);
    expect(await runningStore.getRun('run-1')).toMatchObject({ status: 'failed', errorCode: 'INTERNAL_ERROR' });
  });

  it('lease 被新 token 取代后旧 worker 不提交迟到结果', async () => {
    const store = await fakeStore(); await seedRun(store);
    const entered = deferred<void>(); const result = deferred<typeof successResult>();
    const worker = createWorker(store, { execute: async () => { entered.resolve(); return result.promise; } });
    const drain = worker.drainOne();
    await entered.promise;
    await store.transaction((uow) => {
      const work = uow.workItems.getByRun('run-1')!;
      uow.workItems.update({ ...work, leaseOwner: 'new-owner', leaseExpiresAt: new Date(0), attempt: work.attempt + 1 });
    });
    result.resolve(successResult);
    await drain;

    expect(await store.getRun('run-1')).toMatchObject({ status: 'running' });
    expect(await store.listArtifacts('run-1')).toEqual([]);
    expect((await store.listEvents('run-1')).map((event) => event.type)).toEqual(['run.created', 'run.started']);
  });

  it('start 幂等且 poll 不重叠；stop 等待当前 drain 但不误取消', async () => {
    const store = await fakeStore(); await seedRun(store);
    const scheduler = new ManualScheduler();
    const entered = deferred<void>(); const result = deferred<typeof successResult>();
    let calls = 0; let active = 0; let maximum = 0; let signal: AbortSignal | undefined;
    const worker = createWorker(store, { execute: async (input) => {
      calls += 1; active += 1; maximum = Math.max(maximum, active); signal = input.signal;
      entered.resolve(); const value = await result.promise; active -= 1; return value;
    } }, { scheduler });

    worker.start(); worker.start();
    expect(scheduler.pending).toBe(1);
    scheduler.runDelay(0);
    await entered.promise;
    const stop = worker.stop();
    expect(signal?.aborted).toBe(false);
    expect(scheduler.pending).toBe(1);
    result.resolve(successResult);
    await stop;

    expect({ calls, maximum, aborted: signal?.aborted, pending: scheduler.pending }).toEqual({
      calls: 1, maximum: 1, aborted: false, pending: 0,
    });
    await worker.stop();
  });
});
