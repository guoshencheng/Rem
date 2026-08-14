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

  it('使用 ExecutionPlanSnapshot 的 timeoutMs 覆盖 Worker 默认上限', async () => {
    const store = await fakeStore(); await seedRun(store);
    await store.transaction((uow) => {
      const run = uow.runs.get('run-1')!;
      uow.runs.update({ ...run, executionType: 'single-agent', executionPlanSnapshot: {
        executionType: 'single-agent', participants: [{ agentId: 'agent-1', revision: '1', role: 'root' }],
        participantSnapshots: [{ agentId: 'agent-1', revision: '1', role: 'root', name: 'Agent', instructions: '', modelId: 'mock', toolNames: [], acceptedTriggers: ['task'] }],
        modelId: 'mock', instructions: '', toolNames: [], limits: {
          maxAgentRuns: 20, maxMessages: 50, maxDepth: 8, timeoutMs: 50, maxTokens: 200_000, maxParallelAgents: 4,
        }, hash: 'a'.repeat(64),
      } });
    });
    const scheduler = new ManualScheduler();
    const entered = deferred<void>(); const result = deferred<typeof successResult>();
    const worker = createWorker(store, { execute: async () => { entered.resolve(); return result.promise; } }, { scheduler, runTimeoutMs: 5_000 });
    const drain = worker.drainOne(); await entered.promise;
    expect(scheduler.pendingDelays).toContain(50);
    scheduler.runDelay(50); await drain;
    expect(await store.getRun('run-1')).toMatchObject({ status: 'failed', errorCode: 'EXECUTION_TIMEOUT' });
    result.resolve(successResult);
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
    await expect(drain).rejects.toMatchObject({ code: 'RUN_CONFLICT', retryable: true });

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
    expect(scheduler.pending).toBe(2);
    result.resolve(successResult);
    await stop;

    expect({ calls, maximum, aborted: signal?.aborted, pending: scheduler.pending }).toEqual({
      calls: 1, maximum: 1, aborted: false, pending: 0,
    });
    await worker.stop();
  });

  it('stop 等待期间允许 restart，旧 generation 不得形成第二条 poll 链', async () => {
    const store = await fakeStore(); await seedRun(store);
    const scheduler = new ManualScheduler();
    const entered = deferred<void>(); const result = deferred<typeof successResult>();
    const secondClaimFinished = deferred<void>();
    let claims = 0;
    const counted = {
      ...store,
      transaction: store.transaction.bind(store), getSession: store.getSession.bind(store),
      getRun: store.getRun.bind(store), listEvents: store.listEvents.bind(store),
      listArtifacts: store.listArtifacts.bind(store), listRecoverableWorkItems: store.listRecoverableWorkItems.bind(store),
      claimWorkItem: async (...args: Parameters<typeof store.claimWorkItem>) => {
        claims += 1; const claimed = await store.claimWorkItem(...args);
        if (claims === 2) secondClaimFinished.resolve();
        return claimed;
      },
    };
    const worker = createWorker(counted, { execute: async () => { entered.resolve(); return result.promise; } }, { scheduler });
    worker.start(); scheduler.runDelay(0); await entered.promise;

    const stopping = worker.stop();
    worker.start(); scheduler.runDelay(0);
    result.resolve(successResult);
    await stopping;
    await Promise.resolve(); await Promise.resolve();

    expect(scheduler.pendingDelays).toEqual([10]);
    scheduler.runDelay(10);
    await secondClaimFinished.promise; await Promise.resolve(); await Promise.resolve();
    expect(scheduler.pendingDelays).toEqual([10]);
    expect(claims).toBe(2);
    await worker.stop();
  });

  it.each(['success', 'failure', 'cancel'] as const)(
    'timeout handle 为 undefined 时 %s 仍恰好 clear 一次', async (mode) => {
      const store = await fakeStore(); await seedRun(store);
      const scheduler = new UndefinedHandleScheduler();
      const entered = deferred<void>(); const result = deferred<typeof successResult>();
      const worker = createWorker(store, { execute: async () => {
        entered.resolve();
        if (mode === 'success') return successResult;
        if (mode === 'failure') throw new Error('failure');
        return result.promise;
      } }, { scheduler });
      const drain = worker.drainOne(); await entered.promise;
      if (mode === 'cancel') await worker.cancel('run-1');
      await drain;
      expect(scheduler.clearCalls).toBe(2);
    },
  );

  it('timeout 已触发时不再 clear 已消费的 undefined handle', async () => {
    const store = await fakeStore(); await seedRun(store);
    const scheduler = new UndefinedHandleScheduler(); const result = deferred<typeof successResult>();
    const entered = deferred<void>();
    const worker = createWorker(store, { execute: async () => { entered.resolve(); return result.promise; } }, { scheduler, runTimeoutMs: 50 });
    const drain = worker.drainOne();
    await entered.promise;
    scheduler.fire(50); await drain;
    expect(scheduler.clearCalls).toBe(1);
  });

  it('poll handle 为 undefined 时 stop 仍恰好 clear 一次且失效 callback 不 claim', async () => {
    const store = await fakeStore(); const scheduler = new UndefinedHandleScheduler(); let claims = 0;
    const counted = {
      ...store,
      transaction: store.transaction.bind(store), getSession: store.getSession.bind(store),
      getRun: store.getRun.bind(store), listEvents: store.listEvents.bind(store),
      listArtifacts: store.listArtifacts.bind(store), listRecoverableWorkItems: store.listRecoverableWorkItems.bind(store),
      claimWorkItem: (...args: Parameters<typeof store.claimWorkItem>) => {
        claims += 1; return store.claimWorkItem(...args);
      },
    };
    const worker = createWorker(counted, { execute: async () => successResult }, { scheduler });
    worker.start(); await worker.stop();
    expect(scheduler.clearCalls).toBe(1);
    scheduler.fire(0); await Promise.resolve();
    expect(claims).toBe(0);
  });
});

class UndefinedHandleScheduler {
  private tasks: Array<{ callback: () => void; delayMs: number }> = [];
  clearCalls = 0;
  setTimeout(callback: () => void, delayMs: number): undefined {
    this.tasks.push({ callback, delayMs }); return undefined;
  }
  clearTimeout(_handle: unknown): void { this.clearCalls += 1; }
  fire(delayMs: number): void {
    const index = this.tasks.findIndex((task) => task.delayMs === delayMs);
    if (index < 0) throw new Error(`No timer for ${delayMs}`);
    this.tasks.splice(index, 1)[0]!.callback();
  }
}
