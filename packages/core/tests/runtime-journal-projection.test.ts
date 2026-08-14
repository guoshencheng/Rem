import { describe, expect, it } from 'vitest';
import type { AgentRun } from '../src/domain/run/types.js';
import { buildExecutionPlan } from '../src/application/runs/execution-plan.js';
import { createWorker, fakeStore } from './helpers/local-worker-fixture.js';
import { fauxAssistantMessage, fauxToolCall } from './helpers/scripted-models.js';

const at = new Date('2026-08-14T02:00:00.000Z');

describe('Journal session projection', () => {
  it('rebuilds a journaled single-agent answer without using in-memory session entries', async () => {
    const store = await fakeStore();
    const run: AgentRun = {
      runId: 'journal-run', tenantId: 'tenant', principalId: 'principal', sessionId: 'journal-session',
      agentId: 'agent', agentRevision: '1', status: 'queued', executionType: 'single-agent', rootNodeId: 'journal-run:root',
      executionPlanSnapshot: buildExecutionPlan({ agentId: 'agent', revision: '1', name: 'Agent', instructions: 'x', modelId: 'mock/mock-model', toolNames: [], acceptedTriggers: ['task'], execution: { type: 'single-agent' } }),
      trigger: { type: 'task', input: {} }, contextSnapshot: { items: [], configLayers: [], promptSections: [] }, createdAt: at, updatedAt: at,
    };
    await store.transaction((uow) => {
      uow.sessions.insert({ sessionId: 'journal-session', tenantId: 'tenant', contexts: { bindings: [] }, createdAt: at, updatedAt: at });
      uow.runs.insert(run);
      uow.executionNodes.insert({ nodeId: 'journal-run:root', runId: run.runId, tenantId: run.tenantId, kind: 'root', role: 'root', agentId: run.agentId, agentRevision: run.agentRevision, status: 'queued', depth: 0, createdAt: at, updatedAt: at });
      uow.workItems.insert({ workItemId: 'journal-work', runId: run.runId, status: 'queued', attempt: 0, createdAt: at, updatedAt: at });
      uow.executionEntries.append({ entryId: 'journal-user', tenantId: 'tenant', runId: run.runId, nodeId: run.rootNodeId!, sequence: 1, kind: 'message', message: { role: 'user', content: 'do it', timestamp: at.getTime() }, audience: 'public', visibility: 'session', createdAt: at });
      uow.executionEntries.append({ entryId: 'journal-call', tenantId: 'tenant', runId: run.runId, nodeId: run.rootNodeId!, sequence: 2, kind: 'message', message: fauxAssistantMessage([fauxToolCall('lookup', {}, { id: 'tool-call' })]), audience: 'public', visibility: 'session', createdAt: at });
      uow.executionEntries.append({ entryId: 'journal-result', tenantId: 'tenant', runId: run.runId, nodeId: run.rootNodeId!, sequence: 3, kind: 'tool-result', message: { role: 'toolResult', toolCallId: 'tool-call', toolName: 'lookup', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: at.getTime() }, audience: 'public', visibility: 'session', createdAt: at });
      uow.executionEntries.append({ entryId: 'journal-final', tenantId: 'tenant', runId: run.runId, nodeId: run.rootNodeId!, sequence: 4, kind: 'message', message: fauxAssistantMessage('final'), audience: 'public', visibility: 'session', createdAt: at });
    });
    const worker = createWorker(store, { execute: async () => ({ sessionEntries: [], artifacts: [{ type: 'result', mediaType: 'text/plain', name: 'answer', data: 'final' }], journaled: true }) });
    await worker.drainOne();
    expect((await store.listSessionEntries('journal-session')).map((entry) => entry.message.role)).toEqual(['user', 'assistant', 'toolResult', 'assistant']);
    expect(await store.getRun(run.runId)).toMatchObject({ status: 'completed' });
  });
});
