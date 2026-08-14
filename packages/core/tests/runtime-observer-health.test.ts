import { describe, expect, it, vi } from 'vitest';
import { RuntimeObserverHub } from '../src/infrastructure/observability/runtime-observer-hub.js';
import { createAgentRuntime } from '../src/assembly/agent-runtime-assembly.js';
import { StaticAgentDefinitionProvider } from '../src/plugins/agent-definition/static/provider.js';
import type { AgentDefinition } from '../src/domain/agent-definition/types.js';
import type { RuntimeStorageProvider } from '../src/sdk/runtime-storage-provider.js';
import type { RuntimeObservation } from '../src/sdk/runtime-observer.js';
import { createFakeAssembly } from './helpers/fake-di.js';
import { createFakeRuntimeStore } from './helpers/fake-runtime-store.js';

const definition: AgentDefinition = {
  agentId: 'assistant', revision: '1', name: 'Assistant', instructions: 'Help', modelId: 'model',
  toolNames: [], acceptedTriggers: ['task'], execution: { type: 'single-agent' },
};

describe('Runtime observer and health', () => {
  it('按注册顺序深隔离事件，并吞掉同步/异步失败', async () => {
    const seen: unknown[] = [];
    const first = { observe: vi.fn((event: RuntimeObservation) => {
      seen.push(event); (event as { runId?: string }).runId = 'mutated';
      throw new Error('observer failure');
    }) };
    const second = { observe: vi.fn((event: RuntimeObservation) => {
      seen.push(event); return Promise.reject(new Error('async observer failure'));
    }) };
    const hub = new RuntimeObserverHub([first, second]);
    expect(() => hub.observe({ type: 'run.created', occurredAt: new Date(), runId: 'run-1' })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(first.observe).toHaveBeenCalledTimes(1);
    expect(second.observe).toHaveBeenCalledTimes(1);
    expect((seen[1] as { runId?: string }).runId).toBe('run-1');
    expect(() => new RuntimeObserverHub([{ get observe() { throw new Error('getter'); } } as never])).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });

  it('runtime health 在初始化、ready 和 shutdown 间返回稳定状态', async () => {
    const { store } = await createFakeRuntimeStore();
    const checkHealth = vi.fn(async () => {});
    const storage = { init: async () => {}, close: async () => {}, checkHealth, runtimeStore: store } as RuntimeStorageProvider;
    const assembly = await createFakeAssembly();
    const runtime = createAgentRuntime({
      agentDefinitions: new StaticAgentDefinitionProvider([definition]), storage,
      models: assembly.models, config: assembly.runtimeConfigProvider, worker: { owner: 'health-test', pollMs: 60_000 },
    });
    await expect(runtime.health()).resolves.toMatchObject({ status: 'degraded', checks: { runtime: 'not-ready' } });
    await runtime.initialize();
    await expect(runtime.health()).resolves.toMatchObject({ status: 'ready', checks: { storage: 'ok', worker: 'running' } });
    expect(checkHealth).toHaveBeenCalledTimes(1);
    await runtime.shutdown();
    await expect(runtime.health()).resolves.toMatchObject({ status: 'stopped', checks: { runtime: 'stopped' } });
  });

  it('运行期间投影脱敏的 lifecycle 与 model observation', async () => {
    const { store } = await createFakeRuntimeStore();
    const assembly = await createFakeAssembly();
    const events: RuntimeObservation[] = [];
    const storage = { init: async () => {}, close: async () => {}, checkHealth: async () => {}, runtimeStore: store } as RuntimeStorageProvider;
    const runtime = createAgentRuntime({
      agentDefinitions: new StaticAgentDefinitionProvider([definition]), storage, models: assembly.models,
      config: assembly.runtimeConfigProvider, observers: [{ observe: (event) => events.push(event) }],
      worker: { owner: 'observer-test', pollMs: 1 },
    });
    await runtime.initialize();
    const run = await runtime.as({ tenantId: 'tenant-a', principal: { principalId: 'user-a', roles: [] } })
      .runs.start({ agentId: 'assistant', trigger: { type: 'task', input: { text: 'secret prompt' } } });
    await runtime.as({ tenantId: 'tenant-a', principal: { principalId: 'user-a', roles: [] } }).runs.waitForCompletion(run.runId);
    const types = events.map((event) => event.type);
    expect(types).toEqual(expect.arrayContaining(['runtime.initializing', 'runtime.ready', 'run.created', 'run.started', 'model.started', 'model.completed', 'run.completed']));
    expect(JSON.stringify(events)).not.toContain('secret prompt');
    await runtime.shutdown();
    expect(events.map((event) => event.type)).toContain('runtime.shutdown');
  });
});
