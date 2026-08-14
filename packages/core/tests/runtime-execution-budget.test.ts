import { describe, expect, it } from 'vitest';
import type { AgentRun } from '../src/domain/run/types.js';
import { buildExecutionPlan } from '../src/application/runs/execution-plan.js';
import { appendRunExecutionMessage } from '../src/execution/run-execution-journal.js';
import { createFakeRuntimeStore } from './helpers/fake-runtime-store.js';
import { fauxAssistantMessage } from './helpers/scripted-models.js';

const at = new Date('2026-08-14T03:00:00.000Z');

describe('durable execution budget', () => {
  it('counts journal messages in the same transaction and rolls back over-limit writes', async () => {
    const { store } = await createFakeRuntimeStore();
    const basePlan = buildExecutionPlan({ agentId: 'agent', revision: '1', name: 'Agent', instructions: 'x', modelId: 'mock/mock-model', toolNames: [], acceptedTriggers: ['message'], execution: { type: 'single-agent' } });
    const run: AgentRun = { runId: 'budget-run', tenantId: 'tenant', principalId: 'principal', sessionId: 'budget-session', agentId: 'agent', agentRevision: '1', status: 'running', executionType: 'single-agent', executionPlanSnapshot: { ...basePlan, limits: { ...basePlan.limits, maxMessages: 1, maxTokens: 1 } }, rootNodeId: 'budget-run:root', trigger: { type: 'message', content: 'go' }, contextSnapshot: { items: [], configLayers: [], promptSections: [] }, createdAt: at, updatedAt: at };
    await store.transaction((uow) => {
      uow.sessions.insert({ sessionId: run.sessionId, tenantId: run.tenantId, contexts: { bindings: [] }, createdAt: at, updatedAt: at });
      uow.runs.insert(run);
      uow.executionNodes.insert({ nodeId: run.rootNodeId!, runId: run.runId, tenantId: run.tenantId, kind: 'root', role: 'root', agentId: run.agentId, agentRevision: run.agentRevision, status: 'running', depth: 0, createdAt: at, updatedAt: at });
      uow.executionBudgets.insert({ tenantId: run.tenantId, runId: run.runId, agentRuns: 1, messages: 0, tokens: 0, updatedAt: at });
    });
    await appendRunExecutionMessage(store, run, { role: 'user', content: 'go', timestamp: at.getTime() }, at);
    await expect(appendRunExecutionMessage(store, run, fauxAssistantMessage('too many', { timestamp: at.getTime() }), at)).rejects.toMatchObject({ code: 'RUN_CONFLICT', details: { reason: 'maxMessages', max: 1, actual: 2 } });
    expect(await store.listExecutionEntries(run.runId)).toHaveLength(1);
    expect(await store.transaction((uow) => uow.executionBudgets.get(run.runId))).toMatchObject({ messages: 1, tokens: 0 });
  });
});
