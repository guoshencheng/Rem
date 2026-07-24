import { getWorkspace } from '../workspace-param.js';
import type { HandlerContext, RouteDefinition } from '../types.js';

async function listSessions({ req, getAgentService }: HandlerContext): Promise<Response> {
  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  const workspace = getWorkspace(req);
  const service = await getAgentService();
  let sessions = await service.listSessions(workspace);
  if (q) {
    const lower = q.toLowerCase();
    sessions = sessions.filter((s) => (s.title ?? '').toLowerCase().includes(lower));
  }
  return Response.json(sessions);
}

async function createSession({ req, getAgentService }: HandlerContext): Promise<Response> {
  const workspace = getWorkspace(req);
  const service = await getAgentService();
  const result = await service.createSession(workspace);
  return Response.json(result);
}

async function getSession({ req, params, getAgentService }: HandlerContext): Promise<Response> {
  const workspace = getWorkspace(req);
  const service = await getAgentService();
  const messages = await service.getMessages(workspace, params.id);
  return Response.json({ sessionId: params.id, title: 'New Chat', messages });
}

async function updateSession({ req, params, getAgentService }: HandlerContext): Promise<Response> {
  const workspace = getWorkspace(req);
  const body = (await req.json()) as { title?: string; pinned?: boolean };
  const service = await getAgentService();
  await service.updateSession(workspace, params.id, { title: body.title, pinned: body.pinned });
  return Response.json({ ok: true });
}

async function deleteSession({ req, params, getAgentService }: HandlerContext): Promise<Response> {
  const workspace = getWorkspace(req);
  const service = await getAgentService();
  await service.deleteSession(workspace, params.id);
  return Response.json({ ok: true });
}

async function getTodos({ req, params, getAgentService }: HandlerContext): Promise<Response> {
  const workspace = getWorkspace(req);
  const service = await getAgentService();
  const todos = await service.getTodos(workspace, params.id);
  return Response.json(todos);
}

export const sessionRoutes: RouteDefinition[] = [
  { pattern: 'sessions', method: 'GET', handler: listSessions },
  { pattern: 'sessions', method: 'POST', handler: createSession },
  { pattern: 'sessions/:id', method: 'GET', handler: getSession },
  { pattern: 'sessions/:id', method: 'PATCH', handler: updateSession },
  { pattern: 'sessions/:id', method: 'DELETE', handler: deleteSession },
  { pattern: 'sessions/:id/todos', method: 'GET', handler: getTodos },
];
