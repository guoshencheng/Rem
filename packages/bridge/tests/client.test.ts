import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentClient } from '../src/client.js';

describe('AgentClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('requests run and consumes stream', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessionId: 's1', streamUrl: '/api/stream/s1' }),
      })
      .mockResolvedValueOnce({
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

    const client = new AgentClient('http://localhost:8321');
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
