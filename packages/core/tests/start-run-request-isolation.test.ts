import type { AgentDefinition } from '../src/domain/agent-definition/types.js';
import type { RuntimeRequestContext } from '../src/domain/identity/types.js';
import type { AgentDefinitionProvider } from '../src/sdk/agent-definition-provider.js';
import type { RuntimePlugin } from '../src/sdk/runtime-plugin.js';
import type { RuntimeStorage } from '../src/sdk/runtime-storage.js';
import { describe, expect, it } from 'vitest';
import { ContextResolver } from '../src/application/contexts/context-resolver.js';
import { hashStartRunRequest } from '../src/application/runs/start-run-hash.js';
import { StartRunUsecase } from '../src/application/runs/start-run.js';
import { RuntimeError } from '../src/application/runtime/runtime-error.js';
import { RuntimePluginHost } from '../src/plugin-system/runtime-plugin-host.js';
import { createFakeRuntimeStore } from './helpers/fake-runtime-store.js';

const instant = new Date('2026-08-10T01:02:03.000Z');
const definition: AgentDefinition = {
  agentId: 'assistant', revision: '1', name: 'Assistant', instructions: 'Help', modelId: 'model',
  toolNames: [], acceptedTriggers: ['task'], execution: { type: 'single-agent' },
};
const request = (claims?: Record<string, unknown>): RuntimeRequestContext => ({
  tenantId: 'tenant-1',
  principal: { principalId: 'user-1', roles: ['member'], ...(claims === undefined ? {} : { claims }) },
});
const input = () => ({
  agentId: 'assistant', trigger: { type: 'task' as const, input: { task: { value: 1 } } },
  contexts: { add: [{ type: 'customer', contextId: 'customer-1', input: { tier: 1 } }] },
  idempotencyKey: 'key-1',
});

function plugin(resolve: (request: RuntimeRequestContext, bindingInput: unknown) => unknown): RuntimePlugin {
  return {
    manifest: { pluginId: 'customer-plugin', version: '1' },
    register: ({ addContextType }) => addContextType({
      type: 'customer',
      resolve: async ({ request: current, binding }) => ({ snapshot: resolve(current, binding.input) }),
      materialize: async () => ({}),
    }),
  };
}

function observedStorage(storage: RuntimeStorage, call: () => void): RuntimeStorage {
  return new Proxy(storage, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => { call(); return Reflect.apply(value, target, args); };
    },
  });
}

describe('StartRun request 入口快照', () => {
  it.each([
    ['null', null, false],
    ['array', [], false],
    ['Date', new Date(), true],
    ['class', new (class Claims { value = 1; })(), true],
    ['undefined', { value: undefined }, true],
    ['function', { value: () => {} }, true],
    ['symbol', { value: Symbol('x') }, true],
    ['bigint', { value: 1n }, true],
    ['non-finite', { value: Number.POSITIVE_INFINITY }, true],
    ['prototype object', Object.create({ inherited: true }) as object, true],
    ['sparse nested array', { values: Object.assign(new Array(2), { 1: 'x' }) }, true],
  ])('拒绝非法 claims：%s', async (_name, claims, hasCause) => {
    const created = await createFakeRuntimeStore();
    let storageCalls = 0; let clockCalls = 0; let idCalls = 0; let providerCalls = 0; let pluginCalls = 0;
    const provider: AgentDefinitionProvider = {
      init: async () => {}, list: async () => [definition],
      get: async () => { providerCalls += 1; return definition; },
    };
    const start = new StartRunUsecase({
      storage: observedStorage(created.store, () => { storageCalls += 1; }),
      agentDefinitions: provider,
      contextResolver: new ContextResolver(new RuntimePluginHost([plugin(() => { pluginCalls += 1; return {}; })])),
      now: () => { clockCalls += 1; return instant; },
      generateId: () => { idCalls += 1; return `id-${idCalls}`; },
    });
    const error = await start.execute(request(claims as never), input()).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RuntimeError);
    expect(error).toMatchObject({ code: 'INVALID_INPUT' });
    if (hasCause) expect((error as RuntimeError).cause).toBeTruthy();
    expect({ storageCalls, clockCalls, idCalls, providerCalls, pluginCalls }).toEqual({
      storageCalls: 0, clockCalls: 0, idCalls: 0, providerCalls: 0, pluginCalls: 0,
    });
    expect(await created.store.getRun('id-2')).toBeNull();
  });

  it('拒绝循环/accessor claims 与稀疏 roles，且 accessor 不执行', async () => {
    const invalidValues: Array<{ request: RuntimeRequestContext; reads?: () => number }> = [];
    const circular: Record<string, unknown> = {}; circular.self = circular;
    invalidValues.push({ request: request(circular) });
    let reads = 0;
    const accessor = Object.defineProperty({}, 'secret', { enumerable: true, get: () => { reads += 1; return 'x'; } });
    invalidValues.push({ request: request(accessor), reads: () => reads });
    const sparse: string[] = []; sparse[1] = 'member';
    invalidValues.push({ request: { tenantId: 'tenant-1', principal: { principalId: 'user-1', roles: sparse } } });

    for (const value of invalidValues) {
      const { store } = await createFakeRuntimeStore();
      let dependencyCalls = 0;
      const error = await new StartRunUsecase({
        storage: observedStorage(store, () => { dependencyCalls += 1; }),
        agentDefinitions: { init: async () => {}, list: async () => [], get: async () => { dependencyCalls += 1; return definition; } },
        contextResolver: new ContextResolver(new RuntimePluginHost()),
        now: () => { dependencyCalls += 1; return instant; },
      }).execute(value.request, input()).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ code: 'INVALID_INPUT', cause: expect.anything() });
      expect(dependencyCalls).toBe(0);
      expect(value.reads?.() ?? 0).toBe(0);
    }
  });

  it('在入口固定 request/input，跨 storage 与 provider await 的外部变异不可见', async () => {
    const { store } = await createFakeRuntimeStore();
    let providerEntered!: () => void; let releaseProvider!: () => void;
    const entered = new Promise<void>((resolve) => { providerEntered = resolve; });
    const release = new Promise<void>((resolve) => { releaseProvider = resolve; });
    const seen: unknown[] = [];
    const provider: AgentDefinitionProvider = {
      init: async () => {}, list: async () => [definition],
      get: async () => { providerEntered(); await release; return definition; },
    };
    const dangerousClaims = Object.defineProperty({ nested: { value: 'original' } }, '__proto__', {
      value: { safe: true }, enumerable: true, writable: true, configurable: true,
    });
    const mutableRequest = request(dangerousClaims);
    const mutableInput = input();
    const expectedHash = hashStartRunRequest(mutableRequest, mutableInput);
    const start = new StartRunUsecase({
      storage: store, agentDefinitions: provider,
      contextResolver: new ContextResolver(new RuntimePluginHost([plugin((current, bindingInput) => {
        seen.push({ roles: current.principal.roles, claims: current.principal.claims, bindingInput });
        return seen[0];
      })])),
      now: () => instant,
      generateId: (() => { let id = 0; return () => `id-${++id}`; })(),
    });

    const pending = start.execute(mutableRequest, mutableInput);
    mutableRequest.principal.roles[0] = 'immediate-change';
    (mutableInput.trigger.input.task as { value: number }).value = 2;
    await entered;
    (mutableRequest.principal.claims!.nested as { value: string }).value = 'await-change';
    (mutableInput.contexts.add[0]!.input as { tier: number }).tier = 9;
    releaseProvider();
    const run = await pending;

    expect(seen).toEqual([{
      roles: ['member'],
      claims: expect.objectContaining({ nested: { value: 'original' } }),
      bindingInput: { tier: 1 },
    }]);
    const seenClaims = (seen[0] as { claims: Record<string, unknown> }).claims;
    expect(Object.hasOwn(seenClaims, '__proto__')).toBe(true);
    expect(seenClaims.__proto__).toEqual({ safe: true });
    expect(run.trigger).toEqual({ type: 'task', input: { task: { value: 1 } } });
    expect((await store.getSession(run.sessionId))?.contexts.bindings[0]?.input).toEqual({ tier: 1 });
    expect(Object.prototype).not.toHaveProperty('safe');
    await store.transaction((uow) => {
      expect(uow.idempotency.get('tenant-1', 'start-run', 'key-1')?.requestHash).toBe(expectedHash);
    });
  });
});
