import type { AgentDefinition } from '../src/domain/agent-definition/types.js';
import type { RuntimeRequestContext } from '../src/domain/identity/types.js';
import type { RuntimePlugin } from '../src/sdk/runtime-plugin.js';
import type { RuntimeStorage, RuntimeUnitOfWork } from '../src/sdk/runtime-storage.js';
import { describe, expect, it } from 'vitest';
import { ContextResolver } from '../src/application/contexts/context-resolver.js';
import { hashStartRunRequest } from '../src/application/runs/start-run-hash.js';
import { StartRunUsecase } from '../src/application/runs/start-run.js';
import { RuntimeError } from '../src/application/runtime/runtime-error.js';
import { RuntimePluginHost } from '../src/plugin-system/runtime-plugin-host.js';
import { StaticAgentDefinitionProvider } from '../src/plugins/agent-definition/static/provider.js';
import { createFakeRuntimeStore } from './helpers/fake-runtime-store.js';

const instant = new Date('2026-08-10T01:02:03.000Z');
const request = (changes: Partial<RuntimeRequestContext> = {}): RuntimeRequestContext => ({
  tenantId: 'tenant-1',
  principal: { principalId: 'user-1', roles: ['member'], claims: { trace: 'one' } },
  ...changes,
});
const definition = (revision = '1'): AgentDefinition => ({
  agentId: 'assistant', revision, name: 'Assistant', instructions: 'Help', modelId: 'model',
  toolNames: [], acceptedTriggers: ['task'], execution: { type: 'single-agent' },
});
const contextPlugin = (wait?: () => Promise<void>): RuntimePlugin => ({
  manifest: { pluginId: 'customer-plugin', version: '1' },
  register: ({ addContextType }) => addContextType({
    type: 'customer',
    resolve: async ({ binding }) => { await wait?.(); return { snapshot: { id: binding.contextId } }; },
    materialize: async () => ({}),
  }),
});

function start(storage: RuntimeStorage, options: {
  definitions?: AgentDefinition[];
  plugins?: RuntimePlugin[];
  ids?: string[];
  now?: () => Date;
} = {}): StartRunUsecase {
  let index = 0;
  return new StartRunUsecase({
    storage,
    agentDefinitions: new StaticAgentDefinitionProvider(options.definitions ?? [definition()]),
    contextResolver: new ContextResolver(new RuntimePluginHost(options.plugins ?? [contextPlugin()])),
    now: options.now ?? (() => instant),
    generateId: () => options.ids?.[index++] ?? `generated-${++index}`,
  });
}

const input = (value = 'same') => ({
  agentId: 'assistant', trigger: { type: 'task' as const, input: { value } },
  contexts: { add: [{ type: 'customer', contextId: 'customer-1' }] }, idempotencyKey: 'key-1',
});

async function expectCode(action: () => unknown | Promise<unknown>, code: string): Promise<RuntimeError> {
  try {
    await action();
    throw new Error('Expected RuntimeError');
  } catch (error) {
    expect(error).toBeInstanceOf(RuntimeError);
    expect(error).toMatchObject({ code });
    return error as RuntimeError;
  }
}

function wrapTransactions(
  storage: RuntimeStorage,
  transform: (uow: RuntimeUnitOfWork) => RuntimeUnitOfWork,
): RuntimeStorage {
  return {
    transaction: ((operation: (uow: RuntimeUnitOfWork) => unknown) => (
      storage.transaction((uow) => operation(transform(uow)))
    )) as RuntimeStorage['transaction'],
    getSession: (id) => storage.getSession(id), getRun: (id) => storage.getRun(id),
    listEvents: (id, after, limit) => storage.listEvents(id, after, limit),
    listArtifacts: (id) => storage.listArtifacts(id),
    claimWorkItem: (owner, now, lease) => storage.claimWorkItem(owner, now, lease),
    listRecoverableWorkItems: (now) => storage.listRecoverableWorkItems(now),
  };
}

describe('StartRun 幂等与原子边界', () => {
  it('同 key 同请求返回隔离的同一 run，且预检不依赖当前 definition/plugin', async () => {
    const { store } = await createFakeRuntimeStore();
    const first = await start(store).execute(request(), input());
    first.status = 'failed';
    (first.trigger as { type: 'task'; input: { value: string } }).input.value = 'mutated';

    const retried = await start(store, { definitions: [], plugins: [] }).execute(request({
      principal: { principalId: 'user-1', roles: ['admin'], claims: { trace: 'changed' } },
    }), input());
    expect(retried.runId).toBe(first.runId);
    expect(retried).toMatchObject({ status: 'queued', trigger: { input: { value: 'same' } } });
    expect(await store.listEvents(retried.runId)).toHaveLength(1);
  });

  it('同 key 不同请求冲突，记录指向缺失 run 时报告存储不可用', async () => {
    const { store } = await createFakeRuntimeStore();
    await start(store).execute(request(), input());
    await expectCode(() => start(store).execute(request(), input('changed')), 'IDEMPOTENCY_CONFLICT');

    const missingInput = { ...input(), idempotencyKey: 'missing-key' };
    await store.transaction((uow) => uow.idempotency.insert({
      tenantId: 'tenant-1', operation: 'start-run', idempotencyKey: 'missing-key',
      requestHash: hashStartRunRequest(request(), missingInput), resourceId: 'missing-run', createdAt: instant,
    }));
    await expectCode(() => start(store, { definitions: [], plugins: [] }).execute(request(), missingInput), 'STORAGE_UNAVAILABLE');
  });

  it('并发相同 key 在最终检查只创建一组资源', async () => {
    const { store } = await createFakeRuntimeStore();
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const generated: string[] = [];
    const ids = Array.from({ length: 8 }, (_, index) => `id-${index + 1}`);
    const usecase = new StartRunUsecase({
      storage: store, agentDefinitions: new StaticAgentDefinitionProvider([definition()]),
      contextResolver: new ContextResolver(new RuntimePluginHost([contextPlugin(async () => {
        arrivals += 1;
        if (arrivals === 2) release();
        await barrier;
      })])),
      now: () => instant,
      generateId: () => { const id = ids[generated.length]!; generated.push(id); return id; },
    });
    const [left, right] = await Promise.all([usecase.execute(request(), input()), usecase.execute(request(), input())]);

    expect(left.runId).toBe(right.runId);
    expect(generated).toHaveLength(8);
    const sessions = (await Promise.all(generated.map((id) => store.getSession(id)))).filter(Boolean);
    const runs = (await Promise.all(generated.map((id) => store.getRun(id)))).filter(Boolean);
    expect(sessions).toHaveLength(1);
    expect(runs).toHaveLength(1);
    expect(await store.listEvents(left.runId)).toHaveLength(1);
    await store.transaction((uow) => expect(uow.workItems.getByRun(left.runId)).not.toBeNull());
  });

  it('最终事件写入失败会回滚 session、run、work 与幂等记录', async () => {
    const { store } = await createFakeRuntimeStore();
    const failing = wrapTransactions(store, (uow) => ({
      ...uow,
      events: { ...uow.events, append: () => { throw new Error('event failure'); } },
    }));
    await expect(start(failing, { ids: ['session', 'run', 'event', 'work'] }).execute(request(), input()))
      .rejects.toThrow('event failure');
    expect(await store.getSession('session')).toBeNull();
    expect(await store.getRun('run')).toBeNull();
    expect(await store.listEvents('run')).toEqual([]);
    await store.transaction((uow) => {
      expect(uow.workItems.getByRun('run')).toBeNull();
      expect(uow.idempotency.get('tenant-1', 'start-run', 'key-1')).toBeNull();
    });
  });

  it('解析期间已有 Session 发生变化时拒绝基于过期 Context 提交', async () => {
    const { store } = await createFakeRuntimeStore();
    await store.transaction((uow) => uow.sessions.insert({
      sessionId: 'existing', tenantId: 'tenant-1', contexts: { bindings: [] },
      createdAt: instant, updatedAt: instant,
    }));
    const changed = wrapTransactions(store, (uow) => ({
      ...uow,
      sessions: {
        ...uow.sessions,
        get: (id) => {
          const value = uow.sessions.get(id);
          return value ? { ...value, updatedAt: new Date(instant.getTime() + 1) } : null;
        },
      },
    }));
    await expectCode(() => start(changed, { ids: ['run', 'event', 'work'] }).execute(request(), {
      agentId: 'assistant', sessionId: 'existing', trigger: { type: 'task', input: null },
    }), 'RUN_CONFLICT');
    expect(await store.getRun('run')).toBeNull();
  });
});

describe('StartRun 请求哈希与输入验证', () => {
  it('对象 key 顺序稳定、数组顺序敏感，且只纳入规定身份字段', () => {
    const ordered = {
      ...input(), contexts: { add: [
        { type: 'customer', contextId: 'customer-1' },
        { type: 'customer', contextId: 'customer-2' },
      ] },
    };
    const reordered = {
      idempotencyKey: 'key-1', contexts: { add: [
        { contextId: 'customer-1', type: 'customer' },
        { contextId: 'customer-2', type: 'customer' },
      ] },
      trigger: { input: { value: 'same' }, type: 'task' as const }, agentId: 'assistant',
    };
    expect(hashStartRunRequest(request(), ordered)).toBe(hashStartRunRequest(request(), reordered));
    expect(hashStartRunRequest(request(), ordered)).toBe(hashStartRunRequest(request({
      principal: { principalId: 'user-1', roles: ['different'], claims: { anything: true } },
    }), ordered));
    expect(hashStartRunRequest(request(), ordered)).not.toBe(hashStartRunRequest(request({
      principal: { principalId: 'user-2', roles: ['member'] },
    }), ordered));
    expect(hashStartRunRequest(request(), ordered)).not.toBe(hashStartRunRequest(request(), {
      ...ordered, contexts: { add: [...ordered.contexts.add].reverse() },
    }));
    expect(hashStartRunRequest(request(), ordered)).toBe(hashStartRunRequest(request(), { ...ordered, agentRevision: undefined }));
  });

  it('拒绝非法身份、agent/key，并为非 JSON trigger/context 保留 cause', async () => {
    const { store } = await createFakeRuntimeStore();
    const usecase = start(store);
    const invalidRequests: RuntimeRequestContext[] = [
      request({ tenantId: ' ' }),
      request({ principal: { principalId: '', roles: [] } }),
      request({ principal: { principalId: 'user-1', roles: null as never } }),
    ];
    for (const invalidRequest of invalidRequests) {
      await expectCode(() => usecase.execute(invalidRequest, input()), 'INVALID_INPUT');
    }
    await expectCode(() => usecase.execute(request(), { ...input(), agentId: '' }), 'INVALID_INPUT');
    await expectCode(() => usecase.execute(request(), { ...input(), idempotencyKey: ' ' }), 'INVALID_INPUT');
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const error = await expectCode(() => usecase.execute(request(), {
      ...input(), trigger: { type: 'task', input: circular },
    }), 'INVALID_INPUT');
    expect(error.cause).toBeTruthy();
  });

  it('每次 execute 只读取一次 clock，且各时间值彼此隔离', async () => {
    const { store } = await createFakeRuntimeStore();
    let calls = 0;
    const run = await start(store, { now: () => { calls += 1; return instant; } }).execute(request(), input());
    expect(calls).toBe(1);
    expect(run.createdAt).not.toBe(run.updatedAt);
    const event = (await store.listEvents(run.runId))[0]!;
    expect(event.occurredAt).not.toBe(run.createdAt);
  });
});
