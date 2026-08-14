import type { Run } from 'rem-agent-core';
import { describe, expect, it } from 'vitest';
import { RuntimeClient, RuntimeClientError } from '../src/index.js';

const queuedRun = (status: Run['status'] = 'queued'): Run => ({
  runId: 'run-1', tenantId: 'tenant-a', principalId: 'principal-a', sessionId: 'session-1',
  agentId: 'worker', agentRevision: '1', status, trigger: { type: 'message', content: 'hello' },
  contextSnapshot: { items: [], configLayers: [], promptSections: [] },
  createdAt: '2026-01-01T00:00:00.000Z' as unknown as Date,
  updatedAt: '2026-01-01T00:00:00.000Z' as unknown as Date,
});

function response(body: unknown, init: ResponseInit = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status: 200, headers: { 'content-type': 'application/json' }, ...init,
  });
}

describe('Runtime Client HTTP contract', () => {
  it('解码 ready 与 503 health 响应', async () => {
    let status = 200;
    const client = new RuntimeClient({ baseUrl: 'https://runtime.test', fetch: async () => response({
      status: status === 200 ? 'ready' : 'degraded', checkedAt: '2026-01-01T00:00:00Z',
      checks: { runtime: status === 200 ? 'ready' : 'not-ready', storage: status === 200 ? 'ok' : 'error', worker: 'stopped' },
      ...(status === 200 ? {} : { errorCode: 'STORAGE_UNAVAILABLE' }),
    }, { status }) });
    expect((await client.health.get()).status).toBe('ready');
    status = 503;
    expect((await client.health.get()).status).toBe('degraded');
  });
  it('访问 Runtime Session 列表、创建和消息条目', async () => {
    const session = {
      sessionId: 'session-1', tenantId: 'tenant-a', contexts: { bindings: [] },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const requests: Request[] = [];
    const client = new RuntimeClient({ baseUrl: 'https://runtime.test', fetch: async (input, init) => {
      const request = new Request(input, init); requests.push(request);
      if (request.method === 'POST') return response(session, { status: 201 });
      if (request.url.endsWith('/v1/sessions')) return response([session]);
      return response([{ entryId: 'entry-1', tenantId: 'tenant-a', sessionId: 'session-1', runId: 'run-1', sequence: 1, message: { role: 'user', content: 'hello' }, createdAt: session.createdAt }]);
    } });
    expect((await client.sessions.list())[0]?.createdAt).toBeInstanceOf(Date);
    expect((await client.sessions.create()).sessionId).toBe('session-1');
    expect((await client.sessions.listEntries('session-1'))[0]?.createdAt).toBeInstanceOf(Date);
    expect(requests.map((request) => request.url)).toEqual([
      'https://runtime.test/v1/sessions',
      'https://runtime.test/v1/sessions',
      'https://runtime.test/v1/sessions/session-1/entries',
    ]);
  });

  it('发送 JSON、Idempotency-Key 并把日期解码为 Date', async () => {
    const requests: Request[] = [];
    const client = new RuntimeClient({ baseUrl: 'https://runtime.test/', fetch: async (input, init) => {
      requests.push(new Request(input, init));
      return response(queuedRun());
    } });
    const run = await client.runs.start({
      agentId: 'worker', idempotencyKey: 'request-1', trigger: { type: 'message', content: 'hello' },
    });
    expect(run.createdAt).toBeInstanceOf(Date);
    expect(requests[0]?.url).toBe('https://runtime.test/v1/runs');
    expect(requests[0]?.headers.get('idempotency-key')).toBe('request-1');
    expect(await requests[0]?.json()).toEqual({ agentId: 'worker', trigger: { type: 'message', content: 'hello' } });
  });

  it('把结构化 Service 错误转换成 RuntimeClientError', async () => {
    const client = new RuntimeClient({ baseUrl: 'https://runtime.test', fetch: async () => response({
      error: { code: 'RUN_NOT_FOUND', message: 'Run not found', retryable: false },
    }, { status: 404 }) });
    await expect(client.runs.get('missing')).rejects.toMatchObject({
      code: 'RUN_NOT_FOUND', status: 404, message: 'Run not found',
    } satisfies Partial<RuntimeClientError>);
  });

  it('允许空 baseUrl 用于浏览器同源相对请求', async () => {
    const client = new RuntimeClient({ baseUrl: '', fetch: async (input) => {
      expect(String(input)).toBe('/v1/agents');
      return response([]);
    } });
    await expect(client.agents.list()).resolves.toEqual([]);
  });

  it('查询运行执行图并解码时间字段，空查询不追加问号', async () => {
    const requests: string[] = [];
    const client = new RuntimeClient({ baseUrl: 'https://runtime.test', fetch: async (input) => {
      requests.push(String(input));
      if (String(input).endsWith('/execution/nodes')) return response([{ nodeId: 'node-1', runId: 'run-1', tenantId: 'tenant-a', kind: 'root', role: 'root', agentId: 'worker', agentRevision: '1', status: 'completed', depth: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:01Z' }]);
      if (String(input).endsWith('/execution/entries')) return response([{ entryId: 'entry-1', tenantId: 'tenant-a', runId: 'run-1', nodeId: 'node-1', sequence: 1, kind: 'control', data: {}, audience: 'public', visibility: 'run', createdAt: '2026-01-01T00:00:00Z' }]);
      if (String(input).endsWith('/execution/deliveries')) return response([{ deliveryId: 'delivery-1', tenantId: 'tenant-a', runId: 'run-1', nodeId: 'node-1', kind: 'message', batchId: 'batch-1', depth: 0, status: 'completed', attempt: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:01Z' }]);
      if (String(input).endsWith('/tool-invocations')) return response([{ invocationId: 'inv-1', tenantId: 'tenant-a', sessionId: 'session-1', runId: 'run-1', nodeId: 'node-1', toolCallId: 'call-1', toolName: 'lookup', status: 'succeeded', sideEffect: 'none', supportsIdempotencyKey: false, input: {}, result: { output: 'ok' }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:01Z' }]);
      if (String(input).endsWith('/v1/runs')) return response({ items: [], nextCursor: undefined });
      throw new Error(`unexpected request ${String(input)}`);
    } });
    expect((await client.runs.list()).items).toEqual([]);
    expect((await client.runs.listExecutionNodes('run-1'))[0]?.createdAt).toBeInstanceOf(Date);
    expect((await client.runs.listExecutionEntries('run-1'))[0]?.createdAt).toBeInstanceOf(Date);
    expect((await client.runs.listDeliveries('run-1'))[0]?.updatedAt).toBeInstanceOf(Date);
    expect((await client.runs.listToolInvocations('run-1'))[0]?.updatedAt).toBeInstanceOf(Date);
    expect(requests[0]).toBe('https://runtime.test/v1/runs');
    expect(requests[2]).toBe('https://runtime.test/v1/runs/run-1/execution/entries');
  });
});
