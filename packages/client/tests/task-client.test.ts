import { describe, expect, it } from 'vitest';
import { RuntimeClient } from '../src/index.js';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stream(type: string): Response {
  return new Response(`event: signal\ndata: ${JSON.stringify({ runId: 'run-1', type, occurredAt: '2026-08-14T00:00:01.000Z', ...(type === 'run.waiting' ? { data: { waitingReason: 'tool-result-unknown' } } : {}) })}\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  });
}

const queued = {
  runId: 'run-1', tenantId: 'tenant-a', principalId: 'p', sessionId: 's', agentId: 'a', agentRevision: '1', status: 'queued',
  trigger: { type: 'task', input: { ticketId: 'T-1' } }, contextSnapshot: { items: [], configLayers: [], promptSections: [] },
  createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z',
};

describe('RuntimeClient Task API', () => {
  it('execute 使用一次 POST、一次 SSE、一次终态 Run 和一次 Artifact 读取', async () => {
    const requests: Request[] = [];
    const client = new RuntimeClient({ baseUrl: 'https://runtime.test', fetch: async (input, init) => {
      const request = new Request(input, init); requests.push(request);
      if (request.method === 'POST') return json(queued, 201);
      if (request.url.endsWith('/stream')) return stream('run.completed');
      if (request.url.endsWith('/v1/runs/run-1')) return json({ ...queued, status: 'completed', primaryArtifactId: 'artifact-1', finishedAt: '2026-08-14T00:00:01.000Z', updatedAt: '2026-08-14T00:00:01.000Z' });
      if (request.url.endsWith('/v1/artifacts/artifact-1')) return json({
        artifactId: 'artifact-1', tenantId: 'tenant-a', sessionId: 's', runId: 'run-1', type: 'result',
        mediaType: 'application/json', name: 'result.json', data: '{"ok":true}', createdAt: '2026-08-14T00:00:01.000Z',
      });
      throw new Error(`Unexpected request: ${request.url}`);
    } });

    const outcome = await client.tasks.execute({ agentId: 'a', input: { ticketId: 'T-1' }, idempotencyKey: 'task-1' });
    expect(outcome).toMatchObject({ status: 'completed', result: { value: { ok: true } } });
    expect(requests.map((request) => request.url.replace('https://runtime.test', ''))).toEqual([
      '/v1/runs', '/v1/runs/run-1/stream', '/v1/runs/run-1', '/v1/artifacts/artifact-1',
    ]);
    expect(requests[0]?.headers.get('idempotency-key')).toBe('task-1');
    expect(await requests[0]?.json()).toEqual({ agentId: 'a', trigger: { type: 'task', input: { ticketId: 'T-1' } } });
  });

  it('waiting 返回未知 invocation，不把业务等待状态转换成异常', async () => {
    const client = new RuntimeClient({ baseUrl: 'https://runtime.test', fetch: async (input, init) => {
      const request = new Request(input, init);
      if (request.method === 'POST') return json(queued, 201);
      if (request.url.endsWith('/stream')) return stream('run.waiting');
      if (request.url.endsWith('/v1/runs/run-1')) return json({ ...queued, status: 'waiting', waitingReason: 'tool-result-unknown', errorCode: 'TOOL_RESULT_UNKNOWN', updatedAt: '2026-08-14T00:00:01.000Z' });
      if (request.url.endsWith('/tool-invocations')) return json([{
        invocationId: 'inv-1', tenantId: 'tenant-a', sessionId: 's', runId: 'run-1', nodeId: 'run-1:root', toolCallId: 'call-1', toolName: 'send',
        status: 'unknown', sideEffect: 'non-idempotent', supportsIdempotencyKey: false, input: {}, createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:01.000Z',
      }]);
      throw new Error(`Unexpected request: ${request.url}`);
    } });
    const outcome = await client.tasks.execute({ agentId: 'a', input: {} });
    expect(outcome.status).toBe('waiting');
    if (outcome.status === 'waiting') expect(outcome.unknownInvocations[0]?.invocationId).toBe('inv-1');
  });
});
