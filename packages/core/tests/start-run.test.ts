import type { AgentDefinition } from '../src/domain/agent-definition/types.js';
import type { ContextBinding } from '../src/domain/context/types.js';
import type { RuntimeRequestContext } from '../src/domain/identity/types.js';
import type { RuntimePlugin } from '../src/sdk/runtime-plugin.js';
import type { RuntimeStorage } from '../src/sdk/runtime-storage.js';
import { describe, expect, it } from 'vitest';
import { ContextResolver } from '../src/application/contexts/context-resolver.js';
import { StartRunUsecase } from '../src/application/runs/start-run.js';
import { RuntimePluginHost } from '../src/plugin-system/runtime-plugin-host.js';
import { StaticAgentDefinitionProvider } from '../src/plugins/agent-definition/static/provider.js';
import { createFakeRuntimeStore } from './helpers/fake-runtime-store.js';

const instant = new Date('2026-08-10T01:02:03.000Z');
const request = (tenantId = 'tenant-1'): RuntimeRequestContext => ({
  tenantId,
  principal: { principalId: 'user-1', roles: ['member'], claims: { trace: 'x' } },
});
const binding = (type: string, contextId: string, input?: unknown): ContextBinding => ({
  type, contextId, ...(input === undefined ? {} : { input }),
});
const definition = (changes: Partial<AgentDefinition> = {}): AgentDefinition => ({
  agentId: 'assistant', revision: '7', name: 'Assistant', instructions: 'Help', modelId: 'model',
  toolNames: [], acceptedTriggers: ['task'], execution: { type: 'single-agent' }, ...changes,
});
const plugin = (type: string): RuntimePlugin => ({
  manifest: { pluginId: `plugin/${type}`, version: '1' },
  register: ({ addContextType }) => addContextType({
    type,
    resolve: async ({ binding: value }) => ({
      snapshot: { contextId: value.contextId, ...(value.input === undefined ? {} : { input: value.input }) },
    }),
    materialize: async () => ({}),
  }),
});

function usecase(storage: RuntimeStorage, agent = definition(), types = ['customer'], ids?: string[]): StartRunUsecase {
  let id = 0;
  return new StartRunUsecase({
    storage,
    agentDefinitions: new StaticAgentDefinitionProvider([agent]),
    contextResolver: new ContextResolver(new RuntimePluginHost(types.map(plugin))),
    now: () => instant,
    generateId: () => ids?.[id++] ?? `id-${++id}`,
  });
}

async function expectCode(action: () => unknown | Promise<unknown>, code: string): Promise<void> {
  await expect(action()).rejects.toMatchObject({ code });
}

describe('StartRunUsecase', () => {
  it('用隐式 Session 原子创建 queued run、首事件、work item 与幂等记录', async () => {
    const { store } = await createFakeRuntimeStore();
    const ids = ['session-1', 'run-1', 'event-1', 'work-1'];
    const run = await usecase(store, definition({ requiredContexts: [{ type: 'customer' }] }), ['customer'], ids)
      .execute(request(), {
        agentId: 'assistant', trigger: { type: 'task', input: { question: 'hello' } },
        contexts: { add: [binding('customer', 'c-1', { level: 2 })] }, idempotencyKey: 'request-1',
      });

    expect(run).toMatchObject({
      runId: 'run-1', sessionId: 'session-1', tenantId: 'tenant-1', principalId: 'user-1',
      agentId: 'assistant', agentRevision: '7', status: 'queued', createdAt: instant, updatedAt: instant,
      contextSnapshot: { items: [{ binding: binding('customer', 'c-1', { level: 2 }) }] },
    });
    expect(new Set(ids)).toHaveLength(4);
    expect(await store.getSession('session-1')).toEqual({
      sessionId: 'session-1', tenantId: 'tenant-1',
      contexts: { bindings: [binding('customer', 'c-1', { level: 2 })] }, version: 0, createdAt: instant, updatedAt: instant,
    });
    expect(await store.getRun('run-1')).toEqual(run);
    expect(await store.listEvents('run-1')).toEqual([{
      eventId: 'event-1', sequence: 1, schemaVersion: 1, tenantId: 'tenant-1',
      sessionId: 'session-1', runId: 'run-1', type: 'run.created', occurredAt: instant,
      data: { agentId: 'assistant', agentRevision: '7', triggerType: 'task' },
    }]);
    await store.transaction((uow) => {
      expect(uow.workItems.getByRun('run-1')).toEqual({
        workItemId: 'work-1', runId: 'run-1', status: 'queued', attempt: 0,
        createdAt: instant, updatedAt: instant,
      });
      expect(uow.idempotency.get('tenant-1', 'start-run', 'request-1')).toMatchObject({ resourceId: 'run-1' });
    });
  });

  it('基于已有同租户 Session add/replace，但不修改 Session contexts', async () => {
    const { store } = await createFakeRuntimeStore();
    const original = { bindings: [binding('customer', 'old'), binding('note', 'n-1')] };
    await store.transaction((uow) => uow.sessions.insert({
      sessionId: 'existing', tenantId: 'tenant-1', contexts: original, createdAt: instant, updatedAt: instant,
    }));
    const run = await usecase(store, definition({
      overridableContexts: ['customer'], optionalContexts: [{ type: 'customer' }, { type: 'note', max: 2 }],
    }), ['customer', 'note'], ['run-1', 'event-1', 'work-1']).execute(request(), {
      agentId: 'assistant', sessionId: 'existing', trigger: { type: 'task', input: null },
      contexts: { replace: { customer: [binding('customer', 'new')] }, add: [binding('note', 'n-2')] },
    });

    expect(run.contextSnapshot.items.map((item) => item.binding)).toEqual([
      binding('note', 'n-1'), binding('customer', 'new'), binding('note', 'n-2'),
    ]);
    expect((await store.getSession('existing'))?.contexts).toEqual(original);
  });

  it('拒绝未授权 replace、跨租户与缺失 Session', async () => {
    const { store } = await createFakeRuntimeStore();
    await store.transaction((uow) => uow.sessions.insert({
      sessionId: 'other', tenantId: 'tenant-2', contexts: { bindings: [] }, createdAt: instant, updatedAt: instant,
    }));
    await expectCode(() => usecase(store).execute(request(), {
      agentId: 'assistant', trigger: { type: 'task', input: null },
      contexts: { replace: { customer: [binding('customer', 'new')] } },
    }), 'CONTEXT_CONFLICT');
    for (const sessionId of ['other', 'missing']) {
      await expectCode(() => usecase(store).execute(request(), {
        agentId: 'assistant', sessionId, trigger: { type: 'task', input: null },
      }), 'SESSION_NOT_FOUND');
    }
  });

  it('区分未知 agent/revision，并拒绝未接受的 trigger', async () => {
    const { store } = await createFakeRuntimeStore();
    const start = usecase(store);
    await expectCode(() => start.execute(request(), { agentId: 'missing', trigger: { type: 'task', input: null } }), 'AGENT_NOT_FOUND');
    await expectCode(() => start.execute(request(), { agentId: 'assistant', agentRevision: 'missing', trigger: { type: 'task', input: null } }), 'AGENT_REVISION_NOT_FOUND');
    await expectCode(() => start.execute(request(), { agentId: 'assistant', trigger: { type: 'message', content: 'hello' } }), 'TRIGGER_NOT_SUPPORTED');
  });

  it('执行 required/optional 数量约束并拒绝未声明 Context type', async () => {
    const { store } = await createFakeRuntimeStore();
    const constrained = definition({
      requiredContexts: [{ type: 'customer', min: 1, max: 2 }],
      optionalContexts: [{ type: 'note', max: 1 }],
    });
    const start = usecase(store, constrained, ['customer', 'note', 'extra']);
    const call = (bindings: ContextBinding[]) => start.execute(request(), {
      agentId: 'assistant', trigger: { type: 'task', input: null }, contexts: { add: bindings },
    });
    await expect(call([])).rejects.toMatchObject({
      code: 'CONTEXT_CONFLICT',
      details: { reason: 'required', type: 'customer', min: 1, max: 2, actual: 0 },
    });
    await expect(call([binding('customer', '1'), binding('customer', '2'), binding('customer', '3')]))
      .rejects.toMatchObject({
        code: 'CONTEXT_CONFLICT',
        details: { reason: 'limit', type: 'customer', min: 1, max: 2, actual: 3 },
      });
    await expect(call([binding('customer', '1'), binding('note', '1'), binding('note', '2')]))
      .rejects.toMatchObject({
        code: 'CONTEXT_CONFLICT',
        details: { reason: 'limit', type: 'note', min: 0, max: 1, actual: 2 },
      });
    await expectCode(() => call([binding('customer', '1'), binding('extra', '1')]), 'CONTEXT_CONFLICT');
  });

  it('optional Context 未出现时不执行显式 min，出现后执行 min/max', async () => {
    const { store } = await createFakeRuntimeStore();
    const start = usecase(store, definition({ optionalContexts: [{ type: 'note', min: 2, max: 3 }] }), ['note']);
    await expect(start.execute(request(), {
      agentId: 'assistant', trigger: { type: 'task', input: null },
    })).resolves.toMatchObject({ status: 'queued' });
    await expect(start.execute(request(), {
      agentId: 'assistant', trigger: { type: 'task', input: null },
      contexts: { add: [binding('note', '1')] },
    })).rejects.toMatchObject({
      code: 'CONTEXT_CONFLICT',
      details: { reason: 'required', type: 'note', min: 2, max: 3, actual: 1 },
    });
  });

  it.each([
    { requiredContexts: [{ type: 'x' }], optionalContexts: [{ type: 'x' }] },
    { requiredContexts: [{ type: 'x', min: -1 }] },
    { requiredContexts: [{ type: 'x', min: 0.5 }] },
    { requiredContexts: [{ type: 'x', min: 2, max: 1 }] },
    { optionalContexts: [{ type: 'x', max: Number.POSITIVE_INFINITY }] },
  ] satisfies Array<Partial<AgentDefinition>>)('拒绝非法 Definition Context 约束 %#', async (constraints) => {
    const { store } = await createFakeRuntimeStore();
    await expectCode(() => usecase(store, definition(constraints), ['x']).execute(request(), {
      agentId: 'assistant', trigger: { type: 'task', input: null }, contexts: { add: [binding('x', '1')] },
    }), 'INTERNAL_ERROR');
  });

  it('ContextResolver 失败时不创建任何资源', async () => {
    const { store } = await createFakeRuntimeStore();
    await expectCode(() => usecase(store, definition(), []).execute(request(), {
      agentId: 'assistant', trigger: { type: 'task', input: null },
      contexts: { add: [binding('unknown', '1')] }, idempotencyKey: 'key',
    }), 'CONTEXT_TYPE_NOT_FOUND');
    expect(await store.getRun('id-2')).toBeNull();
    expect(await store.getSession('id-1')).toBeNull();
    await store.transaction((uow) => expect(uow.idempotency.get('tenant-1', 'start-run', 'key')).toBeNull());
  });
});
