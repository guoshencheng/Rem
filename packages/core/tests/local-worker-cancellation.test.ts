import { describe, expect, it } from 'vitest';
import { createWorker, deferred, fakeStore, seedRun, successResult } from './helpers/local-worker-fixture.js';

describe('LocalRunWorker 取消', () => {
  it('queued run 直接取消、清理 lease，并保持幂等', async () => {
    const store = await fakeStore(); await seedRun(store);
    let calls = 0;
    const worker = createWorker(store, { execute: async () => { calls += 1; return successResult; } });

    await worker.cancel('run-1');
    await worker.cancel('run-1');
    expect(await worker.drainOne()).toBe(false);

    expect(calls).toBe(0);
    expect(await store.getRun('run-1')).toMatchObject({
      status: 'cancelled', errorCode: 'EXECUTION_CANCELLED', cancellationRequestedAt: expect.any(Date),
    });
    expect((await store.listEvents('run-1')).map((event) => event.type)).toEqual(['run.created', 'run.cancelled']);
    await store.transaction((uow) => expect(uow.workItems.getByRun('run-1')).toMatchObject({ status: 'failed' }));
  });

  it('活动 run 事务提交取消请求后 abort，并由同一 lease 完成 cancelled', async () => {
    const store = await fakeStore(); await seedRun(store);
    const entered = deferred<void>();
    const executor = deferred<typeof successResult>();
    let signal: AbortSignal | undefined;
    const worker = createWorker(store, { execute: async (input) => {
      signal = input.signal; entered.resolve(); return executor.promise;
    } });

    const drain = worker.drainOne();
    await entered.promise;
    await worker.cancel('run-1');
    await drain;

    expect(signal?.aborted).toBe(true);
    expect(await store.getRun('run-1')).toMatchObject({ status: 'cancelled', errorCode: 'EXECUTION_CANCELLED' });
    expect((await store.listEvents('run-1')).map((event) => event.type)).toEqual([
      'run.created', 'run.started', 'run.cancelled',
    ]);
    executor.resolve(successResult);
    await Promise.resolve();
    expect(await store.listArtifacts('run-1')).toEqual([]);
  });

  it('非本进程 running run 只记录请求，恢复 worker 后取消且不执行', async () => {
    const store = await fakeStore();
    await seedRun(store, { status: 'running', workStatus: 'leased', leaseOwner: 'dead-worker', leaseExpiresAt: new Date(0) });
    let calls = 0;
    const cancelling = createWorker(store, { execute: async () => { calls += 1; return successResult; } });
    await cancelling.cancel('run-1');
    expect(await store.getRun('run-1')).toMatchObject({ status: 'running', cancellationRequestedAt: expect.any(Date) });

    await cancelling.drainOne();
    expect(calls).toBe(0);
    expect(await store.getRun('run-1')).toMatchObject({ status: 'cancelled', errorCode: 'EXECUTION_CANCELLED' });
  });

  it('terminal run 的取消幂等，且不会影响其他 run', async () => {
    const store = await fakeStore();
    await seedRun(store, { status: 'completed', workStatus: 'completed' });
    await seedRun(store, { runId: 'run-2', sessionId: 'session-2' });
    const worker = createWorker(store, { execute: async () => successResult });

    await worker.cancel('run-1');
    expect(await store.getRun('run-1')).toMatchObject({ status: 'completed' });
    const other = await store.getRun('run-2');
    expect(other).toMatchObject({ status: 'queued' });
    expect(other).not.toHaveProperty('cancellationRequestedAt');
    expect((await store.listEvents('run-1')).map((event) => event.type)).toEqual(['run.created']);
  });
});
