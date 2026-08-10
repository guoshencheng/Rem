import Database from 'better-sqlite3';
import { parentPort, workerData } from 'node:worker_threads';
import { SqliteRuntimeStore } from '../../src/plugins/storage/sqlite/runtime-store.js';

interface ClaimWorkerData { dbPath: string; owner: string; gate: SharedArrayBuffer }

const { dbPath, owner, gate } = workerData as ClaimWorkerData;
const flag = new Int32Array(gate);
if (Atomics.load(flag, 0) === 0) Atomics.wait(flag, 0, 0);
const db = new Database(dbPath);
db.pragma('foreign_keys = ON'); db.pragma('journal_mode = WAL');
try {
  const claimed = await new SqliteRuntimeStore(db).claimWorkItem(owner, new Date('2026-08-10T00:00:10.000Z'), 1_000);
  parentPort?.postMessage(claimed);
} finally {
  db.close();
}
