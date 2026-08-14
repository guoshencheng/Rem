import { describe, expect, it } from 'vitest';
import { RuntimeClient } from '../src/index.js';

function streamResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const chunks = frames.map((frame) => encoder.encode(frame));
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function runResponse(status: 'queued' | 'completed'): Response {
  return new Response(JSON.stringify({
    runId: 'run-1', tenantId: 'tenant-a', principalId: 'p', sessionId: 's', agentId: 'a', agentRevision: '1', status,
    trigger: { type: 'message', content: 'x' }, contextSnapshot: { items: [], configLayers: [], promptSections: [] },
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:01Z',
    ...(status === 'completed' ? { finishedAt: '2026-01-01T00:00:01Z' } : {}),
  }), { headers: { 'content-type': 'application/json' } });
}

describe('Runtime Client SSE', () => {
  it('解析跨 chunk 的 signal 帧，并忽略 heartbeat/comment', async () => {
    const client = new RuntimeClient({ baseUrl: 'https://runtime.test', fetch: async () => streamResponse([
      ': heartbeat\n\nevent: sig',
      'nal\ndata: {"runId":"run-1","type":"run.completed","occurredAt":"2026-01-01T00:00:01.000Z"}\n\n',
    ]) });
    const signals = [];
    for await (const signal of client.runs.subscribe('run-1')) signals.push(signal);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.type).toBe('run.completed');
    expect(signals[0]?.occurredAt).toBeInstanceOf(Date);
  });

  it('严格解码文本与 reasoning 实时 Signal，同时保留 JSON 工具 payload', async () => {
    const client = new RuntimeClient({ baseUrl: 'https://runtime.test', fetch: async () => streamResponse([
      'event: signal\ndata: {"runId":"run-1","type":"assistant.text.delta","data":{"messageIndex":0,"contentIndex":0,"delta":"hi"},"occurredAt":"2026-01-01T00:00:01.000Z"}\n\n',
      'event: signal\ndata: {"runId":"run-1","type":"tool.execution.started","data":{"toolCallId":"call-1","toolName":"search","input":{"q":"rem"}},"occurredAt":"2026-01-01T00:00:01.100Z"}\n\n',
    ]) });
    const signals = [];
    for await (const signal of client.runs.subscribe('run-1')) signals.push(signal);
    expect(signals).toMatchObject([
      { type: 'assistant.text.delta', data: { delta: 'hi' } },
      { type: 'tool.execution.started', data: { input: { q: 'rem' } } },
    ]);
    expect(signals[0]?.occurredAt).toBeInstanceOf(Date);
  });

  it('拒绝已知实时事件的畸形 payload', async () => {
    const client = new RuntimeClient({ baseUrl: 'https://runtime.test', fetch: async () => streamResponse([
      'event: signal\ndata: {"runId":"run-1","type":"assistant.text.delta","data":{"messageIndex":0,"contentIndex":0,"delta":7},"occurredAt":"2026-01-01T00:00:01.000Z"}\n\n',
    ]) });
    await expect((async () => {
      for await (const _signal of client.runs.subscribe('run-1')) { /* consume */ }
    })()).rejects.toThrow('invalid signal payload');
  });

  it('透传未知未来实时事件，保持前向兼容', async () => {
    const client = new RuntimeClient({ baseUrl: 'https://runtime.test', fetch: async () => streamResponse([
      'event: signal\ndata: {"runId":"run-1","type":"assistant.audio.delta","data":{"base64":"x"},"occurredAt":"2026-01-01T00:00:01.000Z"}\n\n',
    ]) });
    const signals = [];
    for await (const signal of client.runs.subscribe('run-1')) signals.push(signal);
    expect(signals[0]).toMatchObject({ type: 'assistant.audio.delta', data: { base64: 'x' } });
  });

  it('waitForCompletion 已有终态时只读取一次 Run，且不建立 SSE', async () => {
    let reads = 0;
    const controller = new AbortController();
    const client = new RuntimeClient({ baseUrl: 'https://runtime.test', fetch: async (input) => {
      const url = String(input);
      if (url.endsWith('/stream')) return streamResponse([]);
      reads += 1;
      if (reads === 1) return runResponse('completed');
      controller.abort(new Error('stop'));
      return streamResponse([]);
    } });
    const run = await client.runs.waitForCompletion('run-1', { signal: controller.signal });
    expect(run.status).toBe('completed');
    expect(reads).toBe(1);
  });

  it('waitForCompletion 正常 SSE 只做初始和终态确认两次 Run 查询', async () => {
    const requests: string[] = [];
    const client = new RuntimeClient({ baseUrl: 'https://runtime.test', fetch: async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('/stream')) return streamResponse([
        'event: signal\ndata: {"runId":"run-1","type":"run.completed","occurredAt":"2026-01-01T00:00:01.000Z"}\n\n',
      ]);
      return requests.filter((item) => item.endsWith('/v1/runs/run-1')).length === 1
        ? runResponse('queued') : runResponse('completed');
    } });

    await expect(client.runs.waitForCompletion('run-1')).resolves.toMatchObject({ status: 'completed' });
    expect(requests.map((url) => url.replace('https://runtime.test', ''))).toEqual([
      '/v1/runs/run-1', '/v1/runs/run-1/stream', '/v1/runs/run-1',
    ]);
  });

  it('SSE 提前关闭时才回退到轮询', async () => {
    const requests: string[] = [];
    const client = new RuntimeClient({ baseUrl: 'https://runtime.test', fetch: async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('/stream')) return streamResponse([]);
      const runReads = requests.filter((item) => item.endsWith('/v1/runs/run-1')).length;
      return runResponse(runReads >= 3 ? 'completed' : 'queued');
    } });

    await expect(client.runs.waitForCompletion('run-1', { pollMs: 1 })).resolves.toMatchObject({ status: 'completed' });
    expect(requests.map((url) => url.replace('https://runtime.test', ''))).toEqual([
      '/v1/runs/run-1', '/v1/runs/run-1/stream', '/v1/runs/run-1', '/v1/runs/run-1',
    ]);
  });
});
