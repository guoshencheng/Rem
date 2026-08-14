import type { AgentRun, ToolInvocation, WorkItem } from '../src/domain/run/types.js';
import { describe, expect, it } from 'vitest';
import { ResolveToolInvocationUsecase } from '../src/application/runs/resolve-tool-invocation.js';
import { createFakeRuntimeStore } from './helpers/fake-runtime-store.js';

const at = new Date('2026-08-14T01:00:00.000Z');
const request = { tenantId: 't', principal: { principalId: 'operator', roles: ['member'] } };
const run: AgentRun = { runId: 'r', tenantId: 't', principalId: 'p', sessionId: 's', agentId: 'a', agentRevision: '1', status: 'waiting', waitingReason: 'tool-result-unknown', trigger: { type: 'task', input: {} }, contextSnapshot: { items: [], configLayers: [], promptSections: [] }, rootNodeId: 'r:root', createdAt: at, updatedAt: at };
const work: WorkItem = { workItemId: 'w', runId: 'r', status: 'failed', attempt: 1, createdAt: at, updatedAt: at };
const invocation: ToolInvocation = { invocationId: 'i', tenantId: 't', sessionId: 's', runId: 'r', nodeId: 'r:root', toolCallId: 'call', toolName: 'charge', status: 'unknown', sideEffect: 'non-idempotent', supportsIdempotencyKey: false, input: { amount: 1 }, createdAt: at, updatedAt: at };

async function setup(inv = invocation) {
  const { store } = await createFakeRuntimeStore();
  await store.transaction((uow) => {
    uow.sessions.insert({ sessionId: 's', tenantId: 't', contexts: { bindings: [] }, createdAt: at, updatedAt: at });
    uow.runs.insert(run); uow.workItems.insert(work); uow.toolInvocations.insert(inv);
  });
  return store;
}

describe('ToolInvocation waiting resolution', () => {
  it('confirm-succeeded appends a journal result and requeues the Run', async () => {
    const store = await setup();
    let id = 0; const usecase = new ResolveToolInvocationUsecase({ storage: store, now: () => at, generateId: () => `id-${++id}` });
    const resolved = await usecase.execute(request, 'r', 'i', { action: 'confirm-succeeded', result: { output: 'charged' }, idempotencyKey: 'key-1' });
    expect(resolved.status).toBe('queued');
    expect((await store.getRun('r'))?.status).toBe('queued');
    expect(await store.transaction((uow) => uow.toolInvocations.get('i'))).toMatchObject({ status: 'succeeded', result: { output: 'charged' } });
    const entries = await store.listExecutionEntries('r');
    expect(entries.find((entry) => entry.kind === 'tool-result')).toMatchObject({ kind: 'tool-result', data: { output: 'charged' } });
    expect(entries.find((entry) => entry.kind === 'control')?.data).toMatchObject({ action: 'confirm-succeeded', principalId: 'operator' });
  });

  it('rejects unsafe retry without changing unknown state', async () => {
    const store = await setup();
    const usecase = new ResolveToolInvocationUsecase({ storage: store, now: () => at });
    await expect(usecase.execute(request, 'r', 'i', { action: 'retry', idempotencyKey: 'key-2' })).rejects.toMatchObject({ code: 'TOOL_RESULT_UNKNOWN' });
    expect(await store.transaction((uow) => uow.toolInvocations.get('i'))).toMatchObject({ status: 'unknown' });
  });

  it('同一幂等键重放结果，不重复写入；不同请求冲突', async () => {
    const store = await setup({ ...invocation, sideEffect: 'idempotent' });
    let id = 0; const usecase = new ResolveToolInvocationUsecase({ storage: store, now: () => at, generateId: () => `id-${++id}` });
    const resolution = { action: 'retry' as const, idempotencyKey: 'key-3' };
    await usecase.execute(request, 'r', 'i', resolution);
    await expect(usecase.execute(request, 'r', 'i', resolution)).resolves.toMatchObject({ status: 'queued' });
    await expect(usecase.execute(request, 'r', 'i', { action: 'fail', idempotencyKey: 'key-3' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('多个 unknown 只在最后一个处置后重新排队', async () => {
    const store = await setup();
    await store.transaction((uow) => uow.toolInvocations.insert({ ...invocation, invocationId: 'i-2', toolCallId: 'call-2' }));
    const usecase = new ResolveToolInvocationUsecase({ storage: store, now: () => at });
    await expect(usecase.execute(request, 'r', 'i', { action: 'confirm-succeeded', result: { output: 'one' }, idempotencyKey: 'multi-1' })).resolves.toMatchObject({ status: 'waiting' });
    expect(await store.getRun('r')).toMatchObject({ status: 'waiting' });
    await expect(usecase.execute(request, 'r', 'i-2', { action: 'confirm-succeeded', result: { output: 'two' }, idempotencyKey: 'multi-2' })).resolves.toMatchObject({ status: 'queued' });
  });
});
