import type { RunSignal } from 'rem-agent-core';

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

export function signalFrame(signal: RunSignal): string {
  return `event: signal\ndata: ${JSON.stringify(signal)}\n\n`;
}

export function createSignalStream(
  signals: AsyncIterable<RunSignal>,
  requestSignal: AbortSignal,
  keepAliveMs: number,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const close = (): void => {
        if (heartbeat !== undefined) clearInterval(heartbeat);
        try { controller.close(); } catch { /* client disconnected */ }
      };
      try {
        if (keepAliveMs > 0) {
          heartbeat = setInterval(() => {
            try { controller.enqueue(encoder.encode(': heartbeat\n\n')); } catch { close(); }
          }, keepAliveMs);
        }
        for await (const signal of signals) {
          if (requestSignal.aborted) break;
          controller.enqueue(encoder.encode(signalFrame(signal)));
        }
      } catch {
        // A disconnected client or a closed in-process SignalHub has no useful HTTP response.
      } finally {
        close();
      }
    },
    cancel() { /* the request AbortSignal closes the Core subscription */ },
  });
}
