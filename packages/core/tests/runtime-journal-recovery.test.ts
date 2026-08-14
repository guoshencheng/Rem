import { describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import type { AgentDefinition } from '../src/domain/agent-definition/types.js';
import type { AgentRun } from '../src/domain/run/types.js';
import type { AgentSession } from '../src/domain/session/types.js';
import type { RuntimeRequestContext } from '../src/domain/identity/types.js';
import type { RuntimePlugin } from '../src/sdk/runtime-plugin.js';
import { buildExecutionPlan } from '../src/application/runs/execution-plan.js';
import { ResolveToolInvocationUsecase } from '../src/application/runs/resolve-tool-invocation.js';
import { SingleAgentRunExecutor } from '../src/execution/single-agent-run-executor.js';
import { RuntimePluginHost } from '../src/plugin-system/runtime-plugin-host.js';
import { StaticAgentDefinitionProvider } from '../src/plugins/agent-definition/static/provider.js';
import { createFakeAssembly } from './helpers/fake-di.js';
import { createFakeRuntimeStore } from './helpers/fake-runtime-store.js';
import { createScriptedModels, fauxAssistantMessage, fauxToolCall } from './helpers/scripted-models.js';

const at = new Date('2026-08-14T01:00:00.000Z');
const request: RuntimeRequestContext = { tenantId: 'tenant', principal: { principalId: 'operator', roles: ['operator'] } };
const definition: AgentDefinition = {
  agentId: 'worker', revision: '1', name: 'Worker', instructions: 'Finish the task', modelId: 'mock/mock-model',
  toolNames: [], acceptedTriggers: ['task'], execution: { type: 'single-agent' },
};

describe('Execution journal recovery', () => {
  it('continues from a confirmed tool result without asking the model to recreate the old call', async () => {
    const scripted = createScriptedModels([({ context }) => {
      expect(context.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'toolResult']);
      expect(context.messages.at(-1)).toMatchObject({ role: 'toolResult', toolCallId: 'call-1', toolName: 'lookup' });
      return fauxAssistantMessage('finished after confirmation');
    }]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    const { store } = await createFakeRuntimeStore();
    const plan = buildExecutionPlan(definition);
    const session: AgentSession = { sessionId: 'session', tenantId: 'tenant', contexts: { bindings: [] }, createdAt: at, updatedAt: at };
    const run: AgentRun = {
      runId: 'run', tenantId: 'tenant', principalId: 'operator', sessionId: session.sessionId,
      agentId: definition.agentId, agentRevision: definition.revision, status: 'waiting', waitingReason: 'tool-result-unknown',
      executionType: 'single-agent', executionPlanSnapshot: plan, rootNodeId: 'run:root',
      trigger: { type: 'task', input: { ticket: 'T-1' } }, contextSnapshot: { items: [], configLayers: [], promptSections: [] },
      createdAt: at, updatedAt: at,
    };
    try {
      await store.transaction((uow) => {
        uow.sessions.insert(session); uow.runs.insert(run);
        uow.executionNodes.insert({ nodeId: 'run:root', runId: 'run', tenantId: 'tenant', kind: 'root', role: 'root', agentId: 'worker', agentRevision: '1', status: 'waiting', depth: 0, createdAt: at, updatedAt: at });
        uow.workItems.insert({ workItemId: 'work', runId: 'run', status: 'failed', attempt: 1, createdAt: at, updatedAt: at });
        uow.executionEntries.append({ entryId: 'journal-user', tenantId: 'tenant', runId: 'run', nodeId: 'run:root', sequence: 1, kind: 'message', message: { role: 'user', content: 'do T-1', timestamp: at.getTime() }, audience: 'public', visibility: 'run', createdAt: at });
        uow.executionEntries.append({ entryId: 'journal-assistant', tenantId: 'tenant', runId: 'run', nodeId: 'run:root', sequence: 2, kind: 'message', message: fauxAssistantMessage([fauxToolCall('lookup', { id: 'T-1' }, { id: 'call-1' })]), audience: 'public', visibility: 'run', createdAt: at });
        uow.toolInvocations.insert({ invocationId: 'invocation', tenantId: 'tenant', sessionId: 'session', runId: 'run', nodeId: 'run:root', toolCallId: 'call-1', toolName: 'lookup', status: 'unknown', sideEffect: 'non-idempotent', supportsIdempotencyKey: false, input: { id: 'T-1' }, error: 'Tool result is unknown', createdAt: at, updatedAt: at });
      });
      const resolved = await new ResolveToolInvocationUsecase({ storage: store, now: () => at, generateId: (() => { let i = 0; return () => `resolution-${++i}`; })() })
        .execute(request, 'run', 'invocation', { action: 'confirm-succeeded', result: { output: 'confirmed result' }, idempotencyKey: 'confirm-1' });
      expect(resolved.status).toBe('queued');
      expect((await store.listExecutionEntries('run')).find((entry) => entry.kind === 'tool-result')?.message).toMatchObject({ role: 'toolResult', toolCallId: 'call-1' });

      const executor = new SingleAgentRunExecutor({ models: assembly.models, config: assembly.runtimeConfigProvider, executionRoot: assembly.executionRoot, storage: store, agentDefinitions: new StaticAgentDefinitionProvider([definition]), pluginHost: new RuntimePluginHost() });
      const nextRun = await store.getRun('run');
      const result = await executor.execute({ run: nextRun!, session, signal: new AbortController().signal });
      expect(result.artifacts).toEqual([{ type: 'result', mediaType: 'text/plain', name: 'result.txt', data: 'finished after confirmation' }]);
      expect(scripted.state.callCount).toBe(1);
    } finally { await assembly.cleanup(); }
  });

  it('reuses a succeeded invocation when the toolResult checkpoint was not committed', async () => {
    let toolCalls = 0;
    const scripted = createScriptedModels([({ context }) => {
      expect(context.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'toolResult']);
      return fauxAssistantMessage('recovered');
    }]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    const { store } = await createFakeRuntimeStore();
    const lookupDefinition: AgentDefinition = { ...definition, toolNames: ['lookup'] };
    const plugin: RuntimePlugin = { manifest: { pluginId: 'recovery', version: '1' }, register(registrar) { registrar.addContextType({
      type: 'recovery/context', resolve: async () => ({ snapshot: {} }), materialize: async () => ({ tools: [{
        definition: { name: 'lookup', description: 'lookup', parameters: Type.Object({ id: Type.String() }), sideEffect: 'none' },
        executor: async () => { toolCalls += 1; return { output: 'must not execute' }; },
      }] }),
    }); } };
    const plan = buildExecutionPlan(lookupDefinition);
    const session: AgentSession = { sessionId: 'recovery-session', tenantId: 'tenant', contexts: { bindings: [] }, createdAt: at, updatedAt: at };
    const run: AgentRun = { runId: 'recovery-run', tenantId: 'tenant', principalId: 'operator', sessionId: session.sessionId, agentId: 'worker', agentRevision: '1', status: 'running', executionType: 'single-agent', executionPlanSnapshot: plan, rootNodeId: 'recovery-run:root', trigger: { type: 'task', input: {} }, contextSnapshot: { items: [{ binding: { type: 'recovery/context', contextId: '1' }, pluginId: 'recovery', pluginVersion: '1', snapshot: {}, snapshotHash: 'hash' }], configLayers: [], promptSections: [] }, createdAt: at, updatedAt: at };
    await store.transaction((uow) => {
      uow.sessions.insert(session); uow.runs.insert(run);
      uow.executionNodes.insert({ nodeId: run.rootNodeId!, runId: run.runId, tenantId: run.tenantId, kind: 'root', role: 'root', agentId: run.agentId, agentRevision: run.agentRevision, status: 'running', depth: 0, createdAt: at, updatedAt: at });
      uow.executionEntries.append({ entryId: 'user', tenantId: 'tenant', runId: run.runId, nodeId: run.rootNodeId!, sequence: 1, kind: 'message', message: { role: 'user', content: 'recover', timestamp: at.getTime() }, audience: 'public', visibility: 'run', createdAt: at });
      uow.executionEntries.append({ entryId: 'assistant', tenantId: 'tenant', runId: run.runId, nodeId: run.rootNodeId!, sequence: 2, kind: 'message', message: fauxAssistantMessage([fauxToolCall('lookup', { id: 'T-1' }, { id: 'call-1' })]), audience: 'public', visibility: 'run', createdAt: at });
      uow.toolInvocations.insert({ invocationId: 'persisted', tenantId: 'tenant', sessionId: session.sessionId, runId: run.runId, nodeId: run.rootNodeId, toolCallId: 'call-1', toolName: 'lookup', status: 'succeeded', sideEffect: 'none', supportsIdempotencyKey: false, input: { id: 'T-1' }, result: { output: 'persisted result' }, createdAt: at, updatedAt: at });
    });
    try {
      const executor = new SingleAgentRunExecutor({ models: assembly.models, config: assembly.runtimeConfigProvider, executionRoot: assembly.executionRoot, storage: store, agentDefinitions: new StaticAgentDefinitionProvider([lookupDefinition]), pluginHost: new RuntimePluginHost([plugin]) });
      const result = await executor.execute({ run, session, signal: new AbortController().signal });
      expect(result.artifacts).toEqual([{ type: 'result', mediaType: 'text/plain', name: 'result.txt', data: 'recovered' }]);
      expect(toolCalls).toBe(0);
      expect((await store.listExecutionEntries(run.runId)).filter((entry) => entry.kind === 'tool-result')).toHaveLength(1);
    } finally { await assembly.cleanup(); }
  });

  it('returns an already journaled final assistant without another model call', async () => {
    const scripted = createScriptedModels([]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    const { store } = await createFakeRuntimeStore();
    const plan = buildExecutionPlan(definition);
    const session: AgentSession = { sessionId: 'final-session', tenantId: 'tenant', contexts: { bindings: [] }, createdAt: at, updatedAt: at };
    const run: AgentRun = { runId: 'final-run', tenantId: 'tenant', principalId: 'operator', sessionId: session.sessionId, agentId: definition.agentId, agentRevision: definition.revision, status: 'running', executionType: 'single-agent', executionPlanSnapshot: plan, rootNodeId: 'final-run:root', trigger: { type: 'task', input: {} }, contextSnapshot: { items: [], configLayers: [], promptSections: [] }, createdAt: at, updatedAt: at };
    await store.transaction((uow) => {
      uow.sessions.insert(session); uow.runs.insert(run);
      uow.executionNodes.insert({ nodeId: run.rootNodeId!, runId: run.runId, tenantId: run.tenantId, kind: 'root', role: 'root', agentId: run.agentId, agentRevision: run.agentRevision, status: 'running', depth: 0, createdAt: at, updatedAt: at });
      uow.executionEntries.append({ entryId: 'final-user', tenantId: 'tenant', runId: run.runId, nodeId: run.rootNodeId!, sequence: 1, kind: 'message', message: { role: 'user', content: 'done?', timestamp: at.getTime() }, audience: 'public', visibility: 'run', createdAt: at });
      uow.executionEntries.append({ entryId: 'final-assistant', tenantId: 'tenant', runId: run.runId, nodeId: run.rootNodeId!, sequence: 2, kind: 'message', message: fauxAssistantMessage('already done'), audience: 'public', visibility: 'run', createdAt: at });
    });
    try {
      const executor = new SingleAgentRunExecutor({ models: assembly.models, config: assembly.runtimeConfigProvider, executionRoot: assembly.executionRoot, storage: store, agentDefinitions: new StaticAgentDefinitionProvider([definition]), pluginHost: new RuntimePluginHost() });
      await expect(executor.execute({ run, session, signal: new AbortController().signal })).resolves.toMatchObject({ artifacts: [{ data: 'already done' }], journaled: true });
      expect(scripted.state.callCount).toBe(0);
    } finally { await assembly.cleanup(); }
  });
});
