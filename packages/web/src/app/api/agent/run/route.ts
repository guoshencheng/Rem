import { NextRequest, NextResponse } from 'next/server';
import { ServiceError, type IAgentService } from 'rem-agent-bridge';
import { getContainer } from '@/lib/container';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : 'Internal error';
  return NextResponse.json({ error: message }, { status: 500 });
}

import { getWorkspace } from '../../workspace-param.js';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, content } = body as {
      sessionId: string;
      content?: string;
    };
    const workspace = getWorkspace(request);

    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');

    if (!content || !sessionId) {
      return NextResponse.json({ error: 'sessionId and content are required' }, { status: 400 });
    }

    // Fire-and-forget command: the server drives the run in the background and
    // broadcasts progress over the bus (/api/agent/stream). No stream returned here.
    await agentService.run(workspace, sessionId, content);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
