import { NextRequest } from 'next/server';
import type { AgentService } from 'rem-agent-bridge';
import { getContainer } from '@/lib/container';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const container = await getContainer();
  const agentService = container.resolve<AgentService>('agentService');

  const active = agentService.getStream(sessionId);
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
        for await (const chunk of active.stream.fullStream) {
          controller.enqueue(encoder.encode(`event: chunk\ndata: ${JSON.stringify(chunk)}\n\n`));
          if (chunk.type === 'finish' || chunk.type === 'error') break;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Stream error';
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ type: 'error', error: message })}\n\n`));
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
