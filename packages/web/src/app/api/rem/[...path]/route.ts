import { createRemHandler } from 'rem-agent-routes';
import type { NextRequest } from 'next/server';
import { getAgentService } from '@/lib/agent-service';

const handle = createRemHandler({ getAgentService });

async function route(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return handle(req, path);
}

export { route as GET, route as POST, route as PATCH, route as DELETE, route as PUT };
