import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalRunWorker } from '../src/execution/local-worker.js';
import { SqliteRuntimeStore } from '../src/plugins/storage/sqlite/runtime-store.js';
import { SqliteSchemaManager } from '../src/plugins/storage/sqlite/schema.js';
import { baseTime, deferred, ManualScheduler, seedRun, successResult } from './helpers/local-worker-fixture.js';

describe('LocalRunWorker SQLite heartbeat fencing', () => {
  const paths: string[] = [];
  afterEach(() => { for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });

  it('长执行续租阻止另一 store 领取，soft expiry 未被抢时可续租后完成', async () => {
    const opened = openPair(paths); const scheduler = new ManualScheduler();
    let now = baseTime; const entered = deferred<void>(); const result = deferred<typeof successResult>();
    try {
      await seedRun(opened.storeA);
      const worker = createSqliteWorker(opened.storeA, scheduler, () => now, entered, result, 'worker-a');
      const drain = worker.drainOne(); await entered.promise;

      now = new Date(baseTime.getTime() + 30);
      scheduler.runDelay(30);
      await waitForExpiry(opened.storeA, baseTime.getTime() + 120);
      now = new Date(baseTime.getTime() + 100);
      await expect(opened.storeB.claimWorkItem('worker-b', now, 90)).resolves.toBeNull();

      // A later heartbeat can renew even after its soft expiry when no newer fencing token exists.
      now = new Date(baseTime.getTime() + 130);
      scheduler.runDelay(30);
      await waitForExpiry(opened.storeA, baseTime.getTime() + 220);
      result.resolve(successResult); await drain;
      expect(await opened.storeA.getRun('run-1')).toMatchObject({ status: 'completed' });
    } finally { opened.close(); }
  });

  it('另一 store 已抢到新 attempt 后旧 worker abort 且不能提交', async () => {
    const opened = openPair(paths); const scheduler = new ManualScheduler();
    let now = baseTime; const entered = deferred<void>(); const result = deferred<typeof successResult>();
    let signal: AbortSignal | undefined;
    try {
      await seedRun(opened.storeA);
      const worker = createSqliteWorker(opened.storeA, scheduler, () => now, entered, result, 'worker-a',
        (value) => { signal = value; });
      const drain = worker.drainOne(); await entered.promise;
      now = new Date(baseTime.getTime() + 100);
      await expect(opened.storeB.claimWorkItem('worker-b', now, 90)).resolves.toMatchObject({
        leaseOwner: 'worker-b', attempt: 2,
      });
      scheduler.runDelay(30);
      await expect(drain).rejects.toMatchObject({ code: 'RUN_CONFLICT' });
      expect(signal?.aborted).toBe(true);
      expect(await opened.storeA.listArtifacts('run-1')).toEqual([]);
      expect((await opened.storeA.listEvents('run-1')).map((event) => event.type)).toEqual(['run.created', 'run.started']);
      expect(await opened.storeA.getRun('run-1')).toMatchObject({ status: 'running' });
      result.resolve(successResult); await Promise.resolve();
      expect(await opened.storeA.listArtifacts('run-1')).toEqual([]);
    } finally { opened.close(); }
  });
});

function openPair(paths: string[]) {
  const directory = mkdtempSync(join(tmpdir(), 'rem-worker-heartbeat-')); paths.push(directory);
  const path = join(directory, 'runtime.sqlite');
  const dbA = new Database(path); dbA.pragma('foreign_keys = ON'); new SqliteSchemaManager(dbA).migrate();
  const dbB = new Database(path); dbB.pragma('foreign_keys = ON');
  return { storeA: new SqliteRuntimeStore(dbA), storeB: new SqliteRuntimeStore(dbB),
    close: () => { dbB.close(); dbA.close(); } };
}

function createSqliteWorker(
  store: SqliteRuntimeStore,
  scheduler: ManualScheduler,
  now: () => Date,
  entered: ReturnType<typeof deferred<void>>,
  result: ReturnType<typeof deferred<typeof successResult>>,
  owner: string,
  captureSignal?: (signal: AbortSignal) => void,
): LocalRunWorker {
  let id = 0;
  return new LocalRunWorker(store, { execute: async ({ signal }) => {
    captureSignal?.(signal); entered.resolve(); return result.promise;
  } }, { owner, leaseMs: 90, heartbeatMs: 30, pollMs: 10, runTimeoutMs: 1_000,
    scheduler, now, generateId: () => `${owner}-${++id}` });
}

async function waitForExpiry(store: SqliteRuntimeStore, expected: number): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    const expiry = await store.transaction((uow) => uow.workItems.getByRun('run-1')?.leaseExpiresAt?.getTime());
    if (expiry === expected) return;
    await Promise.resolve();
  }
  throw new Error(`Lease expiry did not reach ${expected}`);
}
