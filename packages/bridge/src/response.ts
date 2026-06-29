import type { AgentStreamChunk } from 'rem-agent-core';

export function createSSEResponse(fullStream: AsyncIterable<AgentStreamChunk>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of fullStream) {
          controller.enqueue(encoder.encode(`event: chunk\ndata: ${JSON.stringify(chunk)}\n\n`));
          console.log(`[SSE send] ${chunk.type}${chunk.type === 'reasoning-delta' ? ' ' + (chunk as any).text?.slice(0, 30) : ''}`);
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
