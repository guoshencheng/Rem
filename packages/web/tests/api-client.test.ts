import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body?: unknown) {
  const fn = vi.fn(async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('api client', () => {
  it('listSessions 请求 /api/rem/sessions', async () => {
    const fn = stubFetch(200, []);
    await api.listSessions();
    expect(fn).toHaveBeenCalledWith('/api/rem/sessions', undefined);
  });

  it('createSession 带 teamId POST', async () => {
    const fn = stubFetch(201, { sessionId: 's1' });
    await api.createSession('research');
    expect(fn).toHaveBeenCalledWith('/api/rem/sessions', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({ teamId: 'research' });
  });

  it('sendMessage 发送 content', async () => {
    const fn = stubFetch(204);
    await api.sendMessage('s1', 'hello');
    expect(fn).toHaveBeenCalledWith('/api/rem/sessions/s1/send', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({ content: 'hello' });
  });

  it('非 2xx 抛出带 error 信息的异常', async () => {
    stubFetch(404, { error: 'Session not found: x' });
    await expect(api.getChat('x')).rejects.toThrow('Session not found: x');
  });
});
