import { describe, expect, it, vi } from 'vitest';
import type { AgentDefinition } from '../src/domain/agent-definition/types.js';
import type { AgentDefinitionProvider } from '../src/sdk/agent-definition-provider.js';
import type { RuntimeStorageProvider } from '../src/sdk/runtime-storage-provider.js';
import { createAgentRuntime } from '../src/assembly/agent-runtime-assembly.js';
import { createFakeAssembly } from './helpers/fake-di.js';
import { createFakeRuntimeStore } from './helpers/fake-runtime-store.js';
import { RecordingToolProvider } from '../src/execution/recording-tool-provider.js';
import { StaticToolProvider } from '../src/plugins/tool/static/index.js';
import { Type } from '@sinclair/typebox';
import { resolveRuntimeConfigLayers } from '../src/execution/runtime-config-layers.js';
import { RunCompletion } from '../src/execution/run-completion.js';

const definition: AgentDefinition = {
  agentId: 'assistant', revision: '1', name: 'Assistant', instructions: 'Help',
  modelId: 'mock/mock-model', toolNames: [], acceptedTriggers: ['task'],
  execution: { type: 'single-agent' },
};

const definitions = (init: () => Promise<void>): AgentDefinitionProvider => ({
  init,
  get: async () => definition,
  list: async () => [definition],
});

describe('runtime review regressions', () => {
  it('waits for in-flight initialization before shutdown completes', async () => {
    const assembly = await createFakeAssembly();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const runtime = createAgentRuntime({
      models: assembly.models, config: assembly.runtimeConfigProvider, executionRoot: assembly.executionRoot,
      agentDefinitions: definitions(() => gate),
      worker: { pollMs: 60_000 },
    });

    const initializing = runtime.initialize();
    await Promise.resolve();
    let shutdownFinished = false;
    const shuttingDown = runtime.shutdown().then(() => { shutdownFinished = true; });
    let concurrentShutdownFinished = false;
    const concurrentShutdown = runtime.shutdown().then(() => { concurrentShutdownFinished = true; });
    await Promise.resolve();
    expect(shutdownFinished).toBe(false);
    expect(concurrentShutdownFinished).toBe(false);

    release();
    await initializing;
    await Promise.all([shuttingDown, concurrentShutdown]);
    expect(() => runtime.as({ tenantId: 'tenant', principal: { principalId: 'user' } }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });

  it('does not initialize an injected Storage after shutdown wins the race', async () => {
    const assembly = await createFakeAssembly();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { store } = await createFakeRuntimeStore();
    const init = vi.fn(async () => {});
    const storage = { init, close: vi.fn(async () => {}), checkHealth: vi.fn(async () => {}), runtimeStore: store } as unknown as RuntimeStorageProvider;
    const runtime = createAgentRuntime({ models: assembly.models, config: assembly.runtimeConfigProvider, executionRoot: assembly.executionRoot, storage, agentDefinitions: definitions(() => gate), worker: { pollMs: 60_000 } });
    const initializing = runtime.initialize();
    await Promise.resolve();
    await runtime.shutdown();
    release();
    await initializing;
    expect(init).not.toHaveBeenCalled();
  });

  it('initializes the actual injected StorageProvider', async () => {
    const assembly = await createFakeAssembly();
    const { store } = await createFakeRuntimeStore();
    const init = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    const storage = { init, close, checkHealth: vi.fn(async () => {}), runtimeStore: store } as unknown as RuntimeStorageProvider;
    const runtime = createAgentRuntime({
      models: assembly.models, config: assembly.runtimeConfigProvider, executionRoot: assembly.executionRoot,
      storage, agentDefinitions: definitions(async () => {}), worker: { pollMs: 60_000 },
    });

    await runtime.initialize();
    expect(init).toHaveBeenCalledTimes(1);
    await runtime.shutdown();
    expect(close).not.toHaveBeenCalled();
  });

  it('uses an injected StorageProvider when no assembly is supplied', async () => {
    const { store } = await createFakeRuntimeStore();
    const init = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    const storage = { init, close, checkHealth: vi.fn(async () => {}), runtimeStore: store } as unknown as RuntimeStorageProvider;
    const runtime = createAgentRuntime({ storage, agentDefinitions: definitions(async () => {}), worker: { pollMs: 60_000 } });

    await runtime.initialize();
    expect(init).toHaveBeenCalledTimes(1);
    await runtime.shutdown();
    expect(close).not.toHaveBeenCalled();
  });

  it('reuses a persisted successful tool result without calling the provider again', async () => {
    const { store } = await createFakeRuntimeStore();
    const at = new Date('2026-08-13T00:00:00.000Z');
    const run = {
      runId: 'run', tenantId: 'tenant', principalId: 'user', sessionId: 'session', agentId: 'agent', agentRevision: '1',
      status: 'running' as const, trigger: { type: 'task' as const, input: null },
      contextSnapshot: { items: [], configLayers: [], promptSections: [] }, createdAt: at, updatedAt: at,
    };
    await store.transaction((uow) => {
      uow.sessions.insert({ sessionId: 'session', tenantId: 'tenant', contexts: { bindings: [] }, createdAt: at, updatedAt: at });
      uow.runs.insert(run);
    });
    let calls = 0;
    const provider = new RecordingToolProvider({
      storage: store, run, allowedToolNames: ['lookup'],
      provider: new StaticToolProvider([{ definition: { name: 'lookup', description: 'lookup', parameters: Type.Object({ id: Type.String() }) },
        executor: async () => { calls += 1; return { output: 'cached' }; } }]),
    });
    const call = { toolCallId: 'call', toolName: 'lookup', input: { id: '1' } };
    await expect(provider.execute([call], { cwd: '/', executionRoot: '/' })).resolves.toMatchObject([{ output: 'cached' }]);
    await expect(provider.execute([call], { cwd: '/', executionRoot: '/' })).resolves.toMatchObject([{ output: 'cached' }]);
    expect(calls).toBe(1);
  });

  it('merges contextual config layers into the run-scoped config surface', async () => {
    const assembly = await createFakeAssembly();
    const resolved = resolveRuntimeConfigLayers(assembly.runtimeConfigProvider, definition, [
      { name: 'low', priority: 1, value: { name: 'Layer Agent', maxTurns: 3, custom: { enabled: true } } },
      { name: 'high', priority: 2, value: { maxTurns: 7, orchestration: { maxDepth: 2 }, custom: { mode: 'strict' } } },
    ]);
    expect(resolved.behavior).toMatchObject({ name: 'Layer Agent', maxTurns: 7 });
    expect(resolved.orchestration.maxDepth).toBe(2);
    expect(resolved.config).toMatchObject({ name: 'Layer Agent', maxTurns: 7, custom: { enabled: true, mode: 'strict' } });
  });

  it('omits optional undefined model fields before canonical serialization', async () => {
    const assembly = await createFakeAssembly();
    const provider = new Proxy(assembly.runtimeConfigProvider, {
      get(target, property, receiver) {
        if (property === 'resolveModel') {
          return () => ({ provider: 'mock', model: 'mock-model', apiKey: 'mock-key', baseURL: undefined });
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const resolved = resolveRuntimeConfigLayers(provider, definition, []);

    expect(resolved.model).toEqual({ provider: 'mock', model: 'mock-model', apiKey: 'mock-key' });
    expect(resolved.config.model).toEqual({ provider: 'mock', model: 'mock-model', apiKey: 'mock-key' });
  });

  it('keeps an unknown tool side effect in waiting during a late success race', async () => {
    const { store } = await createFakeRuntimeStore();
    const at = new Date('2026-08-13T00:00:00.000Z');
    const run = {
      runId: 'waiting-run', tenantId: 'tenant', principalId: 'user', sessionId: 'session', agentId: 'agent', agentRevision: '1',
      status: 'running' as const, trigger: { type: 'task' as const, input: null },
      contextSnapshot: { items: [], configLayers: [], promptSections: [] }, createdAt: at, updatedAt: at,
    };
    await store.transaction((uow) => {
      uow.sessions.insert({ sessionId: 'session', tenantId: 'tenant', contexts: { bindings: [] }, createdAt: at, updatedAt: at });
      uow.runs.insert(run);
      uow.workItems.insert({ workItemId: 'work', runId: run.runId, status: 'leased', leaseOwner: 'owner', leaseExpiresAt: new Date(at.getTime() + 60_000), attempt: 1, createdAt: at, updatedAt: at });
      uow.toolInvocations.insert({ invocationId: 'invocation', tenantId: 'tenant', sessionId: 'session', runId: run.runId, toolCallId: 'call', toolName: 'tool', status: 'unknown', sideEffect: 'non-idempotent', supportsIdempotencyKey: false, input: {}, error: 'Tool result is unknown', createdAt: at, updatedAt: at });
    });
    const completion = new RunCompletion(store, { owner: 'owner', leaseMs: 60_000, pollMs: 60_000, runTimeoutMs: 60_000, now: () => at, generateId: () => 'event' });
    await expect(completion.succeed({ workItemId: 'work', runId: run.runId, status: 'leased', leaseOwner: 'owner', leaseExpiresAt: new Date(at.getTime() + 60_000), attempt: 1, createdAt: at, updatedAt: at }, { sessionEntries: [], artifacts: [] })).resolves.toBe(true);
    expect(await store.getRun(run.runId)).toMatchObject({ status: 'waiting', waitingReason: 'tool-result-unknown' });
  });
});
