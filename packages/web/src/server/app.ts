import { Hono } from 'hono';
import type { AgentSystem } from 'rem-agent-core';
import { toErrorResponse } from './errors.js';
import { sessionsRoutes } from './routes/sessions.js';
import { teamsRoutes } from './routes/teams.js';
import { streamRoutes } from './routes/stream.js';

export interface WebAppDeps {
  system: AgentSystem;
  workspace: string;
}

export function createWebApp(deps: WebAppDeps): Hono {
  const app = new Hono();
  app.onError((err, c) => toErrorResponse(err, c));
  app.route('/api/rem/sessions', sessionsRoutes(deps));
  app.route('/api/rem/teams', teamsRoutes(deps));
  app.route('/api/rem/stream', streamRoutes(deps));
  return app;
}
