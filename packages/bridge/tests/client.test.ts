import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRemoteService } from '../src/agent-remote-service.js';

const WORKSPACE = 'default';

describe('AgentRemoteService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('requests run as a command and resolves void', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    const client = new AgentRemoteService('http://localhost:8321');
    const res = await client.run(WORKSPACE, 's1', 'hello');

    expect(res).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:8321/api/agent/run?workspace=${encodeURIComponent(WORKSPACE)}`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws when run response is not ok', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });

    const client = new AgentRemoteService('http://localhost:8321');
    await expect(client.run(WORKSPACE, 's1', 'hello')).rejects.toThrow(/500/);
  });
});

import type { AgentStreamChunk } from 'rem-agent-core';
import { createSSEResponse } from '../src/response.js';
import { parseSSEStream, parseAgentStreamEvent } from '../src/sse.js';

describe('createSSEResponse', () => {
  it('produces valid SSE stream from chunks', async () => {
    async function* gen(): AsyncIterable<AgentStreamChunk> {
      yield { type: 'text-start', step: 1, partId: 'p1' } as AgentStreamChunk;
      yield { type: 'text-delta', step: 1, partId: 'p1', text: 'hi' } as AgentStreamChunk;
      yield { type: 'finish', output: { content: 'hi', completed: true } } as AgentStreamChunk;
    }

    const response = createSSEResponse(gen());
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');

    const reader = response.body!.getReader();
    const sseEvents = parseSSEStream(reader);
    const chunks: AgentStreamChunk[] = [];
    for await (const sse of sseEvents) {
      if (sse.event === 'chunk' || sse.event === 'error') {
        chunks.push(parseAgentStreamEvent(sse));
      }
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0].type).toBe('text-start');
    expect(chunks[1].type).toBe('text-delta');
    expect(chunks[2].type).toBe('finish');
  });

  it('emits error SSE frame on stream exception', async () => {
    async function* gen(): AsyncIterable<AgentStreamChunk> {
      yield { type: 'text-delta', step: 1, partId: 'p1', text: 'a' } as AgentStreamChunk;
      throw new Error('boom');
    }

    const response = createSSEResponse(gen());
    const reader = response.body!.getReader();
    const sseEvents = parseSSEStream(reader);
    const chunks: AgentStreamChunk[] = [];
    for await (const sse of sseEvents) {
      if (sse.event === 'chunk' || sse.event === 'error') {
        chunks.push(parseAgentStreamEvent(sse));
      }
    }

    expect(chunks.some((c) => c.type === 'error')).toBe(true);
  });
});

describe('AgentRemoteService session methods', () => {
  it('creates a session', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sessionId: 's1', workspace: WORKSPACE, title: 'New Chat', updatedAt: 1, messageCount: 0 }),
    });

    const client = new AgentRemoteService('http://localhost:8321');
    const summary = await client.createSession(WORKSPACE);
    expect(summary.sessionId).toBe('s1');
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:8321/api/sessions?workspace=${encodeURIComponent(WORKSPACE)}`,
      { method: 'POST' },
    );
  });

  it('lists sessions', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { sessionId: 's1', workspace: WORKSPACE, title: 'A', updatedAt: 2, messageCount: 1 },
        { sessionId: 's2', workspace: WORKSPACE, title: 'B', updatedAt: 1, messageCount: 0 },
      ],
    });

    const client = new AgentRemoteService('http://localhost:8321');
    const list = await client.listSessions(WORKSPACE);
    expect(list).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:8321/api/sessions?workspace=${encodeURIComponent(WORKSPACE)}`,
    );
  });

  it('gets messages', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        sessionId: 's1',
        title: 'New Chat',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }], status: 'done' }],
      }),
    });

    const client = new AgentRemoteService('http://localhost:8321');
    const messages = await client.getMessages(WORKSPACE, 's1');
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('m1');
  });

  it('updates a session', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    fetchMock.mockResolvedValueOnce({ ok: true });

    const client = new AgentRemoteService('http://localhost:8321');
    await client.updateSession(WORKSPACE, 's1', { title: 'T', pinned: true });
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:8321/api/sessions/s1?workspace=${encodeURIComponent(WORKSPACE)}`,
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ title: 'T', pinned: true }) }),
    );
  });

  it('deletes a session', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    fetchMock.mockResolvedValueOnce({ ok: true });

    const client = new AgentRemoteService('http://localhost:8321');
    await client.deleteSession(WORKSPACE, 's1');
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:8321/api/sessions/s1?workspace=${encodeURIComponent(WORKSPACE)}`,
      { method: 'DELETE' },
    );
  });
});
