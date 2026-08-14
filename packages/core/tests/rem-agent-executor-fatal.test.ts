import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';
import type { AgentDefinition } from '../src/domain/agent-definition/types.js';
import type { RuntimePlugin } from '../src/sdk/runtime-plugin.js';
import type { RuntimeStorage } from '../src/sdk/runtime-storage.js';
import { SingleAgentRunExecutor, type SingleAgentRunExecutorOptions } from '../src/execution/single-agent-run-executor.js';
import { RuntimePluginHost } from '../src/plugin-system/runtime-plugin-host.js';
import { StaticAgentDefinitionProvider } from '../src/plugins/agent-definition/static/provider.js';
import { createFakeAssembly } from './helpers/fake-di.js';
import { createFakeRuntimeStore } from './helpers/fake-runtime-store.js';
import { createWorker } from './helpers/local-worker-fixture.js';
import { createScriptedModels, fauxAssistantMessage, fauxToolCall } from './helpers/scripted-models.js';

type TestExecutorOptions = Omit<SingleAgentRunExecutorOptions, 'models' | 'config' | 'executionRoot'>;
function makeExecutor(assembly: Awaited<ReturnType<typeof createFakeAssembly>>, options: TestExecutorOptions): SingleAgentRunExecutor {
  return new SingleAgentRunExecutor({ ...options, models: assembly.models, config: assembly.runtimeConfigProvider, executionRoot: assembly.executionRoot });
}

const at = new Date('2026-08-11T00:00:00Z');
const session = { sessionId: 's', tenantId: 't', contexts: { bindings: [] }, createdAt: at, updatedAt: at };
const definition: AgentDefinition = { agentId: 'a', revision: '1', name: 'a', instructions: 'a', modelId: 'mock/mock-model',
  toolNames: ['tool'], acceptedTriggers: ['message'], execution: { type: 'single-agent' } };
const item = { binding: { type: 'test/context', contextId: '1' }, pluginId: 'test', pluginVersion: '1', snapshot: {}, snapshotHash: 'hash' };
const run = { runId: 'r', tenantId: 't', principalId: 'p', sessionId: 's', agentId: 'a', agentRevision: '1', status: 'running' as const,
  trigger: { type: 'message' as const, content: 'go' }, contextSnapshot: { items: [item], configLayers: [], promptSections: [] }, createdAt: at, updatedAt: at };

async function seed() {
  const { store } = await createFakeRuntimeStore();
  await store.transaction((uow) => { uow.sessions.insert(session); uow.runs.insert(run); });
  return store;
}

async function seedQueued() {
  const { store } = await createFakeRuntimeStore();
  await store.transaction((uow) => {
    uow.sessions.insert(session);
    uow.runs.insert({ ...run, status: 'queued' });
    uow.events.append({ eventId: 'created', sequence: 1, schemaVersion: 1, tenantId: 't', sessionId: 's', runId: 'r',
      type: 'run.created', data: {}, occurredAt: at });
    uow.workItems.insert({ workItemId: 'work-r', runId: 'r', status: 'queued', attempt: 0, createdAt: at, updatedAt: at });
  });
  return store;
}

function plugin(execute: () => Promise<{ output: string }>): RuntimePlugin {
  return { manifest: { pluginId: 'test', version: '1' }, register(registrar) { registrar.addContextType({
    type: 'test/context', resolve: async () => ({ snapshot: {} }), materialize: async () => ({ tools: [{
      definition: { name: 'tool', description: 'tool', parameters: Type.Object({}) }, executor: execute,
    }] }),
  }); } };
}

function failTerminalTransaction(base: RuntimeStorage): RuntimeStorage {
  let transactions = 0;
  return { ...base, transaction: (async (operation: never) => {
    transactions += 1;
    if (transactions === 3) throw new Error('terminal storage failure');
    return base.transaction(operation);
  }) as RuntimeStorage['transaction'] } as RuntimeStorage;
}

describe('Single-agent fatal tool persistence channel', () => {
  it.each(['success', 'failure'])('poisons the run when %s terminal persistence fails', async (kind) => {
    const store = await seed(); let toolCalls = 0;
    const scripted = createScriptedModels([
      fauxAssistantMessage([fauxToolCall('tool', {})]),
      fauxAssistantMessage([fauxToolCall('tool', {})]),
      fauxAssistantMessage('must not complete'),
    ]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    const executor = makeExecutor(assembly, { storage: failTerminalTransaction(store),
      agentDefinitions: new StaticAgentDefinitionProvider([definition]), pluginHost: new RuntimePluginHost([plugin(async () => {
        toolCalls += 1;
        if (kind === 'failure') throw new Error('ordinary tool failure');
        return { output: 'done' };
      })]) });
    await expect(executor.execute({ run, session, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE', retryable: true, cause: expect.any(Error) });
    expect(toolCalls).toBe(1);
    expect(scripted.state.callCount).toBe(2);
    expect(await store.transaction((uow) => uow.toolInvocations.listByRun('r'))).toMatchObject([{ status: 'executing' }]);
    expect((await store.listEvents('r')).map((event) => event.type)).toEqual(['tool.started']);
  });

  it('settles promptly on abort, marks unknown, and ignores a late result', async () => {
    const store = await seed(); const controller = new AbortController();
    let resolveTool!: (value: { output: string }) => void;
    const pendingTool = new Promise<{ output: string }>((resolve) => { resolveTool = resolve; });
    const scripted = createScriptedModels([fauxAssistantMessage([fauxToolCall('tool', {})]), fauxAssistantMessage('must not complete')]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    let started!: () => void; const began = new Promise<void>((resolve) => { started = resolve; });
    const executor = makeExecutor(assembly, { storage: store,
      agentDefinitions: new StaticAgentDefinitionProvider([definition]), pluginHost: new RuntimePluginHost([plugin(async () => { started(); return pendingTool; })]) });
    const execution = executor.execute({ run, session, signal: controller.signal });
    await began; controller.abort();
    await expect(execution).rejects.toMatchObject({ code: 'EXECUTION_CANCELLED' });
    expect(await store.transaction((uow) => uow.toolInvocations.listByRun('r'))).toMatchObject([{ status: 'unknown' }]);
    expect((await store.listEvents('r')).map((event) => event.type)).toEqual(['tool.started', 'tool.result_unknown']);
    resolveTool({ output: 'late' }); await Promise.resolve();
    expect(await store.transaction((uow) => uow.toolInvocations.listByRun('r'))).toMatchObject([{ status: 'unknown' }]);
  });

  it('lets a worker cancel and stop while the underlying tool never settles', async () => {
    const store = await seedQueued();
    const pendingTool = new Promise<{ output: string }>(() => {});
    const scripted = createScriptedModels([fauxAssistantMessage([fauxToolCall('tool', {})])]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    let started!: () => void; const began = new Promise<void>((resolve) => { started = resolve; });
    const executor = makeExecutor(assembly, { storage: store,
      agentDefinitions: new StaticAgentDefinitionProvider([definition]), pluginHost: new RuntimePluginHost([plugin(async () => {
        started(); return pendingTool;
      })]) });
    const worker = createWorker(store, executor);

    const draining = worker.drainOne();
    await began;
    await worker.cancel('r');
    await expect(worker.stop()).resolves.toBeUndefined();
    await expect(draining).resolves.toBe(true);

    expect(await store.getRun('r')).toMatchObject({ status: 'waiting', errorCode: 'TOOL_RESULT_UNKNOWN', waitingReason: 'tool-result-unknown' });
    expect(await store.transaction((uow) => uow.toolInvocations.listByRun('r'))).toMatchObject([{ status: 'unknown' }]);
  });

  it('uses a run-scoped no-op compressor without mutating shared DI', async () => {
    const store = await seed();
    const scripted = createScriptedModels([fauxAssistantMessage('completed')]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    await store.transaction((uow) => {
      const entries = Array.from({ length: 40 }, (_, index) => ({ entryId: `e-${index}`, tenantId: 't', sessionId: 's', runId: 'old',
        sequence: index + 1, message: { role: 'user' as const, content: `history-${index}`, timestamp: index }, createdAt: at }));
      uow.sessions.appendEntries(entries);
    });
    const plainRun = { ...run, contextSnapshot: { items: [], configLayers: [], promptSections: [] } };
    const plainDefinition = { ...definition, toolNames: [] };
    const executor = makeExecutor(assembly, { storage: store,
      agentDefinitions: new StaticAgentDefinitionProvider([plainDefinition]), pluginHost: new RuntimePluginHost() });
    await expect(executor.execute({ run: plainRun, session, signal: new AbortController().signal }))
      .resolves.toMatchObject({ artifacts: [{ data: 'completed' }] });
  });

  it('maps strict model resolution failures before starting the model', async () => {
    const store = await seed(); const scripted = createScriptedModels([fauxAssistantMessage('unused')]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    const base = assembly.runtimeConfigProvider;
    const config = new Proxy(base, { get(target, property, receiver) {
      if (property === 'resolveModel') return () => {
        throw new Error('missing named model');
      };
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const plainRun = { ...run, contextSnapshot: { items: [], configLayers: [], promptSections: [] } };
    const executor = new SingleAgentRunExecutor({ models: assembly.models, config, executionRoot: assembly.executionRoot, storage: store,
      agentDefinitions: new StaticAgentDefinitionProvider([{ ...definition, toolNames: [] }]), pluginHost: new RuntimePluginHost() });
    await expect(executor.execute({ run: plainRun, session, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE', cause: expect.any(Error) });
    expect(scripted.state.callCount).toBe(0);
  });
});
