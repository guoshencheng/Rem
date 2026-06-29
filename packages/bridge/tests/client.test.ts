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
