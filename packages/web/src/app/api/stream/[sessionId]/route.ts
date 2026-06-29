import { NextRequest } from 'next/server';
import { getActiveRun, clearActiveRun } from '@/lib/server-agent-state';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  const active = getActiveRun(sessionId);
  if (!active) {
    return new Response(JSON.stringify({ error: 'No active stream' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of active.result.stream.fullStream) {
          const line = `event: chunk\ndata: ${JSON.stringify(chunk)}\n\n`;
          controller.enqueue(encoder.encode(line));
          if (chunk.type === 'finish' || chunk.type === 'error') break;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Stream error';
        const line = `event: error\ndata: ${JSON.stringify({ type: 'error', error: message })}\n\n`;
        controller.enqueue(encoder.encode(line));
      } finally {
        controller.close();
        clearActiveRun(sessionId);
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
