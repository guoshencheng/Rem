import { describe, expect, it } from 'vitest';
import type { AgentDefinition } from '../src/domain/agent-definition/types.js';
import type { AgentRun } from '../src/domain/run/types.js';
import type { AgentSession } from '../src/domain/session/types.js';
import { SingleAgentRunExecutor } from '../src/execution/single-agent-run-executor.js';
import { RuntimePluginHost } from '../src/plugin-system/runtime-plugin-host.js';
import { StaticAgentDefinitionProvider } from '../src/plugins/agent-definition/static/provider.js';
import { createFakeAssembly } from './helpers/fake-di.js';
import { createFakeRuntimeStore } from './helpers/fake-runtime-store.js';
import { createScriptedModels, fauxAssistantMessage, fauxToolCall } from './helpers/scripted-models.js';

const at = new Date('2026-08-14T00:00:00.000Z');
const session: AgentSession = { sessionId: 'delegation-session', tenantId: 'tenant', contexts: { bindings: [] }, createdAt: at, updatedAt: at };
const definition: AgentDefinition = {
  agentId: 'agent', revision: '1', name: 'Agent', instructions: 'parent instructions', modelId: 'mock/mock-model',
  toolNames: [], acceptedTriggers: ['message'], execution: { type: 'single-agent', delegation: { enabled: true, maxDepth: 2 } },
};
const run: AgentRun = {
  runId: 'delegation-run', tenantId: 'tenant', principalId: 'principal', sessionId: session.sessionId,
  agentId: definition.agentId, agentRevision: definition.revision, status: 'running',
  trigger: { type: 'message', content: 'parent task' }, contextSnapshot: { items: [], configLayers: [], promptSections: [] },
  createdAt: at, startedAt: at, updatedAt: at,
};

describe('runtime delegate_task', () => {
  it('在同一 Run 内创建 delegated node，不创建 child session', async () => {
    const scripted = createScriptedModels([
      fauxAssistantMessage([fauxToolCall('delegate_task', { task: 'child task', systemPrompt: 'child instructions' })]),
      fauxAssistantMessage('child result'),
      fauxAssistantMessage('parent result'),
    ]);
    const assembly = await createFakeAssembly({ models: scripted.models });
    const { store } = await createFakeRuntimeStore();
    await store.transaction((uow) => { uow.sessions.insert(session); uow.runs.insert(run); });
    const executor = new SingleAgentRunExecutor({ models: assembly.models, config: assembly.runtimeConfigProvider, executionRoot: assembly.executionRoot, storage: store,
      agentDefinitions: new StaticAgentDefinitionProvider([definition]), pluginHost: new RuntimePluginHost() });

    const result = await executor.execute({ run, session, signal: new AbortController().signal });
    expect(result.artifacts).toEqual([{ type: 'result', mediaType: 'text/plain', name: 'result.txt', data: 'parent result' }]);
    expect(scripted.state.callCount).toBe(3);
    const nodes = await store.listExecutionNodes(run.runId);
    expect(nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'delegated', status: 'completed', depth: 1, parentNodeId: 'delegation-run:root' }),
    ]));
    expect(await store.getSession(session.sessionId)).toEqual(session);
    await assembly.cleanup();
  });
});
