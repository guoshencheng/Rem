import { describe, expect, it } from 'vitest';
import type { AgentDefinition } from '../src/domain/agent-definition/types.js';
import type { AgentRun } from '../src/domain/run/types.js';
import type { ToolContext } from '../src/sdk/tool-provider.js';
import { buildExecutionPlan } from '../src/application/runs/execution-plan.js';
import { executeRuntimeChild } from '../src/execution/runtime-child-delegation.js';
import { createFakeRuntimeStore } from './helpers/fake-runtime-store.js';

const at = new Date('2026-08-14T04:00:00.000Z');
const definition: AgentDefinition = { agentId: 'agent', revision: '1', name: 'Agent', instructions: 'x', modelId: 'mock/mock-model', toolNames: [], acceptedTriggers: ['message'], execution: { type: 'single-agent' } };

describe('delegated node replay', () => {
  it('get-or-create prevents duplicate node and child execution on replay', async () => {
    const { store } = await createFakeRuntimeStore();
    const session = { sessionId: 'child-session', tenantId: 'tenant', contexts: { bindings: [] }, createdAt: at, updatedAt: at };
    const run: AgentRun = { runId: 'parent-run', tenantId: 'tenant', principalId: 'principal', sessionId: session.sessionId, agentId: definition.agentId, agentRevision: definition.revision, status: 'running', executionType: 'single-agent', executionPlanSnapshot: buildExecutionPlan(definition), rootNodeId: 'parent-run:root', trigger: { type: 'message', content: 'parent' }, contextSnapshot: { items: [], configLayers: [], promptSections: [] }, createdAt: at, updatedAt: at };
    await store.transaction((uow) => {
      uow.sessions.insert(session); uow.runs.insert(run);
      uow.executionNodes.insert({ nodeId: run.rootNodeId!, runId: run.runId, tenantId: run.tenantId, kind: 'root', role: 'root', agentId: run.agentId, agentRevision: run.agentRevision, status: 'running', depth: 0, createdAt: at, updatedAt: at });
      uow.executionBudgets.insert({ tenantId: run.tenantId, runId: run.runId, agentRuns: 1, messages: 0, tokens: 0, updatedAt: at });
    });
    const context: ToolContext = { cwd: '/', executionRoot: '/', invocationId: 'parent-invocation', tenantId: run.tenantId, principalId: run.principalId, runId: run.runId };
    let executions = 0;
    const options = { storage: store, parentRun: run, session, definition, input: { task: 'child' }, context, depth: 0, emitSignal: () => {}, execute: async () => { executions += 1; return { sessionEntries: [], artifacts: [{ type: 'result', mediaType: 'text/plain', name: 'child', data: 'done' }] }; } };
    await expect(executeRuntimeChild(options)).resolves.toMatchObject({ output: 'done' });
    await expect(executeRuntimeChild(options)).resolves.toMatchObject({ output: 'Child agent completed' });
    expect(executions).toBe(1);
    expect(await store.listExecutionNodes(run.runId)).toHaveLength(2);
    expect(await store.transaction((uow) => uow.executionBudgets.get(run.runId))).toMatchObject({ agentRuns: 2 });
  });
});
