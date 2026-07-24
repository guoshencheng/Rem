import { createRemHandler } from 'rem-agent-routes';
import type { NextRequest } from 'next/server';
import type { IAgentService } from 'rem-agent-bridge';
import { getContainer } from '@/lib/container';

const handle = createRemHandler({
  getAgentService: async () => (await getContainer()).resolve<IAgentService>('agentService'),
});

async function route(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return handle(req, path);
}

export { route as GET, route as POST, route as PATCH, route as DELETE, route as PUT };
