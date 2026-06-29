import { Hono } from 'hono';
import type { AppContext } from '../types.js';

export const sessionsRoutes = new Hono<AppContext>();

sessionsRoutes.get('/sessions', async (c) => {
  const sessionService = c.get('sessionService');
  const sessions = await sessionService.list();
  return c.json(sessions);
});
