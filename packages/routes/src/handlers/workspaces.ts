import type { HandlerContext, RouteDefinition } from '../types.js';

async function listWorkspaces({ getAgentService }: HandlerContext): Promise<Response> {
  const service = await getAgentService();
  return Response.json(await service.listWorkspaces());
}

async function addWorkspace({ req, getAgentService }: HandlerContext): Promise<Response> {
  const body = (await req.json()) as { path?: string };
  if (!body.path) {
    return Response.json({ error: 'path is required' }, { status: 400 });
  }
  const service = await getAgentService();
  return Response.json(await service.addWorkspace(body.path));
}

async function removeWorkspace({ req, getAgentService }: HandlerContext): Promise<Response> {
  const body = (await req.json()) as { path?: string };
  if (!body.path) {
    return Response.json({ error: 'path is required' }, { status: 400 });
  }
  const service = await getAgentService();
  await service.removeWorkspace(body.path);
  return Response.json({ ok: true });
}

export const workspaceRoutes: RouteDefinition[] = [
  { pattern: 'workspaces', method: 'GET', handler: listWorkspaces },
  { pattern: 'workspaces', method: 'POST', handler: addWorkspace },
  { pattern: 'workspaces', method: 'DELETE', handler: removeWorkspace },
];
