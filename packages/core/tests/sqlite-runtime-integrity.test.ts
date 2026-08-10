import type { RuntimeUnitOfWork } from '../src/sdk/runtime-storage.js';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { RuntimeError } from '../src/application/runtime/runtime-error.js';
import { mapEventRow, mapRunRow, mapSessionEntryRow, mapSessionRow, mapToolInvocationRow, mapWorkItemRow } from '../src/plugins/storage/sqlite/runtime-row-mappers.js';
import { SqliteRuntimeStore } from '../src/plugins/storage/sqlite/runtime-store.js';
import { SqliteSchemaManager } from '../src/plugins/storage/sqlite/schema.js';

const at = (second: number) => new Date(`2026-08-10T00:00:${String(second).padStart(2, '0')}.000Z`);
const session = (id: string, tenantId: string) => ({ sessionId: id, tenantId, contexts: { bindings: [] }, createdAt: at(1), updatedAt: at(1) });
const run = (id: string, tenantId: string, sessionId: string) => ({ runId: id, tenantId, principalId: 'p', sessionId, agentId: 'a', agentRevision: '1', status: 'queued' as const, trigger: { type: 'task' as const, input: null }, contextSnapshot: { items: [], configLayers: [], promptSections: [] }, createdAt: at(2), updatedAt: at(2) });
const event = (tenantId: string, sessionId: string, runId: string) => ({ eventId: `e-${tenantId}-${sessionId}`, sequence: 1, schemaVersion: 1 as const, tenantId, sessionId, runId, type: 'run.created', data: null, occurredAt: at(3) });

function openStore() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON'); new SqliteSchemaManager(db).migrate();
  return { db, store: new SqliteRuntimeStore(db) };
}

async function expectCode(action: () => unknown | Promise<unknown>, code: RuntimeError['code']) {
  const error = await Promise.resolve().then(action).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(RuntimeError); expect(error).toMatchObject({ code });
  return error as RuntimeError;
}

describe('SQLite runtime 关系完整性', () => {
  it('v11 升级直接创建最终复合外键，不兼容未发布的临时 v12 形状', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE schema_version(version INTEGER PRIMARY KEY); INSERT INTO schema_version VALUES(11)');
    new SqliteSchemaManager(db).migrate();
    const foreignKeys = db.prepare('PRAGMA foreign_key_list(runtime_events)').all() as Array<{ table: string; from: string; to: string }>;
    expect(foreignKeys.map(({ table, from, to }) => ({ table, from, to }))).toEqual(expect.arrayContaining([
      { table: 'runtime_runs', from: 'tenant_id', to: 'tenant_id' },
      { table: 'runtime_runs', from: 'session_id', to: 'session_id' },
      { table: 'runtime_runs', from: 'run_id', to: 'id' },
    ]));
    db.close();
  });

  it('拒绝跨 tenant/session 的 run 与子记录，合法关系可提交', async () => {
    const { db, store } = openStore();
    await store.transaction((uow) => {
      uow.sessions.insert(session('s1', 't1')); uow.sessions.insert(session('s2', 't2'));
      uow.runs.insert(run('r1', 't1', 's1')); uow.runs.insert(run('r2', 't2', 's2'));
      uow.events.append(event('t1', 's1', 'r1'));
      uow.sessions.appendEntries([{ entryId: 'entry-ok', tenantId: 't1', sessionId: 's1', runId: 'r1', sequence: 1, message: { role: 'user', content: 'ok', timestamp: at(3).getTime() }, createdAt: at(3) }]);
      uow.artifacts.insert({ artifactId: 'artifact-ok', tenantId: 't1', sessionId: 's1', runId: 'r1', type: 'report', mediaType: 'text/plain', name: 'ok', createdAt: at(3) });
      uow.toolInvocations.insert({ invocationId: 'tool-ok', tenantId: 't1', sessionId: 's1', runId: 'r1', toolCallId: 'call-ok', toolName: 'tool', status: 'planned', sideEffect: 'none', supportsIdempotencyKey: false, input: null, createdAt: at(3), updatedAt: at(3) });
    });
    await expectCode(() => store.transaction((uow) => uow.runs.insert(run('bad-run', 't1', 's2'))), 'STORAGE_CONFLICT');
    const invalidChildren: Array<(uow: RuntimeUnitOfWork) => void> = [
      (uow) => uow.events.append({ ...event('t2', 's2', 'r1'), eventId: 'bad-event' }),
      (uow) => uow.sessions.appendEntries([{ entryId: 'bad-entry', tenantId: 't1', sessionId: 's2', runId: 'r1', sequence: 2, message: { role: 'user', content: 'bad', timestamp: at(3).getTime() }, createdAt: at(3) }]),
      (uow) => uow.artifacts.insert({ artifactId: 'bad-artifact', tenantId: 't2', sessionId: 's1', runId: 'r1', type: 'report', mediaType: 'text/plain', name: 'bad', createdAt: at(3) }),
      (uow) => uow.toolInvocations.insert({ invocationId: 'bad-tool', tenantId: 't1', sessionId: 's2', runId: 'r1', toolCallId: 'bad-call', toolName: 'tool', status: 'planned', sideEffect: 'none', supportsIdempotencyKey: false, input: null, createdAt: at(3), updatedAt: at(3) }),
    ];
    for (const write of invalidChildren) await expectCode(() => store.transaction(write), 'STORAGE_CONFLICT');
    db.prepare("DELETE FROM runtime_sessions WHERE id='s2'").run();
    expect(await store.getRun('r1')).not.toBeNull();
    db.close();
  });
});

describe('SQLite runtime 严格映射', () => {
  const sessionRow = { id: 's', tenant_id: 't', contexts_json: '{"bindings":[]}', created_at: at(1).toISOString(), updated_at: at(1).toISOString() };
  const runRow = { id: 'r', tenant_id: 't', principal_id: 'p', session_id: 's', agent_id: 'a', agent_revision: '1', status: 'queued', trigger_json: '{"type":"task","input":null}', context_snapshot_json: '{"items":[],"configLayers":[],"promptSections":[]}', waiting_reason: null, error_code: null, cancellation_requested_at: null, created_at: at(1).toISOString(), started_at: null, finished_at: null, updated_at: at(1).toISOString() };
  const eventRow = { id: 'e', sequence: 1, schema_version: 1, tenant_id: 't', session_id: 's', run_id: 'r', type: 'run.created', data_json: 'null', occurred_at: at(1).toISOString() };
  const workRow = { id: 'w', run_id: 'r', status: 'queued', lease_owner: null, lease_expires_at: null, attempt: 0, created_at: at(1).toISOString(), updated_at: at(1).toISOString() };
  const toolRow = { id: 'i', tenant_id: 't', session_id: 's', run_id: 'r', tool_call_id: 'c', tool_name: 'tool', status: 'planned', side_effect: 'none', supports_idempotency_key: 0, input_json: 'null', result_json: null, error: null, created_at: at(1).toISOString(), updated_at: at(1).toISOString() };
  const entryRow = { id: 'e', tenant_id: 't', session_id: 's', run_id: 'r', sequence: 1, message_json: '{"role":"user","content":"ok","timestamp":1}', metadata_json: null, created_at: at(1).toISOString() };
  const snapshotItem = { binding: { type: 'account', contextId: 'a' }, pluginId: 'plugin', pluginVersion: '1', snapshotHash: 'a'.repeat(64), snapshot: {} };
  const snapshotJson = (item: unknown) => JSON.stringify({ items: [item], configLayers: [], promptSections: [] });

  it.each([
    ['null contexts', () => mapSessionRow({ ...sessionRow, contexts_json: null as never })],
    ['corrupt status', () => mapRunRow({ ...runRow, status: 'other' })],
    ['noncanonical date', () => mapSessionRow({ ...sessionRow, created_at: '2026-08-10' })],
    ['invalid sequence', () => mapEventRow({ ...eventRow, sequence: 0 })],
    ['invalid schema version', () => mapEventRow({ ...eventRow, schema_version: 2 })],
    ['invalid attempt', () => mapWorkItemRow({ ...workRow, attempt: -1 })],
    ['invalid boolean', () => mapToolInvocationRow({ ...toolRow, supports_idempotency_key: 2 })],
    ['null binding', () => mapSessionRow({ ...sessionRow, contexts_json: '{"bindings":[null]}' })],
    ['binding without context id', () => mapSessionRow({ ...sessionRow, contexts_json: '{"bindings":[{"type":"account"}]}' })],
    ['null snapshot item', () => mapRunRow({ ...runRow, context_snapshot_json: '{"items":[null],"configLayers":[],"promptSections":[]}' })],
    ['invalid snapshot hash', () => mapRunRow({ ...runRow, context_snapshot_json: snapshotJson({ ...snapshotItem, snapshotHash: 'short' }) })],
    ['snapshot without payload', () => { const { snapshot: _snapshot, ...item } = snapshotItem; return mapRunRow({ ...runRow, context_snapshot_json: snapshotJson(item) }); }],
    ['empty config layer', () => mapRunRow({ ...runRow, context_snapshot_json: '{"items":[],"configLayers":[{}],"promptSections":[]}' })],
    ['invalid config priority', () => mapRunRow({ ...runRow, context_snapshot_json: '{"items":[],"configLayers":[{"name":"base","priority":"first","value":{}}],"promptSections":[]}' })],
    ['invalid prompt section', () => mapRunRow({ ...runRow, context_snapshot_json: '{"items":[],"configLayers":[],"promptSections":[1]}' })],
    ['message without content', () => mapSessionEntryRow({ ...entryRow, message_json: '{"role":"user","timestamp":1}' })],
    ['message without timestamp', () => mapSessionEntryRow({ ...entryRow, message_json: '{"role":"user","content":"x"}' })],
    ['tool result without isError', () => mapSessionEntryRow({ ...entryRow, message_json: '{"role":"toolResult","toolCallId":"c","toolName":"tool","content":[],"timestamp":1}' })],
  ])('拒绝 %s', (_name, action) => {
    let error: unknown; try { action(); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(RuntimeError); expect(error).toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    expect((error as RuntimeError).cause).toBeDefined();
  });
});

describe('SQLite runtime 写入与领取边界', () => {
  it('循环 JSON、BigInt 与 invalid Date 是 INVALID_INPUT 且回滚', async () => {
    const { db, store } = openStore();
    const circular: Record<string, unknown> = { bindings: [] }; circular.self = circular;
    const actions = [
      (uow: RuntimeUnitOfWork) => uow.sessions.insert({ ...session('circular', 't'), contexts: circular as never }),
      (uow: RuntimeUnitOfWork) => { uow.sessions.insert(session('bigint', 't')); uow.runs.insert({ ...run('bigint-run', 't', 'bigint'), trigger: { type: 'task', input: 1n } }); },
      (uow: RuntimeUnitOfWork) => uow.sessions.insert({ ...session('date', 't'), createdAt: new Date(Number.NaN) }),
    ];
    for (const action of actions) {
      const error = await expectCode(() => store.transaction(action), 'INVALID_INPUT');
      expect(error.cause).toBeDefined();
    }
    expect(db.prepare('SELECT COUNT(*) AS count FROM runtime_sessions').get()).toEqual({ count: 0 });
    db.close();
  });

  it('claim 只映射最早 createdAt 时间桶', async () => {
    const { db, store } = openStore();
    await store.transaction((uow) => {
      uow.sessions.insert(session('early-s', 't')); uow.runs.insert(run('early-r', 't', 'early-s'));
      uow.workItems.insert({ workItemId: 'early', runId: 'early-r', status: 'queued', attempt: 0, createdAt: at(2), updatedAt: at(2) });
      uow.sessions.insert(session('late-s', 't')); uow.runs.insert(run('late-r', 't', 'late-s'));
      uow.workItems.insert({ workItemId: 'late', runId: 'late-r', status: 'queued', attempt: 0, createdAt: at(3), updatedAt: at(3) });
    });
    db.prepare("UPDATE runtime_work_items SET attempt='corrupt' WHERE id='late'").run();
    await expect(store.claimWorkItem('owner', at(10), 1_000)).resolves.toMatchObject({ workItemId: 'early', attempt: 1 });
    db.close();
  });

  it('claim 的 queued 与过期 leased 最早查询均使用专用索引', () => {
    const { db } = openStore();
    const queued = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT MIN(created_at) AS value FROM runtime_work_items WHERE status = 'queued'
    `).all() as Array<{ detail: string }>;
    const leased = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT MIN(created_at) AS value FROM runtime_work_items
      WHERE status = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
    `).all(at(10).toISOString()) as Array<{ detail: string }>;
    expect(queued.map(({ detail }) => detail).join('\n')).toContain('idx_runtime_work_queued_created');
    expect(leased.map(({ detail }) => detail).join('\n')).toContain('idx_runtime_work_leased_claim');
    db.close();
  });
});
