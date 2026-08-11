import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { LocalRunWorker } from '../src/execution/local-worker.js';
import { SqliteRuntimeStore } from '../src/plugins/storage/sqlite/runtime-store.js';
import { SqliteSchemaManager } from '../src/plugins/storage/sqlite/schema.js';
import { baseTime, deferred, ManualScheduler, seedRun, successResult } from './helpers/local-worker-fixture.js';

describe('LocalRunWorker SQLite 组合边界', () => {
  it('claim、连续序号与成功结果在真实事务中完整提交', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON'); new SqliteSchemaManager(db).migrate();
    const store = new SqliteRuntimeStore(db);
    try {
      await seedRun(store);
      await store.transaction((uow) => uow.sessions.appendEntries([{
        entryId: 'existing-entry', tenantId: 'tenant-1', sessionId: 'session-1', runId: 'run-1',
        sequence: 1, message: { role: 'user', content: 'before', timestamp: baseTime.getTime() }, createdAt: baseTime,
      }]));
      let id = 0;
      const worker = new LocalRunWorker(store, { execute: async () => ({
        sessionEntries: [
          { message: { role: 'user', content: 'one', timestamp: baseTime.getTime() }, metadata: { index: 1 } },
          { message: { role: 'user', content: 'two', timestamp: baseTime.getTime() }, metadata: { index: 2 } },
        ],
        artifacts: [
          { type: 'report', mediaType: 'text/plain', name: 'one', data: '1' },
          { type: 'reference', mediaType: 'text/uri-list', name: 'two', uri: 'https://example.test/2' },
        ],
      }) }, {
        owner: 'sqlite-worker', leaseMs: 1_000, pollMs: 10, runTimeoutMs: 5_000,
        now: () => baseTime, generateId: () => `sqlite-generated-${++id}`,
      });

      await expect(worker.drainOne()).resolves.toBe(true);

      expect(await store.getRun('run-1')).toMatchObject({ status: 'completed', startedAt: baseTime, finishedAt: baseTime });
      expect((await store.listEvents('run-1')).map(({ sequence, type }) => [sequence, type])).toEqual([
        [1, 'run.created'], [2, 'run.started'], [3, 'artifact.created'], [4, 'artifact.created'], [5, 'run.completed'],
      ]);
      const artifacts = await store.listArtifacts('run-1');
      expect(artifacts).toHaveLength(2);
      expect(new Set(artifacts.map((artifact) => artifact.artifactId))).toHaveLength(2);
      expect(artifacts.every((artifact) => artifact.tenantId === 'tenant-1'
        && artifact.sessionId === 'session-1' && artifact.runId === 'run-1')).toBe(true);
      await store.transaction((uow) => {
        const entries = uow.sessions.listEntries('session-1');
        expect(entries.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
        expect(new Set(entries.map((entry) => entry.entryId))).toHaveLength(3);
        expect(uow.workItems.getByRun('run-1')).toEqual(expect.objectContaining({ status: 'completed' }));
      });
    } finally { db.close(); }
  });

  it('真实 SQLite 下 stop/restart 只保留一条 poll timer 链', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON'); new SqliteSchemaManager(db).migrate();
    const store = new SqliteRuntimeStore(db); const scheduler = new ManualScheduler();
    try {
      await seedRun(store);
      const entered = deferred<void>(); const result = deferred<typeof successResult>();
      const secondClaimFinished = deferred<void>(); let claims = 0;
      const claim = store.claimWorkItem.bind(store);
      store.claimWorkItem = async (...args) => {
        claims += 1; const item = await claim(...args);
        if (claims === 2) secondClaimFinished.resolve();
        return item;
      };
      const worker = new LocalRunWorker(store, { execute: async () => {
        entered.resolve(); return result.promise;
      } }, {
        owner: 'sqlite-worker', leaseMs: 1_000, pollMs: 10, runTimeoutMs: 5_000,
        now: () => baseTime, generateId: (() => { let id = 0; return () => `restart-${++id}`; })(), scheduler,
      });
      worker.start(); scheduler.runDelay(0); await entered.promise;
      const stopping = worker.stop(); worker.start(); scheduler.runDelay(0);
      result.resolve(successResult); await stopping;
      await Promise.resolve(); await Promise.resolve();
      expect(scheduler.pendingDelays).toEqual([10]);
      scheduler.runDelay(10); await secondClaimFinished.promise;
      await Promise.resolve(); await Promise.resolve();
      expect(scheduler.pendingDelays).toEqual([10]);
      expect(claims).toBe(2);
      await worker.stop();
    } finally { db.close(); }
  });

  it('queued Run 的损坏 Session 仍持久化 started→failed 连续事件', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON'); new SqliteSchemaManager(db).migrate();
    const store = new SqliteRuntimeStore(db);
    try {
      await seedRun(store);
      db.pragma('foreign_keys = OFF');
      db.prepare("DELETE FROM runtime_sessions WHERE id='session-1'").run();
      let calls = 0; let id = 0;
      const worker = new LocalRunWorker(store, { execute: async () => { calls += 1; return successResult; } }, {
        owner: 'sqlite-worker', leaseMs: 1_000, pollMs: 10, runTimeoutMs: 5_000,
        now: () => baseTime, generateId: () => `corrupt-${++id}`,
      });
      await worker.drainOne();
      expect(calls).toBe(0);
      expect((await store.listEvents('run-1')).map(({ sequence, type }) => [sequence, type])).toEqual([
        [1, 'run.created'], [2, 'run.started'], [3, 'run.failed'],
      ]);
      expect(await store.getRun('run-1')).toMatchObject({ status: 'failed', startedAt: baseTime, finishedAt: baseTime });
    } finally { db.close(); }
  });

  it('execution timer 首次 arm 失败后 CAS 归还 claim，下一次立即以 attempt 2 执行', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON'); new SqliteSchemaManager(db).migrate();
    const store = new SqliteRuntimeStore(db); const scheduler = new FailOnceScheduler();
    try {
      await seedRun(store); let calls = 0;
      const worker = new LocalRunWorker(store, { execute: async () => { calls += 1; return successResult; } }, {
        owner: 'sqlite-worker', leaseMs: 1_000, pollMs: 10, runTimeoutMs: 5_000,
        now: () => baseTime, generateId: (() => { let id = 0; return () => `retry-${++id}`; })(), scheduler,
      });
      await expect(worker.drainOne()).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
      await store.transaction((uow) => {
        const work = uow.workItems.getByRun('run-1')!;
        expect(work).toMatchObject({ status: 'queued', attempt: 1, updatedAt: baseTime });
        expect(work.leaseOwner).toBeUndefined(); expect(work.leaseExpiresAt).toBeUndefined();
      });

      await expect(worker.drainOne()).resolves.toBe(true);
      expect(calls).toBe(1);
      await store.transaction((uow) => expect(uow.workItems.getByRun('run-1'))
        .toMatchObject({ status: 'completed', attempt: 2 }));
    } finally { db.close(); }
  });
});

class FailOnceScheduler {
  private calls = 0;
  setTimeout(): number {
    this.calls += 1;
    if (this.calls === 1) throw new Error('first timer failed');
    return this.calls;
  }
  clearTimeout(): void {}
}
