import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AppContext } from '../types.js';

export const streamRoutes = new Hono<AppContext>();

streamRoutes.get('/:sessionId', (c) => {
  const sessionId = c.req.param('sessionId');
  const agentService = c.get('agentService');

  const result = agentService.getStream(sessionId);
  if (!result) {
    return c.json({ error: 'Stream not found' }, 404);
  }

  return streamSSE(c, async (stream) => {
    try {
      for await (const chunk of result.stream.fullStream) {
        await stream.writeSSE({ data: JSON.stringify(chunk), event: 'chunk' });
        if (chunk.type === 'finish' || chunk.type === 'error') break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await stream.writeSSE({
        data: JSON.stringify({ type: 'error', error: message }),
        event: 'error',
      });
    }
  });
});
