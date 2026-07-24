import type { UserInputContent } from 'rem-agent-core';
import { log } from 'rem-agent-core';
import { createBusSSEResponse } from 'rem-agent-bridge';
import { getWorkspace } from '../workspace-param.js';
import type { HandlerContext, RouteDefinition } from '../types.js';

async function runAgent({ req, getAgentService }: HandlerContext): Promise<Response> {
  const body = (await req.json()) as { sessionId?: string; content?: UserInputContent };
  const { sessionId, content } = body;
  const workspace = getWorkspace(req);

  const isEmpty =
    content === undefined ||
    content === null ||
    (typeof content === 'string' && !content) ||
    (Array.isArray(content) && content.length === 0);
  if (!sessionId || isEmpty) {
    return Response.json({ error: 'sessionId and content are required' }, { status: 400 });
  }

  log('api:run', 'run request', { sessionId, workspace });
  const service = await getAgentService();
  await service.run(workspace, sessionId, content);
  return Response.json({ ok: true });
}

async function streamAgent({ getAgentService }: HandlerContext): Promise<Response> {
  const service = await getAgentService();
  log('api:stream', 'SSE connection established', {});
  return createBusSSEResponse(service.stream());
}

async function interruptAgent({ req, getAgentService }: HandlerContext): Promise<Response> {
  const body = (await req.json()) as { sessionId?: string };
  if (!body.sessionId) {
    return Response.json({ error: 'sessionId is required' }, { status: 400 });
  }
  const workspace = getWorkspace(req);
  const service = await getAgentService();
  await service.interrupt(workspace, body.sessionId);
  return Response.json({ sessionId: body.sessionId, interrupted: true });
}

async function resetAgent({ req, getAgentService }: HandlerContext): Promise<Response> {
  const body = (await req.json()) as { sessionId?: string };
  if (!body.sessionId) {
    return Response.json({ error: 'sessionId is required' }, { status: 400 });
  }
  const workspace = getWorkspace(req);
  const service = await getAgentService();
  await service.reset(workspace, body.sessionId);
  return Response.json({ sessionId: body.sessionId, reset: true });
}

export const agentRoutes: RouteDefinition[] = [
  { pattern: 'agent/run', method: 'POST', handler: runAgent },
  { pattern: 'agent/stream', method: 'GET', handler: streamAgent },
  { pattern: 'agent/interrupt', method: 'POST', handler: interruptAgent },
  { pattern: 'agent/reset', method: 'POST', handler: resetAgent },
];
