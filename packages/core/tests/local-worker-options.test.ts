import { describe, expect, it } from 'vitest';
import { LocalRunWorker } from '../src/execution/local-worker.js';
import { createWorker, fakeStore, seedRun, successResult } from './helpers/local-worker-fixture.js';

describe('LocalRunWorker options', () => {
  it.each([
    { owner: '' }, { owner: '   ' }, { leaseMs: 0 }, { leaseMs: 0.5 }, { leaseMs: Number.MAX_VALUE },
    { pollMs: Number.NaN }, { pollMs: -1 }, { runTimeoutMs: Number.POSITIVE_INFINITY },
  ])('拒绝非法配置 %#', async (change) => {
    const store = await fakeStore();
    expect(() => new LocalRunWorker(store, { execute: async () => successResult }, {
      owner: 'worker', leaseMs: 1, pollMs: 1, runTimeoutMs: 1, ...change,
    })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });

  it('每次运行时拒绝无效 clock 值', async () => {
    const store = await fakeStore(); await seedRun(store);
    await expect(createWorker(store, { execute: async () => successResult }, {
      now: () => new Date(Number.NaN),
    }).drainOne()).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(await store.getRun('run-1')).toMatchObject({ status: 'queued' });
  });

  it('无 work 返回 false，缺失 run 的 cancel 返回稳定错误', async () => {
    const store = await fakeStore();
    const worker = createWorker(store, { execute: async () => successResult });
    await expect(worker.drainOne()).resolves.toBe(false);
    await expect(worker.cancel('missing')).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' });
  });
});
