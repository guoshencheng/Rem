import { toErrorResponse } from './errors.js';
import type { RemRoutesOptions, RouteDefinition } from './types.js';
import { agentRoutes } from './handlers/agent.js';
import { sessionRoutes } from './handlers/sessions.js';
import { approvalRoutes } from './handlers/approvals.js';
import { workspaceRoutes } from './handlers/workspaces.js';

const routes: RouteDefinition[] = [
  ...agentRoutes,
  ...sessionRoutes,
  ...approvalRoutes,
  ...workspaceRoutes,
];

function matchPattern(pattern: string, segments: string[]): Record<string, string> | null {
  const parts = pattern.split('/');
  if (parts.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith(':')) {
      params[parts[i].slice(1)] = decodeURIComponent(segments[i]);
    } else if (parts[i] !== segments[i]) {
      return null;
    }
  }
  return params;
}

export function createRemHandler(opts: RemRoutesOptions) {
  return async function handleRemRequest(req: Request, segments: string[]): Promise<Response> {
    for (const route of routes) {
      if (route.method !== req.method) continue;
      const params = matchPattern(route.pattern, segments);
      if (!params) continue;
      try {
        return await route.handler({ req, params, getAgentService: opts.getAgentService });
      } catch (err) {
        return toErrorResponse(err);
      }
    }
    return Response.json({ error: 'Not found' }, { status: 404 });
  };
}
