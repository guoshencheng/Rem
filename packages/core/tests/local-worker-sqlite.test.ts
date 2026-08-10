import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { LocalRunWorker } from '../src/execution/local-worker.js';
import { SqliteRuntimeStore } from '../src/plugins/storage/sqlite/runtime-store.js';
import { SqliteSchemaManager } from '../src/plugins/storage/sqlite/schema.js';
import { baseTime, seedRun } from './helpers/local-worker-fixture.js';

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
});
