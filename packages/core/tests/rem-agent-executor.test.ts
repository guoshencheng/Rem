import { Type } from '@sinclair/typebox';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { AgentDefinition } from '../src/domain/agent-definition/types.js';
import type { AgentRun } from '../src/domain/run/types.js';
import type { AgentSession } from '../src/domain/session/types.js';
import type { RuntimePlugin } from '../src/sdk/runtime-plugin.js';
import type { ToolContext } from '../src/sdk/tool-provider.js';
import { SingleAgentRunExecutor, type SingleAgentRunExecutorOptions } from '../src/execution/single-agent-run-executor.js';
import { RecordingToolProvider } from '../src/execution/recording-tool-provider.js';
import { RuntimePluginHost } from '../src/plugin-system/runtime-plugin-host.js';
import { StaticAgentDefinitionProvider } from '../src/plugins/agent-definition/static/provider.js';
import { StaticToolProvider } from '../src/plugins/tool/static/index.js';
import { SqliteRuntimeStore } from '../src/plugins/storage/sqlite/runtime-store.js';
import { SqliteSchemaManager } from '../src/plugins/storage/sqlite/schema.js';
import { createFakeRuntimeStore } from './helpers/fake-runtime-store.js';
import { createFakeAssembly } from './helpers/fake-di.js';
import { createMockModels } from './helpers/mock-models.js';
import { createScriptedModels, fauxAssistantMessage, fauxToolCall } from './helpers/scripted-models.js';
import { flushDebugLog, setLogSink } from '../src/infrastructure/observability/debug-log.js';

type TestExecutorOptions = Omit<SingleAgentRunExecutorOptions, 'models' | 'config' | 'executionRoot'>;
function makeExecutor(assembly: Awaited<ReturnType<typeof createFakeAssembly>>, options: TestExecutorOptions): SingleAgentRunExecutor {
  return new SingleAgentRunExecutor({ ...options, models: assembly.models, config: assembly.runtimeConfigProvider, executionRoot: assembly.executionRoot });
}

const at = new Date('2026-08-11T00:00:00.000Z');
const session: AgentSession = { sessionId: 's', tenantId: 'tenant', contexts: { bindings: [] }, createdAt: at, updatedAt: at };
const run: AgentRun = {
  runId: 'r', tenantId: 'tenant', principalId: 'principal', sessionId: 's', agentId: 'agent',
  agentRevision: '1', status: 'running', trigger: { type: 'message', content: 'new request' },
  contextSnapshot: { items: [], configLayers: [], promptSections: [] }, createdAt: at, startedAt: at, updatedAt: at,
};
const definition: AgentDefinition = {
  agentId: 'agent', revision: '1', name: 'Agent', instructions: 'base instructions', modelId: 'mock/mock-model',
  toolNames: ['acme_lookup'], acceptedTriggers: ['message'], execution: { type: 'single-agent' },
};

async function seed(store: Awaited<ReturnType<typeof createFakeRuntimeStore>>['store']): Promise<void> {
  await store.transaction((uow) => { uow.sessions.insert(session); uow.runs.insert(run); });
}

describe('RecordingToolProvider', () => {
  it('records lifecycle and passes the complete runtime context', async () => {
    const { store } = await createFakeRuntimeStore();
    await seed(store);
    let seen: ToolContext | undefined;
    const base = new StaticToolProvider([{ definition: {
      name: 'acme_lookup', description: 'lookup', parameters: Type.Object({ id: Type.String() }),
      sideEffect: 'idempotent', supportsIdempotencyKey: true,
    }, executor: async (_input, context) => { seen = context; return { output: 'found', details: { ok: true } }; } }]);
    const provider = new RecordingToolProvider({ storage: store, provider: base, run, allowedToolNames: ['acme_lookup'], generateId: (() => { let i = 0; return () => `id-${++i}`; })() });

    await expect(provider.execute([{ toolCallId: 'call-1', toolName: 'acme_lookup', input: { id: '42' } }], { cwd: '/', executionRoot: '/' }))
      .resolves.toMatchObject([{ output: 'found' }]);

    expect(seen).toMatchObject({ tenantId: 'tenant', principalId: 'principal', runId: 'r',
      invocationId: 'id-1', idempotencyKey: 'r:call-1' });
    const invocations = await store.transaction((uow) => uow.toolInvocations.listByRun('r'));
    expect(invocations).toMatchObject([{ status: 'succeeded', sideEffect: 'idempotent', supportsIdempotencyKey: true }]);
    expect((await store.listEvents('r')).map((event) => event.type)).toEqual(['tool.started', 'tool.succeeded']);
  });

  it('denies tools outside the definition and distinguishes missing allowed tools', async () => {
    const { store } = await createFakeRuntimeStore();
    await seed(store);
    const provider = new RecordingToolProvider({ storage: store, provider: new StaticToolProvider(), run, allowedToolNames: ['missing'] });
    await expect(provider.execute([{ toolCallId: '1', toolName: 'other', input: {} }], { cwd: '/', executionRoot: '/' }))
      .rejects.toMatchObject({ code: 'TOOL_DENIED' });
    await expect(provider.execute([{ toolCallId: '2', toolName: 'missing', input: {} }], { cwd: '/', executionRoot: '/' }))
      .rejects.toMatchObject({ code: 'TOOL_NOT_FOUND' });
  });

  it('marks an ignored-abort side effect unknown for deterministic recovery', async () => {
    const { store } = await createFakeRuntimeStore();
    await seed(store);
    const controller = new AbortController();
    const base = new StaticToolProvider([{ definition: { name: 'acme_lookup', description: 'x', parameters: Type.Object({}) },
      executor: async () => { controller.abort(); return { output: 'late' }; } }]);
    const provider = new RecordingToolProvider({ storage: store, provider: base, run, allowedToolNames: ['acme_lookup'] });
    await expect(provider.execute([{ toolCallId: 'c', toolName: 'acme_lookup', input: {} }], { cwd: '/', executionRoot: '/', signal: controller.signal }))
      .rejects.toMatchObject({ code: 'EXECUTION_CANCELLED' });
    expect(await store.transaction((uow) => uow.toolInvocations.listByRun('r'))).toMatchObject([{ status: 'unknown', sideEffect: 'non-idempotent' }]);
    expect((await store.listEvents('r')).map((event) => event.type)).toEqual(['tool.started', 'tool.result_unknown']);
  });

  it('records explicit tool failures without leaking provider errors', async () => {
    const { store } = await createFakeRuntimeStore();
    await seed(store);
    const base = new StaticToolProvider([{ definition: { name: 'acme_lookup', description: 'x', parameters: Type.Object({}) },
      executor: async () => { throw new Error('secret\ntrace'); } }]);
    const provider = new RecordingToolProvider({ storage: store, provider: base, run, allowedToolNames: ['acme_lookup'] });
    await expect(provider.execute([{ toolCallId: 'c', toolName: 'acme_lookup', input: {} }], { cwd: '/', executionRoot: '/' }))
      .resolves.toMatchObject([{ error: 'Tool execution failed' }]);
    expect(await store.transaction((uow) => uow.toolInvocations.listByRun('r'))).toMatchObject([{ status: 'failed', error: 'Tool execution failed' }]);
    expect((await store.listEvents('r')).map((event) => event.type)).toEqual(['tool.started', 'tool.failed']);
  });

  it('persists and reads the tool lifecycle through SQLite', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    new SqliteSchemaManager(db).migrate();
    const store = new SqliteRuntimeStore(db);
    try {
      await seed(store);
      const base = new StaticToolProvider([{ definition: { name: 'acme_lookup', description: 'x', parameters: Type.Object({}), sideEffect: 'none' },
        executor: async () => ({ output: 'sqlite' }) }]);
      const provider = new RecordingToolProvider({ storage: store, provider: base, run, allowedToolNames: ['acme_lookup'] });
      await provider.execute([{ toolCallId: 'sqlite-call', toolName: 'acme_lookup', input: {} }], { cwd: '/', executionRoot: '/' });
      await expect(provider.execute([{ toolCallId: 'sqlite-call', toolName: 'acme_lookup', input: {} }], { cwd: '/', executionRoot: '/' }))
        .resolves.toMatchObject([{ output: 'sqlite' }]);
      expect(await store.transaction((uow) => uow.toolInvocations.listByRun('r'))).toMatchObject([{ status: 'succeeded', result: { output: 'sqlite' } }]);
      expect((await store.listEvents('r')).map((event) => event.type)).toEqual(['tool.started', 'tool.succeeded']);
    } finally { db.close(); }
  });

  it('persists invalid SQLite tool results as failed, never executing', async () => {
    const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); new SqliteSchemaManager(db).migrate();
    const store = new SqliteRuntimeStore(db);
    try {
      await seed(store);
      const base = new StaticToolProvider([{ definition: { name: 'acme_lookup', description: 'x', parameters: Type.Object({}) },
        executor: async () => ({ output: 'x', details: new Date() }) }]);
      const provider = new RecordingToolProvider({ storage: store, provider: base, run, allowedToolNames: ['acme_lookup'] });
      await expect(provider.execute([{ toolCallId: 'invalid', toolName: 'acme_lookup', input: {} }], { cwd: '/', executionRoot: '/' }))
        .rejects.toMatchObject({ code: 'TOOL_EXECUTION_FAILED' });
      expect(await store.transaction((uow) => uow.toolInvocations.listByRun('r'))).toMatchObject([{ status: 'failed', error: 'Tool result is invalid' }]);
      expect((await store.listEvents('r')).map((event) => event.type)).toEqual(['tool.started', 'tool.failed']);
    } finally { db.close(); }
  });
});

describe('SingleAgentRunExecutor', () => {
  it('task outputSchema injects submit_result and stores a JSON primary artifact', async () => {
    const scripted = createScriptedModels([
      ({ context }) => {
        expect(context.tools?.map((tool) => tool.name)).toContain('submit_result');
        return fauxAssistantMessage([fauxToolCall('submit_result', { result: { answer: 'done', score: 1 } })]);
      },
      fauxAssistantMessage('submitted'),
    ]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    const { store } = await createFakeRuntimeStore();
    await seed(store);
    const taskRun: AgentRun = { ...run, trigger: { type: 'task', input: { ticketId: 'T-1' } }, executionPlanSnapshot: undefined };
    const taskDefinition: AgentDefinition = { ...definition, acceptedTriggers: ['task'], toolNames: [], outputSchema: { type: 'object', required: ['answer'], properties: { answer: { type: 'string' }, score: { type: 'number' } }, additionalProperties: false } };
    const executor = makeExecutor(assembly, { storage: store, agentDefinitions: new StaticAgentDefinitionProvider([taskDefinition]), pluginHost: new RuntimePluginHost() });
    const result = await executor.execute({ run: taskRun, session, signal: new AbortController().signal });
    expect(result.artifacts).toEqual([{ type: 'result', mediaType: 'application/json', name: 'result.json', data: '{"answer":"done","score":1}' }]);
    expect(await store.transaction((uow) => uow.toolInvocations.listByRun('r'))).toMatchObject([{ toolName: 'submit_result', status: 'succeeded' }]);
    await assembly.cleanup();
  });

  it('projects text and reasoning deltas without persisting high-frequency signals', async () => {
    const final = fauxAssistantMessage([
      { type: 'text', text: 'streamed' },
      { type: 'thinking', thinking: 'reasoned' },
    ]);
    const models = createMockModels({
      name: 'mock',
      stream: async function* () {
        yield { type: 'start', partial: final };
        yield { type: 'text_start', contentIndex: 0, partial: final };
        yield { type: 'text_delta', contentIndex: 0, delta: 'streamed', partial: final };
        yield { type: 'thinking_start', contentIndex: 1, partial: final };
        yield { type: 'thinking_delta', contentIndex: 1, delta: 'reasoned', partial: final };
      },
      complete: async () => final,
    });
    const assembly = await createFakeAssembly({ models });
    const { store } = await createFakeRuntimeStore();
    await seed(store);
    const signals: Array<{ type: string; data: unknown }> = [];
    const executor = makeExecutor(assembly, { storage: store,
      agentDefinitions: new StaticAgentDefinitionProvider([definition]), pluginHost: new RuntimePluginHost() });

    await executor.execute({ run, session, signal: new AbortController().signal,
      emitSignal: (signal) => signals.push({ type: signal.type, data: signal.data }) });

    expect(signals.map((signal) => signal.type)).toEqual([
      'assistant.message.started', 'assistant.text.delta', 'assistant.reasoning.delta',
      'assistant.message.completed',
    ]);
    expect(signals[1]?.data).toEqual({ messageIndex: 0, contentIndex: 0, delta: 'streamed' });
    expect(signals[2]?.data).toEqual({ messageIndex: 0, contentIndex: 1, delta: 'reasoned' });
    expect(await store.listEvents('r')).toEqual([]);
    await assembly.cleanup();
  });

  it('rejects unresolved API-key placeholders before invoking the model', async () => {
    const scripted = createScriptedModels([fauxAssistantMessage('unused')]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    const baseConfig = assembly.runtimeConfigProvider;
    const config = new Proxy(baseConfig, {
      get(target, property, receiver) {
        if (property === 'resolveModel') {
          return () => ({ provider: 'mock', model: 'mock-model', apiKey: '{MISSING_API_KEY}' });
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const { store } = await createFakeRuntimeStore();
    await seed(store);
    const executor = new SingleAgentRunExecutor({ models: assembly.models, config, executionRoot: assembly.executionRoot, storage: store,
      agentDefinitions: new StaticAgentDefinitionProvider([definition]), pluginHost: new RuntimePluginHost() });
    await expect(executor.execute({ run, session, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'MODEL_EXECUTION_FAILED' });
    expect(scripted.state.callCount).toBe(0);
  });

  it('logs provider failures with credentials redacted', async () => {
    const chunks: string[] = [];
    try {
      const scripted = createScriptedModels([{
        ...fauxAssistantMessage(''), stopReason: 'error',
        errorMessage: '401 Authorization: Bearer sk-secret-value',
      } as never]);
      const assembly = await createFakeAssembly({ models: scripted.models });
      setLogSink((chunk) => { chunks.push(chunk); });
      const { store } = await createFakeRuntimeStore();
      await seed(store);
      const executor = makeExecutor(assembly, { storage: store,
        agentDefinitions: new StaticAgentDefinitionProvider([definition]), pluginHost: new RuntimePluginHost() });
      await expect(executor.execute({ run, session, signal: new AbortController().signal }))
        .rejects.toMatchObject({ code: 'MODEL_EXECUTION_FAILED' });
      await flushDebugLog();
    } finally {
      setLogSink(null);
    }
    const output = chunks.join('');
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('sk-secret-value');
  });

  it('uses history and snapshot prompt, records a tool, and returns only new messages plus an artifact', async () => {
    let exposedTools: string[] | undefined;
    const scripted = createScriptedModels([
      ({ context }) => {
        expect(context.systemPrompt).toBe('base instructions\n\ncustomer context');
        expect(context.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
        exposedTools = context.tools?.map((tool) => tool.name);
        return fauxAssistantMessage([fauxToolCall('acme_lookup', { id: '42' })]);
      },
      fauxAssistantMessage('completed'),
    ]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    const { store } = await createFakeRuntimeStore();
    const runtimeRun = { ...run, contextSnapshot: { items: [{ binding: { type: 'acme/customer', contextId: '42' }, pluginId: 'acme', pluginVersion: '1', snapshot: { customerId: '42' }, snapshotHash: 'hash' }], configLayers: [{ name: 'acme:runtime', priority: 1, value: { behavior: { name: 'Context Agent' } } }], promptSections: [{ name: 'customer', priority: 1, content: 'customer context' }] } };
    await store.transaction((uow) => {
      uow.sessions.insert(session); uow.runs.insert(runtimeRun);
      uow.sessions.appendEntries([
        { entryId: 'e1', tenantId: 'tenant', sessionId: 's', runId: 'old', sequence: 1, message: { role: 'user', content: 'old', timestamp: 1 }, createdAt: at },
        { entryId: 'e2', tenantId: 'tenant', sessionId: 's', runId: 'old', sequence: 2, message: fauxAssistantMessage('old reply'), createdAt: at },
      ]);
    });
    let toolCalls = 0;
    let runtimeToolContext: ToolContext | undefined;
    const liveSignals: string[] = [];
    const plugin: RuntimePlugin = { manifest: { pluginId: 'acme', version: '1' }, register(registrar) { registrar.addContextType({
      type: 'acme/customer', resolve: async () => ({ snapshot: {} }), materialize: async () => ({ tools: [{
        definition: { name: 'acme_lookup', description: 'lookup', parameters: Type.Object({ id: Type.String() }), sideEffect: 'none' },
        executor: async (_input, context) => { toolCalls += 1; runtimeToolContext = context; return { output: 'customer' }; },
      }] }),
    }); } };
    const executor = makeExecutor(assembly, { storage: store,
      agentDefinitions: new StaticAgentDefinitionProvider([definition]), pluginHost: new RuntimePluginHost([plugin]) });

    const result = await executor.execute({ run: runtimeRun, session, signal: new AbortController().signal,
      emitSignal: (signal) => liveSignals.push(signal.type) });

    expect(result.sessionEntries.map((entry) => entry.message.role)).toEqual(['user', 'assistant', 'toolResult', 'assistant']);
    expect(result.sessionEntries.some((entry) => entry.message.role === 'user' && entry.message.content === 'old')).toBe(false);
    expect(result.artifacts).toEqual([{ type: 'result', mediaType: 'text/plain', name: 'result.txt', data: 'completed' }]);
    expect({ modelCalls: scripted.state.callCount, toolCalls, exposedTools }).toEqual({ modelCalls: 2, toolCalls: 1, exposedTools: ['acme_lookup'] });
    expect(liveSignals).toEqual(['assistant.message.started', 'assistant.message.completed',
      'tool.execution.started', 'tool.execution.completed', 'assistant.message.started', 'assistant.message.completed']);
    expect(runtimeToolContext).toMatchObject({ tenantId: 'tenant', principalId: 'principal', runId: 'r', sessionId: 's', agentName: 'Context Agent' });
    expect(runtimeToolContext?.invocationId).toBeTruthy();
    expect(runtimeToolContext?.idempotencyKey).toMatch(/^r:/);
    expect(await store.transaction((uow) => uow.toolInvocations.listByRun('r'))).toMatchObject([{ status: 'succeeded' }]);
    await assembly.cleanup();
  });

  it('rejects a missing snapshot plugin version before model execution', async () => {
    const scripted = createScriptedModels([fauxAssistantMessage('unused')]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    const { store } = await createFakeRuntimeStore();
    await seed(store);
    const badRun = { ...run, contextSnapshot: { ...run.contextSnapshot, items: [{ binding: { type: 'x', contextId: '1' }, pluginId: 'missing', pluginVersion: '1', snapshot: {}, snapshotHash: 'x' }] } };
    const executor = makeExecutor(assembly, { storage: store,
      agentDefinitions: new StaticAgentDefinitionProvider([definition]), pluginHost: new RuntimePluginHost() });
    await expect(executor.execute({ run: badRun, session, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'PLUGIN_DEPENDENCY_MISSING' });
    expect(scripted.state.callCount).toBe(0);
  });

  it('requires the exact persisted agent revision', async () => {
    const scripted = createScriptedModels([fauxAssistantMessage('unused')]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    const { store } = await createFakeRuntimeStore();
    await seed(store);
    const executor = makeExecutor(assembly, { storage: store,
      agentDefinitions: new StaticAgentDefinitionProvider([{ ...definition, revision: '2' }]),
      pluginHost: new RuntimePluginHost() });
    await expect(executor.execute({ run, session, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'AGENT_REVISION_NOT_FOUND' });
    expect(scripted.state.callCount).toBe(0);
  });

  it('rejects malicious plugin tool definitions before model or tool execution', async () => {
    const scripted = createScriptedModels([fauxAssistantMessage('unused')]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    const { store } = await createFakeRuntimeStore(); await seed(store);
    let getterReads = 0; let toolCalls = 0;
    const malicious = {};
    Object.defineProperty(malicious, 'definition', { enumerable: true, get: () => { getterReads += 1; return {}; } });
    Object.defineProperty(malicious, 'executor', { enumerable: true, value: async () => { toolCalls += 1; return { output: 'x' }; } });
    const plugin: RuntimePlugin = { manifest: { pluginId: 'bad', version: '1' }, register(registrar) { registrar.addContextType({
      type: 'bad/context', resolve: async () => ({ snapshot: {} }), materialize: async () => ({ tools: [malicious as never] }),
    }); } };
    const badRun = { ...run, contextSnapshot: { ...run.contextSnapshot, items: [{ binding: { type: 'bad/context', contextId: '1' }, pluginId: 'bad', pluginVersion: '1', snapshot: {}, snapshotHash: 'x' }] } };
    const executor = makeExecutor(assembly, { storage: store,
      agentDefinitions: new StaticAgentDefinitionProvider([definition]), pluginHost: new RuntimePluginHost([plugin]) });
    await expect(executor.execute({ run: badRun, session, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'CONTEXT_INVALID' });
    expect({ getterReads, toolCalls, modelCalls: scripted.state.callCount }).toEqual({ getterReads: 0, toolCalls: 0, modelCalls: 0 });
    expect(await store.transaction((uow) => uow.toolInvocations.listByRun('r'))).toEqual([]);
  });
});
