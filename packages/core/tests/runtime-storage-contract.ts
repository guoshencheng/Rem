import type { Artifact } from '../src/domain/artifact/types.js';
import type { RunEvent } from '../src/domain/event/types.js';
import type { AgentRun, ToolInvocation, WorkItem } from '../src/domain/run/types.js';
import type { AgentSession, RuntimeSessionEntry } from '../src/domain/session/types.js';
import type { RuntimeStorage, RuntimeUnitOfWork } from '../src/sdk/runtime-storage.js';
import { RuntimeError } from '../src/application/runtime/runtime-error.js';
import { afterEach, describe, expect, it } from 'vitest';

export type RuntimeStoreFactory = () => Promise<{ store: RuntimeStorage; close(): Promise<void> }>;

const at = (second: number) => new Date(`2026-08-10T00:00:${String(second).padStart(2, '0')}.000Z`);
const session = (): AgentSession => ({ sessionId: 'session-1', tenantId: 'tenant-1', contexts: { bindings: [] }, createdAt: at(1), updatedAt: at(1) });
const run = (id = 'run-1'): AgentRun => ({ runId: id, tenantId: 'tenant-1', principalId: 'user-1', sessionId: 'session-1', agentId: 'agent-1', agentRevision: '1', status: 'queued', trigger: { type: 'task', input: { nested: { value: 1 } } }, contextSnapshot: { items: [], configLayers: [], promptSections: [] }, createdAt: at(2), updatedAt: at(2) });
const event = (sequence: number, id = `event-${sequence}`): RunEvent => ({ eventId: id, sequence, schemaVersion: 1, tenantId: 'tenant-1', sessionId: 'session-1', runId: 'run-1', type: 'run.created', data: { nested: { value: sequence } }, occurredAt: at(3) });
const work = (id = 'work-1', runId = 'run-1', createdAt = at(4)): WorkItem => ({ workItemId: id, runId, status: 'queued', attempt: 0, createdAt, updatedAt: createdAt });
const artifact = (): Artifact => ({ artifactId: 'artifact-1', tenantId: 'tenant-1', sessionId: 'session-1', runId: 'run-1', type: 'report', mediaType: 'application/json', name: 'result', metadata: { nested: { value: 1 } }, createdAt: at(5) });
const invocation = (): ToolInvocation => ({ invocationId: 'invocation-1', tenantId: 'tenant-1', sessionId: 'session-1', runId: 'run-1', toolCallId: 'call-1', toolName: 'lookup', status: 'planned', sideEffect: 'none', supportsIdempotencyKey: true, input: { nested: { value: 1 } }, createdAt: at(6), updatedAt: at(6) });
const entry = (): RuntimeSessionEntry => ({ entryId: 'entry-1', tenantId: 'tenant-1', sessionId: 'session-1', runId: 'run-1', sequence: 1, message: { role: 'user', content: 'hello' } as RuntimeSessionEntry['message'], metadata: { nested: { value: 1 } }, createdAt: at(7) });

async function expectCode(action: () => unknown | Promise<unknown>, code: RuntimeError['code']): Promise<void> {
  await expect(action()).rejects.toMatchObject({ code });
}

function createRun(uow: RuntimeUnitOfWork, runId = 'run-1', sessionId = 'session-1'): void {
  uow.sessions.insert({ ...session(), sessionId });
  uow.runs.insert({ ...run(runId), sessionId });
}

function createWorkItemRuns(uow: RuntimeUnitOfWork, runIds: string[]): void {
  for (const runId of runIds) createRun(uow, runId, `session-${runId}`);
}

async function startRun(store: RuntimeStorage, requestHash: string, tenantId = 'tenant-1', key = 'key-1'): Promise<string> {
  return store.transaction((uow) => {
    const existing = uow.idempotency.get(tenantId, 'start-run', key);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new RuntimeError('IDEMPOTENCY_CONFLICT', 'request changed');
      return existing.resourceId;
    }
    const resourceId = `run-${tenantId}-${key}`;
    uow.idempotency.insert({ tenantId, operation: 'start-run', idempotencyKey: key, requestHash, resourceId, createdAt: at(1) });
    return resourceId;
  });
}

export function runtimeStorageContract(createStore: RuntimeStoreFactory): void {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => { await close?.(); close = undefined; });
  const open = async (): Promise<RuntimeStorage> => { const created = await createStore(); close = created.close; return created.store; };

  describe('RuntimeStorage 契约', () => {
    it('原子创建运行所需记录并逐项读回', async () => {
      const store = await open();
      await store.transaction((uow) => { createRun(uow); uow.events.append(event(1)); uow.workItems.insert(work()); uow.idempotency.insert({ tenantId: 'tenant-1', operation: 'start-run', idempotencyKey: 'key-1', requestHash: 'hash-1', resourceId: 'run-1', createdAt: at(1) }); });
      expect(await store.getSession('session-1')).toEqual(session());
      expect(await store.getRun('run-1')).toEqual(run());
      expect(await store.listEvents('run-1')).toEqual([event(1)]);
      expect(await store.listRecoverableWorkItems(at(10))).toEqual([work()]);
      await expect(startRun(store, 'hash-1')).resolves.toBe('run-1');
    });

    it('callback 中途失败时回滚全部写入', async () => {
      const store = await open();
      await expect(store.transaction((uow) => { createRun(uow); uow.events.append(event(1)); uow.workItems.insert(work()); uow.artifacts.insert(artifact()); uow.idempotency.insert({ tenantId: 'tenant-1', operation: 'start-run', idempotencyKey: 'key-1', requestHash: 'hash', resourceId: 'run-1', createdAt: at(1) }); throw new Error('stop'); })).rejects.toThrow('stop');
      expect(await store.getSession('session-1')).toBeNull(); expect(await store.getRun('run-1')).toBeNull();
      expect(await store.listEvents('run-1')).toEqual([]); expect(await store.listArtifacts('run-1')).toEqual([]);
      expect(await store.listRecoverableWorkItems(at(10))).toEqual([]); await expect(startRun(store, 'hash')).resolves.toBe('run-tenant-1-key-1');
    });

    it('按幂等范围复用资源并拒绝不同请求', async () => {
      const store = await open();
      await expect(startRun(store, 'hash-1')).resolves.toBe('run-tenant-1-key-1');
      await expect(startRun(store, 'hash-1')).resolves.toBe('run-tenant-1-key-1');
      await expectCode(() => startRun(store, 'hash-2'), 'IDEMPOTENCY_CONFLICT');
      await expect(startRun(store, 'hash-1', 'tenant-2')).resolves.toBe('run-tenant-2-key-1');
      await expect(startRun(store, 'hash-1', 'tenant-1', 'key-2')).resolves.toBe('run-tenant-1-key-2');
    });

    it('拒绝被绕过类型系统的异步 transaction callback', async () => {
      const store = await open();
      await expectCode(() => store.transaction(((uow) => { uow.sessions.insert(session()); return Promise.reject(new Error('async failure')); }) as unknown as (uow: RuntimeUnitOfWork) => string), 'INVALID_INPUT');
      expect(await store.getSession('session-1')).toBeNull();
      await store.transaction((uow) => { createRun(uow); uow.workItems.insert(work()); });
      expect((await store.claimWorkItem('owner', at(10), 1))?.workItemId).toBe('work-1');
    });

    it('并发领取不会重复，另一个 work item 仍可后续领取', async () => {
      const store = await open(); await store.transaction((uow) => { createRun(uow); uow.workItems.insert(work('work-1')); });
      // 内存 Fake 只验证单实例串行化；Task 5 另测 SQLite 跨连接竞争。
      const claims = await Promise.all([store.claimWorkItem('a', at(10), 100), store.claimWorkItem('b', at(10), 100)]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      await store.transaction((uow) => { createRun(uow, 'run-2', 'session-2'); uow.workItems.insert(work('work-2', 'run-2')); });
      expect((await store.claimWorkItem('c', at(10), 100))?.workItemId).toBe('work-2');
    });

    it('租约到期前不可重领，等于到期时间时可重新领取', async () => {
      const store = await open(); await store.transaction((uow) => { createRun(uow); uow.workItems.insert(work()); });
      expect((await store.claimWorkItem('a', at(10), 1000))?.attempt).toBe(1);
      expect(await store.claimWorkItem('b', new Date(at(10).getTime() + 999), 1000)).toBeNull();
      const claimed = await store.claimWorkItem('b', new Date(at(10).getTime() + 1000), 500);
      expect(claimed).toMatchObject({ leaseOwner: 'b', attempt: 2, leaseExpiresAt: new Date(at(10).getTime() + 1500), updatedAt: new Date(at(10).getTime() + 1000) });
    });

    it('全局按创建时间排序恢复任务，claim 选择同一首项', async () => {
      const store = await open(); await store.transaction((uow) => { createWorkItemRuns(uow, ['run-queued', 'run-expired', 'run-active', 'run-completed', 'run-failed']); uow.workItems.insert(work('queued', 'run-queued', at(3))); uow.workItems.insert({ ...work('expired', 'run-expired', at(2)), status: 'leased', leaseOwner: 'x', leaseExpiresAt: at(9) }); uow.workItems.insert({ ...work('active', 'run-active', at(1)), status: 'leased', leaseOwner: 'x', leaseExpiresAt: at(11) }); uow.workItems.insert({ ...work('completed', 'run-completed', at(1)), status: 'completed' }); uow.workItems.insert({ ...work('failed', 'run-failed', at(1)), status: 'failed' }); });
      expect((await store.listRecoverableWorkItems(at(10))).map((item) => item.workItemId)).toEqual(['expired', 'queued']);
      expect((await store.claimWorkItem('owner', at(10), 1))?.workItemId).toBe('expired');
    });

    it('使用原始 UTF-16 顺序稳定领取和恢复任务', async () => {
      const store = await open(); const first = 'e\u0301'; const second = 'é';
      await store.transaction((uow) => { createWorkItemRuns(uow, ['run-accent-2', 'run-accent-1']); uow.workItems.insert(work(second, 'run-accent-2', at(2))); uow.workItems.insert(work(first, 'run-accent-1', at(2))); });
      expect((await store.listRecoverableWorkItems(at(10))).map((item) => item.workItemId)).toEqual([first, second]);
      expect((await store.claimWorkItem('owner', at(10), 1))?.workItemId).toBe(first);
    });

    it('事件按 sequence 排序，cursor 排他，run 更新与 event 原子提交', async () => {
      const store = await open(); await store.transaction((uow) => { expect(uow.events.nextSequence('run-1')).toBe(1); createRun(uow); uow.events.append(event(3)); uow.events.append(event(1)); uow.events.append(event(2)); expect(uow.events.nextSequence('run-1')).toBe(4); });
      expect((await store.listEvents('run-1')).map((item) => item.sequence)).toEqual([1, 2, 3]);
      expect((await store.listEvents('run-1', 1, 2)).map((item) => item.sequence)).toEqual([2, 3]);
      await store.transaction((uow) => { uow.runs.update({ ...run(), status: 'running', startedAt: at(4), updatedAt: at(4) }); uow.events.append(event(4)); });
      expect(await store.getRun('run-1')).toMatchObject({ status: 'running', startedAt: at(4) });
      await expectCode(() => store.transaction((uow) => { uow.runs.update({ ...run(), status: 'failed', startedAt: at(4), finishedAt: at(5), updatedAt: at(5) }); uow.events.append(event(4, 'event-duplicate')); }), 'STORAGE_CONFLICT');
      expect(await store.getRun('run-1')).toMatchObject({ status: 'running', startedAt: at(4) }); expect((await store.listEvents('run-1')).map((item) => item.sequence)).toEqual([1, 2, 3, 4]);
    });

    it('默认最多读取 100 个 event，并保持 eventId 全局唯一', async () => {
      const store = await open(); await store.transaction((uow) => { createRun(uow); for (let sequence = 101; sequence >= 1; sequence -= 1) uow.events.append(event(sequence)); });
      expect((await store.listEvents('run-1')).map((item) => item.sequence)).toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
      await store.transaction((uow) => { uow.sessions.insert({ ...session(), sessionId: 'session-2' }); uow.runs.insert({ ...run('run-2'), sessionId: 'session-2' }); });
      await expectCode(() => store.transaction((uow) => uow.events.append({ ...event(1), sessionId: 'session-2', runId: 'run-2', eventId: 'event-1' })), 'STORAGE_CONFLICT');
    });

    it('session entry、artifact 与 tool invocation 可往返且隔离别名', async () => {
      const store = await open(); const laterEntry = { ...entry(), entryId: 'entry-2', sequence: 2 };
      await store.transaction((uow) => { createRun(uow); uow.sessions.appendEntries([laterEntry, entry()]); uow.workItems.insert(work()); uow.artifacts.insert(artifact()); uow.toolInvocations.insert(invocation()); });
      await store.transaction((uow) => { const entries = uow.sessions.listEntries('session-1'); entries[0].metadata = { changed: true }; entries[0].message = { role: 'assistant', content: 'changed' } as RuntimeSessionEntry['message']; const item = uow.toolInvocations.get('invocation-1'); (item!.input as { nested: { value: number } }).nested.value = 2; uow.toolInvocations.update({ ...invocation(), status: 'succeeded', result: { nested: { value: 1 } }, updatedAt: at(8) }); uow.workItems.update({ ...work(), status: 'completed', updatedAt: at(9) }); });
      const [storedArtifact] = await store.listArtifacts('run-1'); storedArtifact.metadata!.nested = { value: 9 };
      await store.transaction((uow) => { const stored = uow.toolInvocations.get('invocation-1')!; (stored.result as { nested: { value: number } }).nested.value = 2; const storedWork = uow.workItems.getByRun('run-1')!; storedWork.status = 'failed'; expect(uow.sessions.listEntries('session-1')).toEqual([entry(), laterEntry]); expect(uow.toolInvocations.listByRun('run-1')).toEqual([{ ...invocation(), status: 'succeeded', result: { nested: { value: 1 } }, updatedAt: at(8) }]); expect(uow.workItems.getByRun('run-1')).toEqual({ ...work(), status: 'completed', updatedAt: at(9) }); });
      expect((await store.listArtifacts('run-1'))[0].metadata).toEqual({ nested: { value: 1 } });
    });

    it('tool invocation 的 runId 与 toolCallId 组合必须唯一', async () => {
      const store = await open(); await store.transaction((uow) => { createRun(uow); uow.toolInvocations.insert(invocation()); });
      await expectCode(() => store.transaction((uow) => uow.toolInvocations.insert({ ...invocation(), invocationId: 'invocation-other' })), 'STORAGE_CONFLICT');
    });

    it('所有存储冲突与非法参数返回对应 code', async () => {
      const store = await open(); await store.transaction((uow) => { createRun(uow); uow.workItems.insert(work()); });
      await expectCode(() => store.transaction((uow) => uow.sessions.insert(session())), 'STORAGE_CONFLICT');
      await expectCode(() => store.transaction((uow) => uow.runs.insert(run())), 'STORAGE_CONFLICT');
      await expectCode(() => store.transaction((uow) => uow.runs.update(run('missing'))), 'STORAGE_CONFLICT');
      await expectCode(() => store.transaction((uow) => uow.workItems.insert(work('work-other', 'run-1'))), 'STORAGE_CONFLICT');
      await expectCode(() => store.transaction((uow) => uow.sessions.appendEntries([entry(), { ...entry(), entryId: 'entry-other' }])), 'STORAGE_CONFLICT');
      await store.transaction((uow) => { uow.events.append(event(1)); uow.artifacts.insert(artifact()); uow.toolInvocations.insert(invocation()); uow.idempotency.insert({ tenantId: 'tenant-1', operation: 'start-run', idempotencyKey: 'key-1', requestHash: 'hash', resourceId: 'run-1', createdAt: at(1) }); });
      await expectCode(() => store.transaction((uow) => uow.events.append(event(2, 'event-1'))), 'STORAGE_CONFLICT');
      await expectCode(() => store.transaction((uow) => uow.artifacts.insert(artifact())), 'STORAGE_CONFLICT');
      await expectCode(() => store.transaction((uow) => uow.toolInvocations.insert(invocation())), 'STORAGE_CONFLICT');
      await expectCode(() => store.transaction((uow) => uow.workItems.update(work('missing-work', 'run-missing'))), 'STORAGE_CONFLICT');
      await expectCode(() => store.transaction((uow) => uow.toolInvocations.update({ ...invocation(), invocationId: 'missing-invocation' })), 'STORAGE_CONFLICT');
      await expectCode(() => store.transaction((uow) => uow.idempotency.insert({ tenantId: 'tenant-1', operation: 'start-run', idempotencyKey: 'key-1', requestHash: 'hash', resourceId: 'run-1', createdAt: at(1) })), 'STORAGE_CONFLICT');
      for (const owner of ['', '   ']) await expectCode(() => store.claimWorkItem(owner, at(10), 1), 'INVALID_INPUT');
      for (const leaseMs of [0.5, Number.NaN, Infinity, 0, -1, Number.MAX_VALUE]) await expectCode(() => store.claimWorkItem('a', at(10), leaseMs), 'INVALID_INPUT');
      for (const limit of [Number.NaN, Infinity, 0, -1]) await expectCode(() => store.listEvents('run-1', 0, limit), 'INVALID_INPUT');
      await expectCode(() => store.listEvents('run-1', Number.NaN), 'INVALID_INPUT');
      await expectCode(() => store.claimWorkItem('a', new Date(Number.NaN), 1), 'INVALID_INPUT');
      await expectCode(() => store.listRecoverableWorkItems(new Date(Number.NaN)), 'INVALID_INPUT');
    });
  });
}
