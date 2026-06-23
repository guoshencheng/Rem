import type { IncomingMessage, ServerResponse } from 'node:http';
import { activeStreams } from '../state.js';

export async function handleStream(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const match = req.url?.match(/^\/api\/stream\/([^/]+)$/);
  if (!match) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const sessionId = decodeURIComponent(match[1]);
  const result = activeStreams.get(sessionId);
  if (!result) {
    res.writeHead(404);
    res.end('Stream not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  try {
    for await (const chunk of result.stream.fullStream) {
      res.write(`event: chunk\ndata: ${JSON.stringify(chunk)}\n\n`);
      if (chunk.type === 'finish' || chunk.type === 'error') break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.write(
      `event: error\ndata: ${JSON.stringify({ type: 'error', error: message })}\n\n`,
    );
  }

  res.end();
}
