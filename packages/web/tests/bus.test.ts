import { afterEach, describe, expect, it, vi } from 'vitest';
import { startEventBus } from '@/api/bus';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function sseResponse(frames: string[]): Response {
  const text = frames.map((f) => `event: bus\ndata: ${f}\n\n`).join('');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function errorResponse(): Response {
  return new Response('', { status: 502 });
}

describe('startEventBus', () => {
  it('解析 event: bus 帧并分发事件', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      sseResponse(['{"workspace":"/w","sessionId":"s1","type":"session-start"}'])));
    vi.stubGlobal('addEventListener', vi.fn());
    vi.stubGlobal('dispatchEvent', vi.fn());
    vi.stubGlobal('window', { addEventListener: vi.fn(), dispatchEvent: vi.fn() });
    const received: unknown[] = [];
    const stop = startEventBus({
      onEvent: (ev) => received.push(ev),
      onReconnect: () => {},
    });
    await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 1000 });
    expect(received[0]).toMatchObject({ type: 'session-start', sessionId: 's1' });
    stop();
  });

  it('SSE 断线重连后触发 onReconnect', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      attempt += 1;
      if (attempt % 2 === 1) return sseResponse([]);
      throw new Error('down');
    }));
    vi.stubGlobal('addEventListener', vi.fn());
    vi.stubGlobal('dispatchEvent', vi.fn());
    vi.stubGlobal('window', { addEventListener: vi.fn(), dispatchEvent: vi.fn() });
    const onReconnect = vi.fn();
    const stop = startEventBus({ onEvent: () => {}, onReconnect });
    // attempt 1: 成功连接并立即结束（空流）
    // attempt 2: 失败
    // attempt 3 (after 1s): 成功 → onReconnect
    const maxSteps = 15;
    for (let i = 0; i < maxSteps && onReconnect.mock.calls.length === 0; i += 1) {
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(onReconnect).toHaveBeenCalledTimes(1);
    stop();
    vi.useRealTimers();
  });
});
