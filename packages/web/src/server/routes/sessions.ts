import { Hono } from 'hono';
import type { WebAppDeps } from '../app.js';

export function sessionsRoutes(deps: WebAppDeps): Hono {
  const r = new Hono();

  r.get('/', async (c) => c.json(await deps.system.listSessions(deps.workspace)));

  r.post('/', async (c) => {
    const raw = await c.req.json<{ teamId?: string }>().catch(() => ({}));
    const body = raw ?? {};
    const info = await deps.system.createSession({
      workspace: deps.workspace,
      teamId: ('teamId' in body ? body.teamId : undefined),
    });
    return c.json(info, 201);
  });

  r.get('/:id/chat', async (c) => c.json(await deps.system.getSessionChat(c.req.param('id'))));

  r.get('/:id/threads', async (c) => c.json(await deps.system.getSessionThreads(c.req.param('id'))));

  r.get('/:id/threads/:tid/messages', async (c) =>
    c.json(await deps.system.getAgentThreadContext(c.req.param('id'), c.req.param('tid'))));

  r.post('/:id/send', async (c) => {
    const body = await c.req.json<{ content?: string }>().catch(() => null);
    if (!body || typeof body.content !== 'string' || body.content.trim() === '') {
      return c.json({ error: 'content must be a non-empty string' }, 400);
    }
    await deps.system.send({ sessionId: c.req.param('id'), content: body.content });
    return c.body(null, 204);
  });

  r.post('/:id/interrupt', async (c) => {
    await deps.system.interrupt(c.req.param('id'));
    return c.body(null, 204);
  });

  return r;
}
