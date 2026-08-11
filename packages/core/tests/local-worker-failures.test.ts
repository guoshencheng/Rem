import type { RuntimeStorage, RuntimeUnitOfWork } from '../src/sdk/runtime-storage.js';
import { describe, expect, it } from 'vitest';
import { RuntimeError } from '../src/application/runtime/runtime-error.js';
import { createWorker, fakeStore, seedRun, successResult } from './helpers/local-worker-fixture.js';

describe('LocalRunWorker 失败完成', () => {
  it('保留 executor RuntimeError code，且事件不泄漏 cause 或 message', async () => {
    const store = await fakeStore();
    await seedRun(store);
    const secret = new Error('secret-token');
    const worker = createWorker(store, {
      execute: async () => { throw new RuntimeError('MODEL_UNAVAILABLE', 'private model failure', true, undefined, { cause: secret }); },
    });

    await worker.drainOne();

    expect(await store.getRun('run-1')).toMatchObject({ status: 'failed', errorCode: 'MODEL_UNAVAILABLE' });
    const failed = (await store.listEvents('run-1')).at(-1)!;
    expect(failed).toMatchObject({ type: 'run.failed', data: { errorCode: 'MODEL_UNAVAILABLE', retryable: true } });
    expect(JSON.stringify(failed.data)).not.toContain('secret');
    await store.transaction((uow) => {
      const work = uow.workItems.getByRun('run-1')!;
      expect(work).toMatchObject({ status: 'failed' });
      expect(work).not.toHaveProperty('leaseOwner');
      expect(work).not.toHaveProperty('leaseExpiresAt');
    });
  });

  it('未知 executor 异常映射 INTERNAL_ERROR', async () => {
    const store = await fakeStore(); await seedRun(store);
    await createWorker(store, { execute: async () => { throw new Error('sensitive'); } }).drainOne();
    expect(await store.getRun('run-1')).toMatchObject({ status: 'failed', errorCode: 'INTERNAL_ERROR' });
  });

  it('非法 JSON/message/artifact 输出回滚完成事务并稳定失败', async () => {
    for (const result of [
      { sessionEntries: [{ message: { role: 'user', content: 'x', timestamp: Number.NaN } }], artifacts: [] },
      { sessionEntries: [], artifacts: [{ type: '', mediaType: 'text/plain', name: 'x' }] },
      { sessionEntries: [], artifacts: [{ type: 'x', mediaType: 'text/plain', name: 'x', metadata: { value: BigInt(1) } }] },
    ]) {
      const store = await fakeStore(); await seedRun(store);
      await createWorker(store, { execute: async () => result as never }).drainOne();
      expect(await store.getRun('run-1')).toMatchObject({ status: 'failed', errorCode: 'INTERNAL_ERROR' });
      expect(await store.listArtifacts('run-1')).toEqual([]);
      await store.transaction((uow) => expect(uow.sessions.listEntries('session-1')).toEqual([]));
    }
  });

  it('Artifact 插入失败时成功事务整体回滚并传播稳定存储错误', async () => {
    const base = await fakeStore(); await seedRun(base);
    const storage = failArtifactWrites(base);
    await expect(createWorker(storage, { execute: async () => successResult }).drainOne())
      .rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE', retryable: true });

    expect(await base.listArtifacts('run-1')).toEqual([]);
    expect((await base.listEvents('run-1')).map((event) => event.type)).toEqual([
      'run.created', 'run.started',
    ]);
    expect(await base.getRun('run-1')).toMatchObject({ status: 'running' });
    await base.transaction((uow) => expect(uow.sessions.listEntries('session-1')).toEqual([]));
  });

  it.each(['entry', 'event'] as const)('%s 写入失败不误标 INTERNAL_ERROR', async (failure) => {
    const base = await fakeStore(); await seedRun(base);
    const storage = failCompletionWrite(base, failure);
    await expect(createWorker(storage, { execute: async () => successResult }).drainOne())
      .rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE', retryable: true });
    expect(await base.getRun('run-1')).toMatchObject({ status: 'running' });
    expect(await base.listArtifacts('run-1')).toEqual([]);
    expect((await base.listEvents('run-1')).map((event) => event.type)).toEqual(['run.created', 'run.started']);
    await base.transaction((uow) => expect(uow.sessions.listEntries('session-1')).toEqual([]));
  });
});

function failArtifactWrites(storage: RuntimeStorage): RuntimeStorage {
  return {
    transaction: ((operation: (uow: RuntimeUnitOfWork) => unknown) => storage.transaction((uow) => operation({
      ...uow, artifacts: { ...uow.artifacts, insert: () => { throw new Error('insert failure'); } },
    }))) as RuntimeStorage['transaction'],
    getSession: (id) => storage.getSession(id), getRun: (id) => storage.getRun(id),
    listEvents: (id, after, limit) => storage.listEvents(id, after, limit),
    listArtifacts: (id) => storage.listArtifacts(id),
    claimWorkItem: (owner, now, lease) => storage.claimWorkItem(owner, now, lease),
    listRecoverableWorkItems: (now) => storage.listRecoverableWorkItems(now),
  };
}

function failCompletionWrite(storage: RuntimeStorage, failure: 'entry' | 'event'): RuntimeStorage {
  return {
    transaction: ((operation: (uow: RuntimeUnitOfWork) => unknown) => storage.transaction((uow) => operation({
      ...uow,
      sessions: failure === 'entry'
        ? { ...uow.sessions, appendEntries: () => { throw new Error('entry failure'); } }
        : uow.sessions,
      events: failure === 'event'
        ? { ...uow.events, append: (event) => {
            if (event.type === 'run.completed') throw new Error('event failure');
            uow.events.append(event);
          } }
        : uow.events,
    }))) as RuntimeStorage['transaction'],
    getSession: (id) => storage.getSession(id), getRun: (id) => storage.getRun(id),
    listEvents: (id, after, limit) => storage.listEvents(id, after, limit),
    listArtifacts: (id) => storage.listArtifacts(id),
    claimWorkItem: (owner, now, lease) => storage.claimWorkItem(owner, now, lease),
    listRecoverableWorkItems: (now) => storage.listRecoverableWorkItems(now),
  };
}
