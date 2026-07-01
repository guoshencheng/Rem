import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRemoteService } from '../src/agent-remote-service.js';

describe('AgentRemoteService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('requests run and consumes stream', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    fetchMock.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => {
          const encoder = new TextEncoder();
          let done = false;
          return {
            read: async () => {
              if (done) return { done: true, value: undefined };
              done = true;
              return {
                done: false,
                value: encoder.encode(
                  'event: chunk\n' +
                    'data: {"type":"text-start","step":1,"partId":"p1"}\n\n' +
                    'event: chunk\n' +
                    'data: {"type":"text-delta","step":1,"partId":"p1","text":"hi"}\n\n' +
                    'event: chunk\n' +
                    'data: {"type":"finish","output":{"content":"hi","completed":true}}\n\n',
                ),
              };
            },
          };
        },
      },
    });

    const client = new AgentRemoteService('http://localhost:8321');
    const stream = await client.run('s1', 'hello');
    const chunks: any[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0].type).toBe('text-start');
    expect(chunks[1].type).toBe('text-delta');
    expect(chunks[2].type).toBe('finish');
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
      json: async () => ({ sessionId: 's1', title: 'New Chat', updatedAt: 1, messageCount: 0 }),
    });

    const client = new AgentRemoteService('http://localhost:8321');
    const summary = await client.createSession();
    expect(summary.sessionId).toBe('s1');
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8321/api/sessions', { method: 'POST' });
  });

  it('lists sessions', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { sessionId: 's1', title: 'A', updatedAt: 2, messageCount: 1 },
        { sessionId: 's2', title: 'B', updatedAt: 1, messageCount: 0 },
      ],
    });

    const client = new AgentRemoteService('http://localhost:8321');
    const list = await client.listSessions();
    expect(list).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8321/api/sessions');
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
    const messages = await client.getMessages('s1');
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('m1');
  });

  it('updates a session', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    fetchMock.mockResolvedValueOnce({ ok: true });

    const client = new AgentRemoteService('http://localhost:8321');
    await client.updateSession('s1', { title: 'T', pinned: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8321/api/sessions/s1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ title: 'T', pinned: true }) }),
    );
  });

  it('deletes a session', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    fetchMock.mockResolvedValueOnce({ ok: true });

    const client = new AgentRemoteService('http://localhost:8321');
    await client.deleteSession('s1');
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8321/api/sessions/s1', { method: 'DELETE' });
  });
});
