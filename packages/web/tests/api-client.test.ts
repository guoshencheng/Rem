import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';

afterEach(() => vi.restoreAllMocks());

const session = {
  sessionId: 's1', tenantId: 'local-web', contexts: { bindings: [] },
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', messageCount: 3,
};

const run = (status: 'queued' | 'completed' = 'queued') => ({
  runId: 'run-1', tenantId: 'local-web', principalId: 'web-user', sessionId: 's1',
  agentId: 'web-agent', agentRevision: '1', status,
  trigger: { type: 'message', content: 'hello' },
  contextSnapshot: { items: [], configLayers: [], promptSections: [] },
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  ...(status === 'completed' ? { finishedAt: '2026-01-01T00:00:01.000Z' } : {}),
});

function stubFetch() {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/v1/sessions')) {
      return method === 'POST'
        ? new Response(JSON.stringify(session), { status: 201, headers: { 'Content-Type': 'application/json' } })
        : new Response(JSON.stringify([session]), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.endsWith('/v1/sessions/s1/entries')) {
      return new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.endsWith('/v1/runs')) {
      return new Response(JSON.stringify(run()), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.endsWith('/v1/runs/run-1')) {
      return new Response(JSON.stringify(run('completed')), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: { code: 'RUN_NOT_FOUND', message: 'Run not found', retryable: false } }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.spyOn(globalThis, 'fetch').mockImplementation(fn);
  return fn;
}

describe('Runtime Client web facade', () => {
  it('listSessions 请求 Runtime Service /v1/sessions', async () => {
    const fn = stubFetch();
    await expect(api.listSessions()).resolves.toMatchObject([{ sessionId: 's1', messageCount: 3 }]);
    expect(fn).toHaveBeenCalledWith('/v1/sessions', expect.objectContaining({ method: 'GET' }));
    expect(fn.mock.calls.filter(([input]) => String(input).endsWith('/v1/sessions/s1/entries'))).toHaveLength(0);
  });

  it('createSession 使用 Runtime Session API', async () => {
    const fn = stubFetch();
    await expect(api.createSession()).resolves.toMatchObject({ sessionId: 's1' });
    expect(fn).toHaveBeenCalledWith('/v1/sessions', expect.objectContaining({ method: 'POST' }));
  });

  it('sendMessage 创建 Run 并等待持久化终态', async () => {
    const fn = stubFetch();
    await api.sendMessage('s1', 'hello');
    const start = fn.mock.calls.find(([input]) => String(input).endsWith('/v1/runs'));
    expect(start?.[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String((start?.[1] as RequestInit).body))).toEqual({
      agentId: 'web-agent', sessionId: 's1', trigger: { type: 'message', content: 'hello' },
    });
    expect(new Headers((start?.[1] as RequestInit).headers).get('Idempotency-Key')).toMatch(/^web:s1:/);
  });

  it('Runtime Service 错误转换为用户可见异常', async () => {
    stubFetch();
    await expect(api.getChat('missing')).rejects.toThrow('Run not found');
  });

  it('发送链路只建立一次健康 SSE，并在终态后按需读取 entries', async () => {
    const requests: string[] = [];
    const signals: string[] = [];
    const entries = [
      { entryId: 'u1', tenantId: 'local-web', sessionId: 's1', runId: 'run-1', sequence: 1,
        message: { role: 'user', content: 'hello', timestamp: 1 }, createdAt: '2026-01-01T00:00:00.000Z' },
      { entryId: 'a1', tenantId: 'local-web', sessionId: 's1', runId: 'run-1', sequence: 2,
        message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }], timestamp: 2 }, createdAt: '2026-01-01T00:00:01.000Z' },
      { entryId: 't1', tenantId: 'local-web', sessionId: 's1', runId: 'run-1', sequence: 3,
        message: { role: 'toolResult', toolCallId: 'call-1', toolName: 'search', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: 3 }, createdAt: '2026-01-01T00:00:01.000Z' },
    ];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      requests.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/v1/runs') && init?.method === 'POST') {
        return new Response(JSON.stringify(run()), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/v1/runs/run-1/stream')) {
        const body = [
          'event: signal\ndata: {"runId":"run-1","type":"assistant.text.delta","data":{"messageIndex":0,"contentIndex":0,"delta":"hi"},"occurredAt":"2026-01-01T00:00:00.500Z"}\n\n',
          'event: signal\ndata: {"runId":"run-1","type":"run.completed","occurredAt":"2026-01-01T00:00:01.000Z"}\n\n',
        ].join('');
        return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (url.endsWith('/v1/runs/run-1')) {
        return new Response(JSON.stringify(run('completed')), { headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/v1/sessions/s1/entries')) {
        return new Response(JSON.stringify(entries), { headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/v1/sessions')) {
        return new Response(JSON.stringify([session]), { headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected request ${url}`);
    });

    await expect(api.sendMessage('s1', 'hello', {
      onSignal: (value) => signals.push(value.type),
    })).resolves.toMatchObject({ status: 'completed' });
    const chat = await api.getChat('s1');
    await api.listSessions();

    expect(signals).toEqual(['assistant.text.delta', 'run.completed']);
    expect(chat.messages).toHaveLength(2);
    expect(chat.toolResults).toEqual({ 'call-1': { output: 'ok' } });
    expect(requests.filter((request) => request === 'POST /v1/runs')).toHaveLength(1);
    expect(requests.filter((request) => request.endsWith('/v1/runs/run-1/stream'))).toHaveLength(1);
    expect(requests.filter((request) => request === 'GET /v1/runs/run-1')).toHaveLength(1);
    expect(requests.filter((request) => request.endsWith('/v1/sessions/s1/entries'))).toHaveLength(1);
    expect(requests.filter((request) => request === 'GET /v1/sessions')).toHaveLength(1);
  });
});
