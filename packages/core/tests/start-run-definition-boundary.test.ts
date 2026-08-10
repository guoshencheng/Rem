import type { AgentDefinition } from '../src/domain/agent-definition/types.js';
import type { AgentDefinitionProvider } from '../src/sdk/agent-definition-provider.js';
import type { RuntimePlugin } from '../src/sdk/runtime-plugin.js';
import type { RuntimeStorage } from '../src/sdk/runtime-storage.js';
import { describe, expect, it } from 'vitest';
import { ContextResolver } from '../src/application/contexts/context-resolver.js';
import { StartRunUsecase } from '../src/application/runs/start-run.js';
import { RuntimeError } from '../src/application/runtime/runtime-error.js';
import { RuntimePluginHost } from '../src/plugin-system/runtime-plugin-host.js';
import { createFakeRuntimeStore } from './helpers/fake-runtime-store.js';

const instant = new Date('2026-08-10T01:02:03.000Z');
const request = {
  tenantId: 'tenant-1', principal: { principalId: 'user-1', roles: ['member'] },
};
const validDefinition = (): AgentDefinition => ({
  agentId: 'assistant', revision: '1', name: 'Assistant', instructions: 'Help', modelId: 'model',
  toolNames: [], acceptedTriggers: ['task'], requiredContexts: [{ type: 'customer', max: 1 }],
  execution: { type: 'single-agent' },
});

function provider(value: unknown): AgentDefinitionProvider {
  return {
    init: async () => {}, list: async () => [],
    get: async () => value as AgentDefinition,
  };
}

function customerPlugin(wait?: () => Promise<void>): RuntimePlugin {
  return {
    manifest: { pluginId: 'customer-plugin', version: '1' },
    register: ({ addContextType }) => addContextType({
      type: 'customer',
      resolve: async ({ binding }) => {
        await wait?.();
        return { snapshot: { contextId: binding.contextId } };
      },
      materialize: async () => ({}),
    }),
  };
}

function start(storage: RuntimeStorage, definition: unknown, plugin = customerPlugin()): StartRunUsecase {
  let id = 0;
  return new StartRunUsecase({
    storage, agentDefinitions: provider(definition),
    contextResolver: new ContextResolver(new RuntimePluginHost([plugin])),
    now: () => instant, generateId: () => `id-${++id}`,
  });
}

const input = (revision?: string) => ({
  agentId: 'assistant', ...(revision === undefined ? {} : { agentRevision: revision }),
  trigger: { type: 'task' as const, input: null },
  contexts: { add: [{ type: 'customer', contextId: 'customer-1' }] },
});

async function expectInternal(action: () => Promise<unknown>): Promise<RuntimeError> {
  const error = await action().catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(RuntimeError);
  expect(error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'Agent definition is invalid' });
  expect((error as RuntimeError).cause).toBeDefined();
  return error as RuntimeError;
}

describe('StartRun AgentDefinition 边界', () => {
  it.each([
    ['empty revision', { ...validDefinition(), revision: ' ' }, input()],
    ['wrong agentId', { ...validDefinition(), agentId: 'other' }, input()],
    ['wrong explicit revision', { ...validDefinition(), revision: '2' }, input('1')],
    ['invalid trigger item', { ...validDefinition(), acceptedTriggers: ['other'] }, input()],
    ['duplicate trigger', { ...validDefinition(), acceptedTriggers: ['task', 'task'] }, input()],
    ['invalid tool item', { ...validDefinition(), toolNames: [''] }, input()],
    ['duplicate tool', { ...validDefinition(), toolNames: ['search', 'search'] }, input()],
    ['invalid execution', { ...validDefinition(), execution: { type: 'multi-agent' } }, input()],
    ['invalid constraints', { ...validDefinition(), requiredContexts: [{ type: 'customer', min: 2, max: 1 }] }, input()],
  ])('Provider 返回 %s 时映射为安全内部错误', async (_name, definition, runInput) => {
    const { store } = await createFakeRuntimeStore();
    await expectInternal(() => start(store, definition).execute(request, runInput));
  });

  it.each(['toolNames', 'acceptedTriggers', 'requiredContexts'] as const)('拒绝稀疏 %s', async (field) => {
    const sparse: unknown[] = [];
    sparse[1] = field === 'requiredContexts' ? { type: 'customer' } : field === 'acceptedTriggers' ? 'task' : 'search';
    const { store } = await createFakeRuntimeStore();
    await expectInternal(() => start(store, { ...validDefinition(), [field]: sparse }).execute(request, input()));
  });

  it('在 Resolver await 前同步固定 Definition 深快照', async () => {
    const { store } = await createFakeRuntimeStore();
    const definition = validDefinition();
    let entered!: () => void; let release!: () => void;
    const resolverEntered = new Promise<void>((resolve) => { entered = resolve; });
    const resolverRelease = new Promise<void>((resolve) => { release = resolve; });
    const usecase = start(store, definition, customerPlugin(async () => { entered(); await resolverRelease; }));

    const pending = usecase.execute(request, input());
    await resolverEntered;
    const mutable = definition as unknown as {
      revision: string;
      acceptedTriggers: string[];
      requiredContexts: Array<{ type: string; max?: number }>;
    };
    mutable.revision = 'mutated';
    mutable.acceptedTriggers.length = 0;
    mutable.requiredContexts[0]!.max = 0;
    release();
    const run = await pending;

    expect(run).toMatchObject({ agentRevision: '1', contextSnapshot: { items: [{ binding: { type: 'customer' } }] } });
    expect(await store.getRun(run.runId)).toEqual(run);
    expect((await store.listEvents(run.runId))[0]?.data).toMatchObject({ agentRevision: '1' });
  });
});
