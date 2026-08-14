import { describe, expect, it } from 'vitest';
import type { AgentDefinition } from '../src/domain/agent-definition/types.js';
import type { AgentRun } from '../src/domain/run/types.js';
import type { AgentSession } from '../src/domain/session/types.js';
import { buildExecutionPlan } from '../src/application/runs/execution-plan.js';
import { RuntimePluginHost } from '../src/plugin-system/runtime-plugin-host.js';
import { StaticAgentDefinitionProvider } from '../src/plugins/agent-definition/static/provider.js';
import { TeamRunExecutor } from '../src/execution/team-run-executor.js';
import { createFakeAssembly } from './helpers/fake-di.js';
import { createFakeRuntimeStore } from './helpers/fake-runtime-store.js';
import { createScriptedModels, fauxAssistantMessage, fauxToolCall } from './helpers/scripted-models.js';

const at = new Date('2026-08-14T00:00:00.000Z');
const session: AgentSession = {
  sessionId: 'team-session', tenantId: 'tenant', contexts: { bindings: [] }, createdAt: at, updatedAt: at,
};

const member = (agentId: string, revision: string, instructions: string): AgentDefinition => ({
  agentId, revision, name: agentId, instructions, modelId: 'mock/mock-model', toolNames: [],
  acceptedTriggers: ['message'], execution: { type: 'single-agent' },
});

describe('TeamRunExecutor', () => {
  it('按固化 participant snapshot 执行成员并把成员结果交给 organizer', async () => {
    const scripted = createScriptedModels([
      fauxAssistantMessage([fauxToolCall('send_message', { to: ['member-one', 'member-two'], content: 'please research' })]),
      fauxAssistantMessage('organizer waiting'),
      fauxAssistantMessage('member one result'),
      fauxAssistantMessage('member two result'),
      ({ context }) => {
        expect(context.messages.some((message) => message.role === 'assistant' && message.content.some((part) => part.type === 'text' && part.text === 'member one result'))).toBe(true);
        expect(context.messages.some((message) => message.role === 'assistant' && message.content.some((part) => part.type === 'text' && part.text === 'member two result'))).toBe(true);
        return fauxAssistantMessage('organizer result');
      },
    ]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    const { store } = await createFakeRuntimeStore();
    const one = member('member-one', '1', 'member one instructions');
    const two = member('member-two', '4', 'member two instructions');
    const root: AgentDefinition = {
      agentId: 'team', revision: '9', name: 'Team', instructions: 'organize', modelId: 'mock/mock-model',
      toolNames: [], acceptedTriggers: ['message'], execution: {
        type: 'team', members: [{ agentId: one.agentId, revision: one.revision }, { agentId: two.agentId, revision: two.revision }],
      },
    };
    const plan = buildExecutionPlan(root, [one, two]);
    const run: AgentRun = {
      runId: 'team-run', tenantId: 'tenant', principalId: 'principal', sessionId: session.sessionId,
      agentId: root.agentId, agentRevision: root.revision, status: 'running', executionType: 'team',
      executionPlanSnapshot: plan, rootNodeId: 'team-run:root',
      trigger: { type: 'message', content: 'coordinate' },
      contextSnapshot: { items: [], configLayers: [], promptSections: [] },
      createdAt: at, startedAt: at, updatedAt: at,
    };
    await store.transaction((uow) => {
      uow.sessions.insert(session);
      uow.runs.insert(run);
      for (const [index, participant] of plan.participants.entries()) {
        uow.executionNodes.insert({
          nodeId: index === 0 ? 'team-run:root' : `team-run:member:${index}`,
          runId: run.runId, tenantId: run.tenantId, parentNodeId: index === 0 ? undefined : 'team-run:root',
          kind: participant.role === 'organizer' ? 'organizer' : 'member', role: participant.role,
          agentId: participant.agentId, agentRevision: participant.revision, status: index === 0 ? 'queued' : 'idle', depth: 0,
          createdAt: at, updatedAt: at,
        });
      }
      uow.executionEntries.append({ entryId: 'team-user', tenantId: run.tenantId, runId: run.runId, nodeId: run.rootNodeId!, sequence: 1, kind: 'message', message: { role: 'user', content: 'coordinate', timestamp: at.getTime() }, audience: 'public', visibility: 'session', createdAt: at });
      uow.deliveries.insert({ deliveryId: 'team-initial', tenantId: run.tenantId, runId: run.runId, nodeId: run.rootNodeId!, kind: 'message', batchId: 'team-initial', depth: 0, status: 'queued', attempt: 0, sourceEntryId: 'team-user', createdAt: at, updatedAt: at });
    });
    const executor = new TeamRunExecutor({
      models: assembly.models, config: assembly.runtimeConfigProvider, executionRoot: assembly.executionRoot,
      storage: store, agentDefinitions: new StaticAgentDefinitionProvider([root, one, two]),
      pluginHost: new RuntimePluginHost(),
    });

    const result = await executor.execute({ run, session, signal: new AbortController().signal });
    expect(result.artifacts).toEqual([{ type: 'result', mediaType: 'text/plain', name: 'result.txt', data: 'organizer result' }]);
    expect(scripted.state.callCount).toBe(5);
    const journal = await store.listExecutionEntries(run.runId);
    expect(journal).toHaveLength(9);
    expect(journal.filter((entry) => entry.nodeId === 'team-run:root' && entry.message !== undefined).map((entry) => entry.message?.role))
      .toEqual(['user', 'assistant', 'assistant', 'toolResult', 'assistant', 'assistant']);
    for (const nodeId of ['team-run:member:1', 'team-run:member:2']) {
      expect(journal.filter((entry) => entry.nodeId === nodeId).map((entry) => entry.message?.role)).toEqual(['assistant']);
    }
    await expect(store.listExecutionNodes(run.runId)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: 'team-run:member:1', status: 'idle', agentRevision: '1' }),
      expect.objectContaining({ nodeId: 'team-run:member:2', status: 'idle', agentRevision: '4' }),
    ]));
    await assembly.cleanup();
  });

  it('成员失败写入稳定合成结果，批次仍 resume organizer', async () => {
    const scripted = createScriptedModels([
      fauxAssistantMessage([fauxToolCall('send_message', { to: ['member-one', 'member-two'], content: 'please research' })]),
      fauxAssistantMessage('organizer waiting'),
      ({ context }) => {
        expect(context.messages.some((message) => message.role === 'assistant' && message.content.some((part) => part.type === 'text' && part.text.includes('MODEL_EXECUTION_FAILED')))).toBe(true);
        return fauxAssistantMessage('organizer recovered');
      },
      fauxAssistantMessage('member two result'),
      ({ context }) => {
        expect(context.messages.some((message) => message.role === 'assistant' && message.content.some((part) => part.type === 'text' && part.text.includes('MODEL_EXECUTION_FAILED')))).toBe(true);
        return fauxAssistantMessage('organizer recovered');
      },
    ]);
    // The first member's model response is deliberately a provider error.
    scripted.setResponses([
      fauxAssistantMessage([fauxToolCall('send_message', { to: ['member-one', 'member-two'], content: 'please research' })]),
      fauxAssistantMessage('organizer waiting'),
      ({ context }) => { throw new Error('member provider failed'); },
      fauxAssistantMessage('member two result'),
      ({ context }) => {
        expect(context.messages.some((message) => message.role === 'assistant' && message.content.some((part) => part.type === 'text' && part.text.includes('MODEL_EXECUTION_FAILED')))).toBe(true);
        return fauxAssistantMessage('organizer recovered');
      },
    ]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    const { store } = await createFakeRuntimeStore();
    const one = member('member-one', '1', 'member one instructions');
    const two = member('member-two', '4', 'member two instructions');
    const root: AgentDefinition = { agentId: 'team', revision: '9', name: 'Team', instructions: 'organize', modelId: 'mock/mock-model', toolNames: [], acceptedTriggers: ['message'], execution: { type: 'team', members: [{ agentId: one.agentId }, { agentId: two.agentId }] } };
    const plan = buildExecutionPlan(root, [one, two]);
    const run: AgentRun = { runId: 'failure-run', tenantId: 'tenant', principalId: 'principal', sessionId: session.sessionId, agentId: root.agentId, agentRevision: root.revision, status: 'running', executionType: 'team', executionPlanSnapshot: plan, rootNodeId: 'failure-run:root', trigger: { type: 'message', content: 'coordinate' }, contextSnapshot: { items: [], configLayers: [], promptSections: [] }, createdAt: at, startedAt: at, updatedAt: at };
    await store.transaction((uow) => {
      uow.sessions.insert(session); uow.runs.insert(run);
      for (const [index, participant] of plan.participants.entries()) uow.executionNodes.insert({ nodeId: index === 0 ? run.rootNodeId! : `failure-run:member:${index}`, runId: run.runId, tenantId: run.tenantId, parentNodeId: index === 0 ? undefined : run.rootNodeId, kind: index === 0 ? 'organizer' : 'member', role: participant.role, agentId: participant.agentId, agentRevision: participant.revision, status: index === 0 ? 'queued' : 'idle', depth: 0, createdAt: at, updatedAt: at });
      uow.executionEntries.append({ entryId: 'failure-user', tenantId: run.tenantId, runId: run.runId, nodeId: run.rootNodeId!, sequence: 1, kind: 'message', message: { role: 'user', content: 'coordinate', timestamp: at.getTime() }, audience: 'public', visibility: 'session', createdAt: at });
      uow.deliveries.insert({ deliveryId: 'failure-initial', tenantId: run.tenantId, runId: run.runId, nodeId: run.rootNodeId!, kind: 'message', batchId: 'failure-initial', depth: 0, status: 'queued', attempt: 0, sourceEntryId: 'failure-user', createdAt: at, updatedAt: at });
      uow.executionBudgets.insert({ tenantId: run.tenantId, runId: run.runId, agentRuns: 3, messages: 1, tokens: 0, updatedAt: at });
    });
    try {
      const executor = new TeamRunExecutor({ models: assembly.models, config: assembly.runtimeConfigProvider, executionRoot: assembly.executionRoot, storage: store, agentDefinitions: new StaticAgentDefinitionProvider([root, one, two]), pluginHost: new RuntimePluginHost() });
      const result = await executor.execute({ run, session, signal: new AbortController().signal });
      expect(result.artifacts).toEqual([{ type: 'result', mediaType: 'text/plain', name: 'result.txt', data: 'organizer recovered' }]);
      expect((await store.listDeliveries(run.runId)).filter((delivery) => delivery.kind === 'resume')).toHaveLength(1);
      expect((await store.listExecutionEntries(run.runId)).some((entry) => entry.data && typeof entry.data === 'object' && 'kind' in entry.data && entry.data.kind === 'team.failure')).toBe(true);
    } finally { await assembly.cleanup(); }
  });
});
