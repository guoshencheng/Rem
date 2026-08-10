import { describe, expect, it, vi } from 'vitest';
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

  it('默认 Node scheduler 拒绝超出最大 timer delay，但 custom scheduler 可接管', async () => {
    const store = await fakeStore();
    const warning = vi.spyOn(process, 'emitWarning');
    const tooLarge = 2_147_483_648;
    for (const change of [{ pollMs: tooLarge }, { runTimeoutMs: tooLarge }]) {
      expect(() => new LocalRunWorker(store, { execute: async () => successResult }, {
        owner: 'worker', leaseMs: tooLarge, pollMs: 1, runTimeoutMs: 1, ...change,
      })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    }
    expect(warning).not.toHaveBeenCalled();
    warning.mockRestore();

    const scheduler = { setTimeout: () => undefined, clearTimeout: () => {} };
    expect(() => new LocalRunWorker(store, { execute: async () => successResult }, {
      owner: 'worker', leaseMs: tooLarge, pollMs: tooLarge, runTimeoutMs: tooLarge, scheduler,
    })).not.toThrow();
  });

  it.each([null, 1, 'timer', {}, { setTimeout: null, clearTimeout() {} }])(
    '非法 scheduler %# 映射 INVALID_INPUT', async (scheduler) => {
      const store = await fakeStore();
      expect(() => new LocalRunWorker(store, { execute: async () => successResult }, {
        owner: 'worker', leaseMs: 1, pollMs: 1, runTimeoutMs: 1, scheduler: scheduler as never,
      })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    },
  );

  it('拒绝 options/scheduler accessor 且不执行 getter', async () => {
    const store = await fakeStore(); let reads = 0;
    const options = { owner: 'worker', leaseMs: 1, pollMs: 1, runTimeoutMs: 1 };
    Object.defineProperty(options, 'scheduler', { enumerable: true, get: () => { reads += 1; return null; } });
    expect(() => new LocalRunWorker(store, { execute: async () => successResult }, options))
      .toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(reads).toBe(0);
  });

  it('无 work 返回 false，缺失 run 的 cancel 返回稳定错误', async () => {
    const store = await fakeStore();
    const worker = createWorker(store, { execute: async () => successResult });
    await expect(worker.drainOne()).resolves.toBe(false);
    await expect(worker.cancel('missing')).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' });
  });
});
