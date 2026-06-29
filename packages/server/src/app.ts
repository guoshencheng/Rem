import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ServiceError, AgentService, SessionService } from 'rem-agent-bridge';
import type { AppContext } from './types.js';
import { agentRoutes } from './routes/agent.js';
import { sessionsRoutes } from './routes/sessions.js';
import { streamRoutes } from './routes/stream.js';

export function createApp(): Hono<AppContext> {
  const app = new Hono<AppContext>();

  const agentService = new AgentService();
  const sessionService = new SessionService();

  app.use('*', cors());
  app.use('*', async (c, next) => {
    c.set('agentService', agentService);
    c.set('sessionService', sessionService);
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof ServiceError) {
      return c.json({ error: err.message }, err.status as 409);
    }
    console.error('Server error:', err);
    return c.json({ error: err.message }, 500);
  });

  app.route('/api/agent', agentRoutes);
  app.route('/api', sessionsRoutes);
  app.route('/api/stream', streamRoutes);

  return app;
}
