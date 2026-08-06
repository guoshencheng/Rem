import type { Context } from 'hono';
import { Hono } from 'hono';
import type { WebAppDeps } from '../app.js';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
};

export function streamRoutes(deps: WebAppDeps): Hono {
  const r = new Hono();

  r.get('/', (c: Context) => {
    const signal = c.req.raw.signal;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': heartbeat\n\n'));
          } catch {
            /* 连接已关闭 */
          }
        }, 15_000);
        try {
          for await (const event of deps.system.events(signal)) {
            controller.enqueue(encoder.encode(`event: bus\ndata: ${JSON.stringify(event)}\n\n`));
            if (signal.aborted) break;
          }
        } catch {
          /* 客户端断开或 system 事件流结束 */
        } finally {
          clearInterval(heartbeat);
          try {
            controller.close();
          } catch {
            /* 已关闭 */
          }
        }
      },
    });
    return new Response(stream, { headers: SSE_HEADERS });
  });

  return r;
}
