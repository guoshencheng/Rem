import type { ApprovalDecision, Rule } from 'rem-agent-core';
import { getWorkspace } from '../workspace-param.js';
import type { HandlerContext, RouteDefinition } from '../types.js';

async function listApprovals({ req, getAgentService }: HandlerContext): Promise<Response> {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) {
    return Response.json({ error: 'sessionId is required' }, { status: 400 });
  }
  const workspace = getWorkspace(req);
  const service = await getAgentService();
  const approvals = await service.listPendingApprovals(workspace, sessionId);
  return Response.json(approvals);
}

async function resolveApproval({ req, params, getAgentService }: HandlerContext): Promise<Response> {
  const body = (await req.json()) as {
    sessionId?: string;
    decision?: ApprovalDecision;
    rule?: Omit<Rule, 'source'>;
  };
  if (!body.sessionId) {
    return Response.json({ error: 'sessionId is required' }, { status: 400 });
  }
  if (!body.decision) {
    return Response.json({ error: 'decision is required' }, { status: 400 });
  }
  const workspace = getWorkspace(req);
  const service = await getAgentService();
  const result = await service.resolveApproval(workspace, body.sessionId, params.id, body.decision, body.rule);
  return Response.json(result);
}

export const approvalRoutes: RouteDefinition[] = [
  { pattern: 'approvals', method: 'GET', handler: listApprovals },
  { pattern: 'approvals/:id/resolve', method: 'POST', handler: resolveApproval },
];
