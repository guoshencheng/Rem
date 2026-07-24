import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRemoteService } from '../src/agent-remote-service.js';

describe('AgentRemoteService apiPrefix', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('默认使用 /api 前缀', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal('fetch', fetchMock);
    const svc = new AgentRemoteService('http://example.com');
    await svc.listSessions('ws');
    expect(fetchMock.mock.calls[0][0]).toBe('http://example.com/api/sessions?workspace=ws');
  });

  it('支持自定义 apiPrefix', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal('fetch', fetchMock);
    const svc = new AgentRemoteService('http://example.com', { apiPrefix: '/api/rem' });
    await svc.listSessions('ws');
    expect(fetchMock.mock.calls[0][0]).toBe('http://example.com/api/rem/sessions?workspace=ws');
  });

  it('apiPrefix 尾部斜杠被去除', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const svc = new AgentRemoteService('http://example.com', { apiPrefix: '/api/rem/' });
    await svc.run('ws', 's1', 'hi');
    expect(fetchMock.mock.calls[0][0]).toBe('http://example.com/api/rem/agent/run?workspace=ws');
  });
});
