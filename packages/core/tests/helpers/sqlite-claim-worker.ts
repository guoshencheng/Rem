import Database from 'better-sqlite3';
import { parentPort, workerData } from 'node:worker_threads';
import { SqliteRuntimeStore } from '../../src/plugins/storage/sqlite/runtime-store.js';

interface ClaimWorkerData { dbPath: string; owner: string; gate: SharedArrayBuffer }

const { dbPath, owner, gate } = workerData as ClaimWorkerData;
const flag = new Int32Array(gate);
let db: Database.Database | undefined;
try {
  db = new Database(dbPath);
  db.pragma('foreign_keys = ON'); db.pragma('journal_mode = WAL');
  const store = new SqliteRuntimeStore(db);
  parentPort?.postMessage({ type: 'ready' });
  if (Atomics.load(flag, 0) === 0) Atomics.wait(flag, 0, 0);
  const value = await store.claimWorkItem(owner, new Date('2026-08-10T00:00:10.000Z'), 1_000);
  parentPort?.postMessage({ type: 'result', value });
} catch (error) {
  const failure = error as { name?: unknown; message?: unknown; code?: unknown };
  parentPort?.postMessage({
    type: 'error',
    error: {
      name: typeof failure.name === 'string' ? failure.name : 'Error',
      message: typeof failure.message === 'string' ? failure.message : 'Worker failed',
      code: typeof failure.code === 'string' ? failure.code : undefined,
    },
  });
} finally {
  db?.close();
}
