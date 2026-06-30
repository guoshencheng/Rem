import type { AgentStreamChunk } from 'rem-agent-core';
import type { BusEvent } from './types.js';

export function createSSEResponse(fullStream: AsyncIterable<AgentStreamChunk>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of fullStream) {
          controller.enqueue(encoder.encode(`event: chunk\ndata: ${JSON.stringify(chunk)}\n\n`));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Stream error';
        const name = err instanceof Error ? err.name : 'Error';
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { name, message } })}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export function createBusSSEResponse(busStream: AsyncIterable<BusEvent>): Response {
  const encoder = new TextEncoder();
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        keepAlive = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(':heartbeat\n\n'));
          } catch {
            // controller already closed
          }
        }, 15000);

        for await (const event of busStream) {
          controller.enqueue(encoder.encode(`event: bus\ndata: ${JSON.stringify(event)}\n\n`));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Stream error';
        const name = err instanceof Error ? err.name : 'Error';
        try {
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { name, message } })}\n\n`),
          );
        } catch {
          // controller already closed
        }
      } finally {
        if (keepAlive) clearInterval(keepAlive);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      if (keepAlive) clearInterval(keepAlive);
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
