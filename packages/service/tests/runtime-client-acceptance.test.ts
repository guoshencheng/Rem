import type {
  AgentDefinition, AgentRuntime, AgentRun, RuntimeRequestContext, ScopedAgentRuntime,
} from 'rem-agent-core';
import { RuntimeError } from 'rem-agent-core';
import { describe, expect, it } from 'vitest';
import { RuntimeClient } from '../../client/src/index.js';
import { createRuntimeService } from '../src/index.js';

const definition: AgentDefinition = {
  agentId: 'ticket-worker', revision: '1', name: 'Ticket Worker', instructions: 'Handle tickets',
  modelId: 'mock/mock-model', toolNames: [], acceptedTriggers: ['message'], execution: { type: 'single-agent' },
};
const contextA: RuntimeRequestContext = {
  tenantId: 'tenant-a', principal: { principalId: 'operator-a', roles: ['operator'] },
};

function createAcceptanceHarness() {
  const runs = new Map<string, AgentRun>();
  const idempotency = new Map<string, string>();
  let nextId = 1;
  const artifacts = [{
    artifactId: 'artifact-1', tenantId: 'tenant-a', sessionId: 'session-1', runId: 'run-1',
    type: 'result', mediaType: 'text/plain', name: 'answer', data: 'Ticket T-1001 is open', createdAt: new Date('2026-01-01T00:00:01Z'),
  }];
  const events = [{
    eventId: 'event-1', sequence: 1, schemaVersion: 1 as const, tenantId: 'tenant-a', sessionId: 'session-1', runId: 'run-1',
    type: 'run.created', data: {}, occurredAt: new Date('2026-01-01T00:00:00Z'),
  }];

  const scoped = (request: RuntimeRequestContext): ScopedAgentRuntime => ({
    agents: {
      list: async () => [definition],
      get: async (agentId, revision) => {
        if (agentId !== definition.agentId || (revision !== undefined && revision !== definition.revision)) {
          throw new RuntimeError('AGENT_NOT_FOUND', 'Agent not found');
        }
        return definition;
      },
    },
    sessions: {
      list: async () => [],
      create: async () => ({ sessionId: 'session-new', tenantId: request.tenantId, contexts: { bindings: [] }, createdAt: new Date(), updatedAt: new Date() }),
      get: async () => ({ sessionId: 'session-1', tenantId: request.tenantId, contexts: { bindings: [] }, createdAt: new Date(), updatedAt: new Date() }),
      listEntries: async () => [],
    },
    runs: {
      start: async (input) => {
        const key = input.idempotencyKey;
        const existingId = key === undefined ? undefined : idempotency.get(`${request.tenantId}:${key}`);
        if (existingId) return runs.get(existingId)!;
        const runId = `run-${nextId++}`;
        const run: AgentRun = {
          runId, tenantId: request.tenantId, principalId: request.principal.principalId, sessionId: 'session-1',
          agentId: input.agentId, agentRevision: input.agentRevision ?? '1', status: 'queued', trigger: input.trigger,
          contextSnapshot: { items: [], configLayers: [], promptSections: [] },
          createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
        };
        runs.set(runId, run);
        if (key !== undefined) idempotency.set(`${request.tenantId}:${key}`, runId);
        return run;
      },
      get: async (runId) => {
        const run = runs.get(runId);
        if (!run || run.tenantId !== request.tenantId) throw new RuntimeError('RUN_NOT_FOUND', 'Run not found');
        return run;
      },
      cancel: async (runId) => {
        const run = await scoped(request).runs.get(runId);
        const cancelled = { ...run, status: 'cancelled' as const, finishedAt: new Date(), updatedAt: new Date() };
        runs.set(runId, cancelled);
        return cancelled;
      },
      listEvents: async (runId) => {
        await scoped(request).runs.get(runId);
        return events.filter((event) => event.runId === runId);
      },
      subscribe: (runId) => ({
        async *[Symbol.asyncIterator]() {
          const run = await scoped(request).runs.get(runId);
          const completed = { ...run, status: 'completed' as const, finishedAt: new Date('2026-01-01T00:00:01Z'), updatedAt: new Date('2026-01-01T00:00:01Z') };
          runs.set(runId, completed);
          yield { runId, type: 'run.completed', occurredAt: completed.finishedAt! };
        },
      }),
      waitForCompletion: async (runId) => scoped(request).runs.get(runId),
    },
    artifacts: {
      listByRun: async (runId) => {
        await scoped(request).runs.get(runId);
        return artifacts.map((artifact) => ({ ...artifact, runId }));
      },
    },
  });

  const runtime: AgentRuntime = {
    initialize: async () => {}, shutdown: async () => {},
    health: async () => ({ status: 'ready', checkedAt: new Date(), checks: { runtime: 'ready', storage: 'ok', worker: 'running' } }),
    as: scoped,
  };
  const service = createRuntimeService({
    runtime,
    authenticator: {
      authenticate: (request) => {
        const tenantId = request.headers.get('x-tenant-id') ?? contextA.tenantId;
        return { ...contextA, tenantId, principal: { ...contextA.principal, principalId: `${tenantId}-operator` } };
      },
    },
    streamKeepAliveMs: 0,
  });
  const client = (tenantId = contextA.tenantId) => new RuntimeClient({
    baseUrl: 'http://runtime.test',
    headers: { 'x-tenant-id': tenantId },
    fetch: service.fetch,
  });
  return { client, events };
}

describe('Runtime Service + Client acceptance', () => {
  it('通过远程协议完成创建、SSE 等待、事件和 Artifact 查询，并保持租户隔离', async () => {
    const { client } = createAcceptanceHarness();
    const first = await client().runs.start({
      agentId: 'ticket-worker', idempotencyKey: 'ticket-1001', trigger: { type: 'message', content: '处理 T-1001' },
    });
    const duplicate = await client().runs.start({
      agentId: 'ticket-worker', idempotencyKey: 'ticket-1001', trigger: { type: 'message', content: '处理 T-1001' },
    });
    expect(duplicate.runId).toBe(first.runId);

    const completed = await client().runs.waitForCompletion(first.runId, { pollMs: 5 });
    expect(completed.status).toBe('completed');
    expect((await client().runs.listEvents(first.runId))[0]?.type).toBe('run.created');
    expect((await client().artifacts.listByRun(first.runId))[0]?.data).toBe('Ticket T-1001 is open');

    await expect(client('tenant-b').runs.get(first.runId)).rejects.toMatchObject({ code: 'RUN_NOT_FOUND', status: 404 });
  });
});
