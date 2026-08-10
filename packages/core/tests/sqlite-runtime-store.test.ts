import type { WorkItem } from '../src/domain/run/types.js';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { RuntimeError } from '../src/application/runtime/runtime-error.js';
import { SqliteStorageProvider } from '../src/plugins/storage/sqlite/provider.js';
import { SqliteRuntimeStore } from '../src/plugins/storage/sqlite/runtime-store.js';
import { CURRENT_SCHEMA_VERSION, SqliteSchemaManager } from '../src/plugins/storage/sqlite/schema.js';
import { runtimeStorageContract } from './runtime-storage-contract.js';

const RUNTIME_TABLES = [
  'runtime_sessions', 'runtime_runs', 'runtime_events', 'runtime_work_items',
  'runtime_session_entries', 'runtime_artifacts', 'runtime_idempotency',
  'runtime_tool_invocations',
] as const;

const at = (second: number) => new Date(`2026-08-10T00:00:${String(second).padStart(2, '0')}.000Z`);
const tsxLoader = createRequire(import.meta.url).resolve('tsx');

type ClaimWorkerMessage =
  | { type: 'ready' }
  | { type: 'result'; value: WorkItem | null }
  | { type: 'error'; error: { name: string; message: string; code?: string } };

function createClaimWorker(dbPath: string, owner: string, gate: SharedArrayBuffer) {
  const worker = new Worker(new URL('./helpers/sqlite-claim-worker.ts', import.meta.url), {
    workerData: { dbPath, owner, gate },
    execArgv: ['--import', tsxLoader],
  });
  let readyResolve!: () => void; let readyReject!: (error: Error) => void;
  let resultResolve!: (value: WorkItem | null) => void; let resultReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const result = new Promise<WorkItem | null>((resolve, reject) => { resultResolve = resolve; resultReject = reject; });
  void result.catch(() => {});
  const fail = (error: Error) => { readyReject(error); resultReject(error); };
  worker.on('message', (message: ClaimWorkerMessage) => {
    if (message.type === 'ready') readyResolve();
    if (message.type === 'result') resultResolve(message.value);
    if (message.type === 'error') fail(new Error(`${message.error.name}${message.error.code ? ` [${message.error.code}]` : ''}: ${message.error.message}`));
  });
  worker.once('error', fail);
  worker.once('exit', (code) => { if (code !== 0) fail(new Error(`Claim worker exited with code ${code}`)); });
  return { ready, result, terminate: () => worker.terminate() };
}

function openMemoryStore() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  new SqliteSchemaManager(db).migrate();
  return { store: new SqliteRuntimeStore(db), close: async () => db.close() };
}

runtimeStorageContract(async () => openMemoryStore());

describe('SqliteRuntimeStore', () => {
  const paths: string[] = [];
  afterEach(() => { for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });

  it('fresh schema 为 v12，重复迁移保留数据，v11 升级只新增 runtime 表', () => {
    const fresh = new Database(':memory:');
    const manager = new SqliteSchemaManager(fresh);
    manager.migrate();
    expect((fresh.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(12);
    const tables = () => (fresh.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(({ name }) => name);
    for (const table of RUNTIME_TABLES) expect(tables()).toContain(table);
    fresh.prepare("INSERT INTO runtime_sessions VALUES ('s', 't', '{}', ?, ?)").run(at(1).toISOString(), at(1).toISOString());
    manager.migrate();
    expect(fresh.prepare('SELECT id FROM runtime_sessions').get()).toEqual({ id: 's' });
    fresh.close();

    const legacy = new Database(':memory:');
    legacy.exec("CREATE TABLE schema_version(version INTEGER PRIMARY KEY); INSERT INTO schema_version VALUES(11); CREATE TABLE workspaces(path TEXT PRIMARY KEY, created_at INTEGER NOT NULL); INSERT INTO workspaces VALUES('/kept', 1)");
    new SqliteSchemaManager(legacy).migrate();
    expect(legacy.prepare('SELECT * FROM workspaces').get()).toEqual({ path: '/kept', created_at: 1 });
    expect((legacy.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(CURRENT_SCHEMA_VERSION);
    for (const table of RUNTIME_TABLES) expect((legacy.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))).toBeTruthy();
    legacy.close();
  });

  it('完整 optional 字段、Date、嵌套 JSON 与 pi Message 往返', async () => {
    const { store, close } = openMemoryStore();
    await store.transaction((uow) => {
      uow.sessions.insert({ sessionId: 's', tenantId: 't', contexts: { bindings: [{ type: 'account', contextId: 'a' }] }, createdAt: at(1), updatedAt: at(2) });
      uow.runs.insert({ runId: 'r', tenantId: 't', principalId: 'p', sessionId: 's', agentId: 'a', agentRevision: '2', status: 'waiting', trigger: { type: 'task', input: { nested: [1] } }, contextSnapshot: { items: [], configLayers: [], promptSections: [] }, waitingReason: 'recovery', errorCode: 'E', cancellationRequestedAt: at(3), createdAt: at(1), startedAt: at(2), finishedAt: at(4), updatedAt: at(4) });
      uow.sessions.appendEntries([{ entryId: 'e', tenantId: 't', sessionId: 's', runId: 'r', sequence: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] } as never, metadata: { nested: { ok: true } }, createdAt: at(3) }]);
      uow.toolInvocations.insert({ invocationId: 'i', tenantId: 't', sessionId: 's', runId: 'r', toolCallId: 'c', toolName: 'tool', status: 'failed', sideEffect: 'non-idempotent', supportsIdempotencyKey: false, input: { nested: 1 }, result: { partial: true }, error: 'boom', createdAt: at(2), updatedAt: at(4) });
    });
    expect(await store.getRun('r')).toMatchObject({ waitingReason: 'recovery', errorCode: 'E', cancellationRequestedAt: at(3), startedAt: at(2), finishedAt: at(4), trigger: { input: { nested: [1] } } });
    await store.transaction((uow) => {
      expect(uow.sessions.listEntries('s')[0]).toMatchObject({ metadata: { nested: { ok: true } }, createdAt: at(3) });
      expect(uow.toolInvocations.get('i')).toMatchObject({ result: { partial: true }, error: 'boom', updatedAt: at(4) });
    });
    await close();
  });

  it.each([
    ['contexts_json', '{broken'],
    ['created_at', 'not-a-date'],
  ])('损坏的 %s 稳定映射为 STORAGE_UNAVAILABLE 并保留 cause', async (column, value) => {
    const db = new Database(':memory:');
    new SqliteSchemaManager(db).migrate();
    db.prepare("INSERT INTO runtime_sessions VALUES ('s', 't', '{}', ?, ?)").run(at(1).toISOString(), at(1).toISOString());
    db.prepare(`UPDATE runtime_sessions SET ${column} = ? WHERE id = 's'`).run(value);
    const error = await new SqliteRuntimeStore(db).getSession('s').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RuntimeError);
    expect(error).toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    expect((error as RuntimeError).cause).toBeDefined();
    db.close();
  });

  it.each([
    ['getSession', (store: SqliteRuntimeStore) => store.getSession('s')],
    ['transaction', (store: SqliteRuntimeStore) => store.transaction(() => undefined)],
    ['claimWorkItem', (store: SqliteRuntimeStore) => store.claimWorkItem('owner', at(10), 1_000)],
  ])('连接关闭后 %s 统一返回 STORAGE_UNAVAILABLE 并保留 cause', async (_name, action) => {
    const db = new Database(':memory:');
    new SqliteSchemaManager(db).migrate();
    const store = new SqliteRuntimeStore(db);
    db.close();
    const error = await action(store).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RuntimeError);
    expect(error).toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    expect((error as RuntimeError).cause).toBeInstanceOf(Error);
  });

  it('transaction 原样传播调用方 RuntimeError', async () => {
    const { store, close } = openMemoryStore();
    const expected = new RuntimeError('INVALID_INPUT', 'caller validation');
    const error = await store.transaction(() => { throw expected; }).catch((caught: unknown) => caught);
    expect(error).toBe(expected);
    await close();
  });

  it('两个独立连接同时领取时仅一个成功且不泄漏 SQLITE_BUSY', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rem-runtime-race-')); paths.push(dir);
    const dbPath = join(dir, 'runtime.db');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
    new SqliteSchemaManager(db).migrate();
    const store = new SqliteRuntimeStore(db);
    await store.transaction((uow) => {
      uow.sessions.insert({ sessionId: 's', tenantId: 't', contexts: { bindings: [] }, createdAt: at(1), updatedAt: at(1) });
      uow.runs.insert({ runId: 'r', tenantId: 't', principalId: 'p', sessionId: 's', agentId: 'a', agentRevision: '1', status: 'queued', trigger: { type: 'task', input: null }, contextSnapshot: { items: [], configLayers: [], promptSections: [] }, createdAt: at(1), updatedAt: at(1) });
      uow.workItems.insert({ workItemId: 'w', runId: 'r', status: 'queued', attempt: 0, createdAt: at(1), updatedAt: at(1) });
    });
    db.close();
    const gate = new SharedArrayBuffer(4); const flag = new Int32Array(gate);
    const workers = [createClaimWorker(dbPath, 'one', gate), createClaimWorker(dbPath, 'two', gate)];
    let results: Array<WorkItem | null> = [];
    try {
      await Promise.all(workers.map(({ ready }) => ready));
      Atomics.store(flag, 0, 1); Atomics.notify(flag, 0, workers.length);
      results = await Promise.all(workers.map(({ result }) => result));
    } finally {
      await Promise.all(workers.map(({ terminate }) => terminate()));
    }
    expect(results).toHaveLength(2);
    const winners = results.filter((value): value is WorkItem => value !== null);
    expect(winners).toHaveLength(1);
    expect(results.filter((value) => value === null)).toHaveLength(1);
    expect(winners[0]).toMatchObject({ attempt: 1, leaseOwner: expect.stringMatching(/^(one|two)$/) });
    const verify = new Database(dbPath);
    expect(verify.prepare('SELECT attempt, lease_owner FROM runtime_work_items WHERE id=?').get('w')).toEqual({ attempt: 1, lease_owner: winners[0].leaseOwner });
    verify.close();
  });

  it('Provider 的 runtimeStore 随 open/close/init 生命周期变化', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rem-runtime-provider-')); paths.push(dir);
    const provider = new SqliteStorageProvider({ dbPath: join(dir, 'provider.db') });
    expect(provider.runtimeStore).toBeInstanceOf(SqliteRuntimeStore);
    await provider.close(); expect(() => provider.runtimeStore).toThrow('StorageProvider not initialized');
    await provider.init(); expect(provider.runtimeStore).toBeInstanceOf(SqliteRuntimeStore);
    await provider.close();
  });
});
