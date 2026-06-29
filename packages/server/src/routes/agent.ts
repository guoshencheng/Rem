import { Hono } from 'hono';
import type { RunRequest, InterruptRequest, ResetRequest } from 'rem-agent-bridge';
import type { AppContext } from '../types.js';

export const agentRoutes = new Hono<AppContext>();

agentRoutes.post('/run', async (c) => {
  const { sessionId, content } = await c.req.json<RunRequest>();
  const agentService = c.get('agentService');
  const result = agentService.run({ sessionId, content });
  return c.json(
    {
      sessionId: result.sessionId,
      streamUrl: `/api/stream/${encodeURIComponent(result.sessionId)}`,
    },
    202,
  );
});

agentRoutes.post('/interrupt', async (c) => {
  const { sessionId } = await c.req.json<InterruptRequest>();
  const agentService = c.get('agentService');
  return c.json(agentService.interrupt(sessionId));
});

agentRoutes.post('/reset', async (c) => {
  const { sessionId } = await c.req.json<ResetRequest>();
  const agentService = c.get('agentService');
  const result = await agentService.reset(sessionId);
  return c.json(result);
});
