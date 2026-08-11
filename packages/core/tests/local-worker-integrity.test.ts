import type { RuntimeStorage } from '../src/sdk/runtime-storage.js';
import { describe, expect, it } from 'vitest';
import { baseTime, createWorker, fakeStore, seedRun, successResult } from './helpers/local-worker-fixture.js';

describe('LocalRunWorker 完整性与隔离', () => {
  it('queued Run 的 Session 缺失时持久化合法 started→failed 轨迹并清 lease', async () => {
    const store = await fakeStore(); await seedRun(store, { withSession: false });
    let calls = 0;
    await createWorker(store, { execute: async () => { calls += 1; return successResult; } }).drainOne();
    expect(calls).toBe(0);
    expect(await store.getRun('run-1')).toMatchObject({
      status: 'failed', errorCode: 'INTERNAL_ERROR', startedAt: baseTime, finishedAt: baseTime,
    });
    expect((await store.listEvents('run-1')).map(({ sequence, type }) => [sequence, type])).toEqual([
      [1, 'run.created'], [2, 'run.started'], [3, 'run.failed'],
    ]);
    await store.transaction((uow) => {
      const work = uow.workItems.getByRun('run-1')!;
      expect(work.status).toBe('failed'); expect(work).not.toHaveProperty('leaseOwner');
      expect(work).not.toHaveProperty('leaseExpiresAt');
    });
  });

  it('running 恢复的 Session 损坏只补 run.failed，不重复 started', async () => {
    const store = await fakeStore();
    await seedRun(store, {
      status: 'running', workStatus: 'leased', leaseOwner: 'dead', leaseExpiresAt: new Date(0), withSession: false,
    });
    await createWorker(store, { execute: async () => successResult }).drainOne();
    expect((await store.listEvents('run-1')).map((event) => event.type)).toEqual(['run.created', 'run.failed']);
  });

  it('claimed Run 缺失时清理 work；transaction 中 work 缺失映射稳定存储错误', async () => {
    const missingRun = await fakeStore();
    await seedRun(missingRun, { withRun: false, withSession: false });
    await expect(createWorker(missingRun, { execute: async () => successResult }).drainOne()).resolves.toBe(true);
    await missingRun.transaction((uow) => expect(uow.workItems.getByRun('run-1')).toMatchObject({ status: 'failed' }));

    const base = await fakeStore(); await seedRun(base);
    const hidden = hideWorkDuringTransaction(base);
    await expect(createWorker(hidden, { execute: async () => successResult }).drainOne())
      .rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  });

  it('claim 后 lease owner 变化时不得调用 executor 或写 started', async () => {
    const base = await fakeStore(); await seedRun(base);
    let calls = 0;
    const storage: RuntimeStorage = {
      transaction: (operation) => base.transaction(operation),
      getSession: (id) => base.getSession(id), getRun: (id) => base.getRun(id),
      listEvents: (id, after, limit) => base.listEvents(id, after, limit), listArtifacts: (id) => base.listArtifacts(id),
      listRecoverableWorkItems: (now) => base.listRecoverableWorkItems(now),
      claimWorkItem: async (owner, now, lease) => {
        const claimed = await base.claimWorkItem(owner, now, lease);
        if (claimed) await base.transaction((uow) => uow.workItems.update({ ...claimed, leaseOwner: 'thief' }));
        return claimed;
      },
    };
    await expect(createWorker(storage, { execute: async () => { calls += 1; return successResult; } }).drainOne())
      .rejects.toMatchObject({ code: 'RUN_CONFLICT' });
    expect(calls).toBe(0);
    expect((await base.listEvents('run-1')).map((event) => event.type)).toEqual(['run.created']);
  });

  it('传给 executor 与写入 storage 的数据均深隔离', async () => {
    const store = await fakeStore(); await seedRun(store);
    const result = structuredClone(successResult);
    const worker = createWorker(store, { execute: async ({ run, session }) => {
      (run.trigger as { type: 'task'; input: unknown }).input = { changed: true };
      session.contexts.bindings.push({ type: 'mutated', contextId: 'x' });
      return result;
    } });
    await worker.drainOne();
    result.artifacts[0]!.data = 'changed-after-completion';
    result.sessionEntries[0]!.message.content = 'changed-after-completion';

    expect((await store.getRun('run-1'))?.trigger).toEqual({ type: 'task', input: null });
    expect((await store.getSession('session-1'))?.contexts).toEqual({ bindings: [] });
    expect((await store.listArtifacts('run-1'))[0]?.data).toBe('done');
    await store.transaction((uow) => expect(uow.sessions.listEntries('session-1')[0]?.message)
      .toMatchObject({ content: 'done' }));
  });
});

function hideWorkDuringTransaction(storage: RuntimeStorage): RuntimeStorage {
  return {
    transaction: ((operation) => storage.transaction((uow) => operation({
      ...uow, workItems: { ...uow.workItems, getByRun: () => null },
    }))) as RuntimeStorage['transaction'],
    getSession: (id) => storage.getSession(id), getRun: (id) => storage.getRun(id),
    listEvents: (id, after, limit) => storage.listEvents(id, after, limit),
    listArtifacts: (id) => storage.listArtifacts(id),
    claimWorkItem: (owner, now, lease) => storage.claimWorkItem(owner, now, lease),
    listRecoverableWorkItems: (now) => storage.listRecoverableWorkItems(now),
  };
}
