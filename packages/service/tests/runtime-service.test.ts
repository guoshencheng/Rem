import type { AgentDefinition, AgentRuntime, Run, RunSignal, RuntimeRequestContext, ScopedAgentRuntime } from 'rem-agent-core';
import { RuntimeError } from 'rem-agent-core';
import { describe, expect, it, vi } from 'vitest';
import { createRuntimeService } from '../src/index.js';

const requestContext: RuntimeRequestContext = {
  tenantId: 'tenant-a', principal: { principalId: 'principal-a', roles: ['operator'] },
};
const run: Run = {
  runId: 'run-1', tenantId: 'tenant-a', principalId: 'principal-a', sessionId: 'session-1',
  agentId: 'worker', agentRevision: '1', status: 'queued',
  trigger: { type: 'message', content: 'hello' }, contextSnapshot: { items: [], configLayers: [], promptSections: [] },
  createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function setup(options: { run?: Run; fail?: RuntimeError; signals?: RunSignal[] } = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const scoped: ScopedAgentRuntime = {
    agents: {
      list: async () => [],
      get: async () => ({ agentId: 'worker', revision: '1', name: 'Worker', instructions: '', modelId: 'mock', toolNames: [], acceptedTriggers: ['message'], execution: { type: 'single-agent' } } satisfies AgentDefinition),
    },
    sessions: {
      list: async () => [],
      create: async () => ({ sessionId: 'new-session', tenantId: 'tenant-a', contexts: { bindings: [] }, version: 0, createdAt: new Date(), updatedAt: new Date() }),
      get: async (id) => ({ sessionId: id, tenantId: 'tenant-a', contexts: { bindings: [] }, createdAt: new Date(), updatedAt: new Date() }),
      listEntries: async () => [],
      patchContexts: async (id, patch, expectedVersion) => ({ sessionId: id, tenantId: 'tenant-a', contexts: { bindings: patch as never }, version: expectedVersion + 1, createdAt: new Date(), updatedAt: new Date() }),
    },
    runs: {
      start: async (input) => { calls.push({ method: 'start', args: [input] }); return options.run ?? run; },
      list: async () => ({ items: [options.run ?? run], nextCursor: 'next' }),
      get: async (id) => { calls.push({ method: 'get', args: [id] }); return options.run ?? run; },
      cancel: async (id) => { calls.push({ method: 'cancel', args: [id] }); return { ...(options.run ?? run), runId: id, status: 'cancelled' }; },
      listEvents: async (id, after, limit) => { calls.push({ method: 'events', args: [id, after, limit] }); return []; },
      subscribe: () => ({ async *[Symbol.asyncIterator]() {
        for (const signal of options.signals ?? [{ runId: 'run-1', type: 'run.completed', occurredAt: new Date('2026-01-01T00:00:01Z') }]) yield signal;
      } }),
      waitForCompletion: async () => options.run ?? run,
      listExecutionNodes: async (id) => { calls.push({ method: 'nodes', args: [id] }); return []; },
      listExecutionEntries: async (id, query) => { calls.push({ method: 'entries', args: [id, query] }); return []; },
      listDeliveries: async (id) => { calls.push({ method: 'deliveries', args: [id] }); return []; },
      listToolInvocations: async (id) => { calls.push({ method: 'invocations', args: [id] }); return []; },
      resolveToolInvocation: async (id, invocationId, resolution) => { calls.push({ method: 'resolve', args: [id, invocationId, resolution] }); return options.run ?? run; },
    },
    artifacts: { listByRun: async () => [], get: async () => ({ artifactId: 'artifact-1', tenantId: 'tenant-a', sessionId: 'session-1', runId: 'run-1', type: 'result', mediaType: 'text/plain', name: 'answer', data: 'ok', createdAt: new Date() }) },
  };
  const runtime: AgentRuntime = { initialize: async () => {}, shutdown: async () => {}, health: async () => ({
    status: 'ready', checkedAt: new Date(), checks: { runtime: 'ready', storage: 'ok', worker: 'running' },
  }), as: (context) => {
    calls.push({ method: 'as', args: [context] });
    if (options.fail) throw options.fail;
    return scoped;
  } };
  const service = createRuntimeService({ runtime, authenticator: { authenticate: () => requestContext }, streamKeepAliveMs: 0 });
  return { service, calls };
}

describe('Runtime Service HTTP contract', () => {
  it('health 路径无需认证，并将 degraded 返回 503', async () => {
    const authenticate = vi.fn();
    const runtime: AgentRuntime = {
      initialize: async () => {}, shutdown: async () => {},
      health: async () => ({ status: 'degraded', checkedAt: new Date('2026-01-01T00:00:00Z'), checks: { runtime: 'ready', storage: 'error', worker: 'running' }, errorCode: 'STORAGE_UNAVAILABLE' }),
      as: () => { throw new Error('health must not create a scope'); },
    };
    const service = createRuntimeService({ runtime, authenticator: { authenticate } });
    const response = await service.fetch(new Request('http://runtime.test/v1/health'));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: 'degraded', checks: { storage: 'error' } });
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('认证上下文来自 authenticator，幂等键从 header 进入 Core', async () => {
    const { service, calls } = setup();
    const response = await service.fetch(new Request('http://runtime.test/v1/runs', {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'request-1' },
      body: JSON.stringify({ agentId: 'worker', trigger: { type: 'message', content: 'hello' } }),
    }));
    expect(response.status).toBe(201);
    expect(calls).toContainEqual({ method: 'as', args: [requestContext] });
    expect(calls.find((call) => call.method === 'start')?.args[0]).toMatchObject({ idempotencyKey: 'request-1' });
  });

  it('拒绝 body 中伪造的 tenant/principal', async () => {
    const { service } = setup();
    const response = await service.fetch(new Request('http://runtime.test/v1/runs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'worker', tenantId: 'spoofed', trigger: { type: 'message', content: 'hello' } }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  });

  it('拒绝 body 中伪造的 idempotencyKey', async () => {
    const { service } = setup();
    const response = await service.fetch(new Request('http://runtime.test/v1/runs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'worker', idempotencyKey: 'body-key', trigger: { type: 'message', content: 'hello' } }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  });

  it('资源、事件、Artifact 和取消路由调用 scoped Runtime', async () => {
    const { service, calls } = setup();
    expect((await service.fetch(new Request('http://runtime.test/v1/runs/run-1'))).status).toBe(200);
    expect((await service.fetch(new Request('http://runtime.test/v1/runs/run-1/events?afterSequence=2&limit=5'))).status).toBe(200);
    expect((await service.fetch(new Request('http://runtime.test/v1/runs/run-1/artifacts'))).status).toBe(200);
    expect((await service.fetch(new Request('http://runtime.test/v1/runs/run-1/cancel', { method: 'POST' }))).status).toBe(200);
    expect(calls.map((call) => call.method)).toEqual(['as', 'get', 'as', 'events', 'as', 'as', 'cancel']);
  });

  it('将 RuntimeError 映射为稳定错误对象且不泄露未知异常', async () => {
    const { service } = setup({ fail: new RuntimeError('FORBIDDEN', 'not allowed') });
    const response = await service.fetch(new Request('http://runtime.test/v1/runs/run-1'));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'not allowed', retryable: false } });
  });

  it('将工具未知结果映射为可处置冲突，而不是服务器错误', async () => {
    const { service } = setup({ fail: new RuntimeError('TOOL_RESULT_UNKNOWN', 'operator action required') });
    const response = await service.fetch(new Request('http://runtime.test/v1/runs/run-1'));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'TOOL_RESULT_UNKNOWN', message: 'operator action required' } });
  });

  it('SSE 使用 signal 事件并在订阅结束后关闭', async () => {
    const { service } = setup();
    const response = await service.fetch(new Request('http://runtime.test/v1/runs/run-1/stream'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    expect(await response.text()).toContain('event: signal');
  });

  it('SSE 按顺序透传文本、工具和终态 Signal', async () => {
    const { service } = setup({ signals: [
      { runId: 'run-1', type: 'assistant.text.delta', data: { messageIndex: 0, contentIndex: 0, delta: 'hi' }, occurredAt: new Date('2026-01-01T00:00:01Z') },
      { runId: 'run-1', type: 'tool.execution.started', data: { toolCallId: 'call-1', toolName: 'search', input: { q: 'rem' } }, occurredAt: new Date('2026-01-01T00:00:02Z') },
      { runId: 'run-1', type: 'run.completed', occurredAt: new Date('2026-01-01T00:00:03Z') },
    ] });
    const body = await (await service.fetch(new Request('http://runtime.test/v1/runs/run-1/stream'))).text();
    expect(body.indexOf('assistant.text.delta')).toBeLessThan(body.indexOf('tool.execution.started'));
    expect(body.indexOf('tool.execution.started')).toBeLessThan(body.indexOf('run.completed'));
  });

  it('Runtime Session 路由支持列表、创建和 entries，并保持认证边界', async () => {
    const { service, calls } = setup();
    const list = await service.fetch(new Request('http://runtime.test/v1/sessions'));
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([]);
    const created = await service.fetch(new Request('http://runtime.test/v1/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }));
    expect(created.status).toBe(201);
    expect((await created.json()).sessionId).toBe('new-session');
    const entries = await service.fetch(new Request('http://runtime.test/v1/sessions/session-1/entries'));
    expect(entries.status).toBe(200);
    expect(await entries.json()).toEqual([]);
    expect(calls.map((call) => call.method)).toEqual(['as', 'as', 'as']);
  });

  it('Runtime Session 创建拒绝请求体伪造租户或 principal', async () => {
    const { service } = setup();
    const response = await service.fetch(new Request('http://runtime.test/v1/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: 'spoofed' }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  });

  it('暴露执行图、工具处置、Artifact 和 Context patch 路由', async () => {
    const { service, calls } = setup();
    const requests: Array<[string, string, unknown?]> = [
      ['GET', '/v1/runs/run-1/execution/nodes'],
      ['GET', '/v1/runs/run-1/execution/entries?afterSequence=3&limit=7'],
      ['GET', '/v1/runs/run-1/execution/deliveries'],
      ['GET', '/v1/runs/run-1/tool-invocations'],
      ['GET', '/v1/artifacts/artifact-1'],
      ['PATCH', '/v1/sessions/session-1/contexts', { patch: { bindings: [] }, expectedVersion: 0 }],
      ['POST', '/v1/runs/run-1/tool-invocations/inv-1/resolve', { action: 'fail', idempotencyKey: 'resolve-1' }],
    ];
    for (const [method, path, body] of requests) {
      const response = await service.fetch(new Request(`http://runtime.test${path}`, {
        method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
      }));
      expect(response.status).toBe(200);
    }
    expect(calls.filter((call) => call.method !== 'as').map((call) => call.method)).toEqual(['nodes', 'entries', 'deliveries', 'invocations', 'resolve']);
    expect(calls.find((call) => call.method === 'entries')?.args[1]).toEqual({ afterSequence: 3, limit: 7 });
  });
});
