import type { AgentDefinition } from '../src/domain/agent-definition/types.js';
import type { RuntimeRequestContext } from '../src/domain/identity/types.js';
import type { AgentDefinitionProvider } from '../src/sdk/agent-definition-provider.js';
import type { RuntimeStorage } from '../src/sdk/runtime-storage.js';
import { describe, expect, it } from 'vitest';
import { ContextResolver } from '../src/application/contexts/context-resolver.js';
import { StartRunUsecase } from '../src/application/runs/start-run.js';
import { RuntimeError } from '../src/application/runtime/runtime-error.js';
import { RuntimePluginHost } from '../src/plugin-system/runtime-plugin-host.js';
import { createFakeRuntimeStore } from './helpers/fake-runtime-store.js';

const instant = new Date('2026-08-10T01:02:03.000Z');
const request = (): RuntimeRequestContext => ({
  tenantId: 'tenant-1', principal: { principalId: 'user-1', roles: ['member'] },
});
const definition = (changes: Partial<AgentDefinition> = {}): AgentDefinition => ({
  agentId: 'assistant', revision: '1', name: 'Assistant', instructions: 'Help', modelId: 'model',
  toolNames: [], acceptedTriggers: ['task', 'message'], execution: { type: 'single-agent' }, ...changes,
});
const validInput = () => ({
  agentId: 'assistant', trigger: { type: 'task' as const, input: { value: 1 } }, idempotencyKey: 'key-1',
});

function usecase(storage: RuntimeStorage, agent = definition()): StartRunUsecase {
  const ids = ['session-1', 'run-1', 'event-1', 'work-1'];
  let index = 0;
  return new StartRunUsecase({
    storage, agentDefinitions: unsafeProvider(agent),
    contextResolver: new ContextResolver(new RuntimePluginHost()),
    now: () => instant, generateId: () => ids[index++]!,
  });
}

function unsafeProvider(agent: AgentDefinition): AgentDefinitionProvider {
  return { init: async () => {}, get: async () => agent, list: async () => [agent] };
}

async function expectInvalid(
  storage: RuntimeStorage,
  action: () => unknown | Promise<unknown>,
  cause = false,
): Promise<void> {
  await expectFailure(storage, action, 'INVALID_INPUT', cause);
}

async function expectFailure(
  storage: RuntimeStorage,
  action: () => unknown | Promise<unknown>,
  code: string,
  cause = false,
): Promise<void> {
  let error: RuntimeError;
  try { await action(); throw new Error('Expected RuntimeError'); }
  catch (caught) { error = caught as RuntimeError; }
  expect(error).toBeInstanceOf(RuntimeError);
  expect(error.code).toBe(code);
  if (cause) expect(error.cause).toBeTruthy();
  expect(await storage.getSession('session-1')).toBeNull();
  expect(await storage.getRun('run-1')).toBeNull();
  expect(await storage.listRecoverableWorkItems(new Date(instant.getTime() + 1))).toEqual([]);
  await storage.transaction((uow) => expect(uow.idempotency.get('tenant-1', 'start-run', 'key-1')).toBeNull());
}

describe('StartRun 外部输入运行时校验', () => {
  it.each([
    { tenantId: '', principal: { principalId: 'user-1', roles: [] } },
    { tenantId: 'tenant-1', principal: null },
    { tenantId: 'tenant-1', principal: { principalId: '', roles: [] } },
    { tenantId: 'tenant-1', principal: { principalId: 'user-1', roles: null } },
    { tenantId: 'tenant-1', principal: { principalId: 'user-1', roles: ['member', 1] } },
  ])('拒绝畸形 request %#', async (invalidRequest) => {
    const { store } = await createFakeRuntimeStore();
    await expectInvalid(store, () => usecase(store).execute(invalidRequest as never, validInput()));
  });

  it.each([
    { agentRevision: '' }, { agentRevision: 1 }, { sessionId: '' }, { sessionId: 1 },
  ])('拒绝畸形 revision/session %#', async (change) => {
    const { store } = await createFakeRuntimeStore();
    await expectInvalid(store, () => usecase(store).execute(request(), { ...validInput(), ...change } as never));
  });

  it.each([
    null,
    { type: 'event', data: {} },
    { type: 'task' },
    { type: 'task', input: {}, extra: true },
    { type: 'message' },
    { type: 'message', content: null },
    { type: 'message', content: [{ type: 'text' }] },
    { type: 'message', content: [{ type: 'image', data: 'x' }] },
    { type: 'message', content: [{ type: 'thinking', thinking: 1 }] },
    { type: 'message', content: [{ type: 'toolCall', id: '1', name: 'tool', arguments: [] }] },
  ])('拒绝畸形 trigger %#', async (trigger) => {
    const { store } = await createFakeRuntimeStore();
    await expectInvalid(store, () => usecase(store).execute(request(), { ...validInput(), trigger } as never));
  });

  it('接受领域允许的 message content 形状', async () => {
    const { store } = await createFakeRuntimeStore();
    await expect(usecase(store).execute(request(), {
      agentId: 'assistant', trigger: { type: 'message', content: [
        { type: 'text', text: 'hello' }, { type: 'image', data: 'abc', mimeType: 'image/png' },
      ] },
    })).resolves.toMatchObject({ status: 'queued', trigger: { type: 'message' } });
  });

  it('非 JSON trigger 保留 canonical cause 且零写入', async () => {
    const { store } = await createFakeRuntimeStore();
    const circular: { self?: unknown } = {}; circular.self = circular;
    await expectInvalid(store, () => usecase(store).execute(request(), {
      ...validInput(), trigger: { type: 'task', input: circular },
    }), true);
  });
});

describe('StartRun Definition 与 ContextPatch 形状校验', () => {
  it.each([
    { requiredContexts: null },
    { requiredContexts: [null] },
    { requiredContexts: [{ type: ' ' }] },
    { requiredContexts: [{ type: 'customer', min: 0 }] },
    { optionalContexts: 'bad' },
    { optionalContexts: [{ type: 'customer', min: -1 }] },
    { optionalContexts: [{ type: 'customer', max: Number.POSITIVE_INFINITY }] },
    { optionalContexts: [{ type: 'customer', min: 2, max: 1 }] },
    { overridableContexts: null },
    { overridableContexts: [' '] },
    { overridableContexts: ['customer', 'customer'] },
  ])('拒绝畸形 Definition Context 配置 %#', async (change) => {
    const { store } = await createFakeRuntimeStore();
    await expectFailure(
      store,
      () => usecase(store, definition(change as never)).execute(request(), validInput()),
      'INTERNAL_ERROR',
      true,
    );
  });

  it.each([
    null,
    { add: null },
    { add: {} },
    { add: [null] },
    { add: [{ type: '', contextId: '1' }] },
    { add: [{ type: 'customer' }] },
    { add: [{ type: 'customer', contextId: '1', revision: 1 }] },
    { add: [{ type: 'customer', contextId: '1', extra: true }] },
    { replace: null },
    { replace: [] },
    { replace: { customer: null } },
    { replace: { customer: {} } },
    { replace: { customer: [null] } },
    { remove: [] },
    { remove: null },
  ])('拒绝畸形 ContextPatch %#', async (contexts) => {
    const { store } = await createFakeRuntimeStore();
    await expectInvalid(store, () => usecase(store).execute(request(), { ...validInput(), contexts } as never));
  });

  it('Context binding 非 JSON input 保留 canonical cause 且零写入', async () => {
    const { store } = await createFakeRuntimeStore();
    await expectInvalid(store, () => usecase(store).execute(request(), {
      ...validInput(), contexts: { add: [{ type: 'customer', contextId: '1', input: new Date() }] },
    }), true);
  });

  it.each([
    { add: [{ type: 'customer', contextId: '1' }, { type: 'customer', contextId: '1' }] },
    { replace: { customer: [{ type: 'other', contextId: '1' }] } },
  ])('合法 Patch 的语义冲突映射为 CONTEXT_CONFLICT %#', async (contexts) => {
    const { store } = await createFakeRuntimeStore();
    const configured = definition({ overridableContexts: ['customer'] });
    await expect(usecase(store, configured).execute(request(), {
      ...validInput(), contexts,
    } as never)).rejects.toMatchObject({ code: 'CONTEXT_CONFLICT' });
    expect(await store.getRun('run-1')).toBeNull();
  });
});
