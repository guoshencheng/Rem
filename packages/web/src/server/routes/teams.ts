import { Hono } from 'hono';
import type { WebAppDeps } from '../app.js';

export function teamsRoutes(deps: WebAppDeps): Hono {
  const r = new Hono();
  r.get('/', async (c) => c.json(await deps.system.listTeams()));
  return r;
}
