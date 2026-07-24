import { describe, it, expect, vi } from 'vitest';
import { ServiceError } from 'rem-agent-bridge';
import { createRemHandler } from '../src/router.js';

function mockService(overrides: Record<string, unknown> = {}) {
  return {
    run: vi.fn().mockResolvedValue(undefined),
    interrupt: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
    listSessions: vi.fn().mockResolvedValue([]),
    createSession: vi.fn().mockResolvedValue({ sessionId: 's1' }),
    getMessages: vi.fn().mockResolvedValue([]),
    updateSession: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    getTodos: vi.fn().mockResolvedValue([]),
    listPendingApprovals: vi.fn().mockResolvedValue([]),
    resolveApproval: vi.fn().mockResolvedValue({ ok: true }),
    listWorkspaces: vi.fn().mockResolvedValue([]),
    addWorkspace: vi.fn().mockResolvedValue({ path: '/w' }),
    removeWorkspace: vi.fn().mockResolvedValue(undefined),
    stream: vi.fn(),
    ...overrides,
  };
}

type MockService = ReturnType<typeof mockService>;

function post(url: string, body: unknown) {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('createRemHandler', () => {
  it('POST agent/run 调用 service.run 并返回 ok', async () => {
    const service = mockService();
    const handle = createRemHandler({ getAgentService: () => service as never });
    const res = await handle(post('/api/rem/agent/run?workspace=w1', { sessionId: 's1', content: 'hi' }), ['agent', 'run']);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(service.run).toHaveBeenCalledWith('w1', 's1', 'hi');
  });

  it('POST agent/run 缺 content 返回 400', async () => {
    const handle = createRemHandler({ getAgentService: () => mockService() as never });
    const res = await handle(post('/api/rem/agent/run', { sessionId: 's1' }), ['agent', 'run']);
    expect(res.status).toBe(400);
  });

  it('坏 JSON body 返回 400', async () => {
    const handle = createRemHandler({ getAgentService: () => mockService() as never });
    const req = new Request('http://localhost/api/rem/agent/run', { method: 'POST', body: '{bad' });
    const res = await handle(req, ['agent', 'run']);
    expect(res.status).toBe(400);
  });

  it('GET sessions/:id 解析路径参数', async () => {
    const service = mockService();
    const handle = createRemHandler({ getAgentService: () => service as never });
    const res = await handle(
      new Request('http://localhost/api/rem/sessions/abc?workspace=w'),
      ['sessions', 'abc'],
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBe('abc');
  });

  it('DELETE sessions/:id 调用 deleteSession', async () => {
    const service = mockService();
    const handle = createRemHandler({ getAgentService: () => service as never });
    const req = new Request('http://localhost/api/rem/sessions/abc', { method: 'DELETE' });
    const res = await handle(req, ['sessions', 'abc']);
    expect(res.status).toBe(200);
    expect(service.deleteSession).toHaveBeenCalledWith('default', 'abc');
  });

  it('PATCH sessions/:id 调用 updateSession', async () => {
    const service = mockService();
    const handle = createRemHandler({ getAgentService: () => service as never });
    const req = new Request('http://localhost/api/rem/sessions/abc?workspace=w', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'T', pinned: true }),
    });
    const res = await handle(req, ['sessions', 'abc']);
    expect(res.status).toBe(200);
    expect(service.updateSession).toHaveBeenCalledWith('w', 'abc', { title: 'T', pinned: true });
  });

  it('POST approvals/:id/resolve 校验 sessionId 与 decision', async () => {
    const handle = createRemHandler({ getAgentService: () => mockService() as never });
    const res = await handle(post('/api/rem/approvals/a1/resolve', { sessionId: 's1' }), ['approvals', 'a1', 'resolve']);
    expect(res.status).toBe(400);
  });

  it('未匹配路径返回 404', async () => {
    const handle = createRemHandler({ getAgentService: () => mockService() as never });
    const res = await handle(new Request('http://localhost/api/rem/nope'), ['nope']);
    expect(res.status).toBe(404);
  });

  it('方法不匹配返回 404', async () => {
    const handle = createRemHandler({ getAgentService: () => mockService() as never });
    const res = await handle(new Request('http://localhost/api/rem/agent/run'), ['agent', 'run']);
    expect(res.status).toBe(404);
  });

  it('ServiceError 映射其 status', async () => {
    const service: MockService = mockService({
      listSessions: vi.fn().mockRejectedValue(new ServiceError('forbidden', 403)),
    });
    const handle = createRemHandler({ getAgentService: () => service as never });
    const res = await handle(new Request('http://localhost/api/rem/sessions'), ['sessions']);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('普通异常映射 500', async () => {
    const service: MockService = mockService({
      listSessions: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const handle = createRemHandler({ getAgentService: () => service as never });
    const res = await handle(new Request('http://localhost/api/rem/sessions'), ['sessions']);
    expect(res.status).toBe(500);
  });

  it('GET agent/stream 返回 SSE 响应', async () => {
    const service = mockService({
      stream: vi.fn().mockReturnValue((async function* () {})()),
    });
    const handle = createRemHandler({ getAgentService: () => service as never });
    const res = await handle(new Request('http://localhost/api/rem/agent/stream'), ['agent', 'stream']);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });
});
