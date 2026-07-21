import { NextRequest, NextResponse } from 'next/server';
import { ServiceError, type IAgentService } from 'rem-agent-bridge';
import { log, type UserInputContent } from 'rem-agent-core';
import { getContainer } from '@/lib/container';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : 'Internal error';
  return NextResponse.json({ error: message }, { status: 500 });
}

import { getWorkspace } from '../../workspace-param';

export async function POST(request: NextRequest) {
  let body: { sessionId?: string } | undefined;
  let workspace: string | undefined;

  try {
    body = await request.json();
    const { sessionId, content } = body as {
      sessionId: string;
      content?: UserInputContent;
    };
    workspace = getWorkspace(request);

    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');

    const isEmpty =
      content === undefined ||
      content === null ||
      (typeof content === 'string' && !content) ||
      (Array.isArray(content) && content.length === 0);
    if (!sessionId || isEmpty) {
      return NextResponse.json({ error: 'sessionId and content are required' }, { status: 400 });
    }

    // Fire-and-forget command: the server drives the run in the background and
    // broadcasts progress over the bus (/api/agent/stream). No stream returned here.
    log('api:run', 'run request', { sessionId, workspace, contentLength: content.length });
    await agentService.run(workspace, sessionId, content);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    log('api:run', 'run failed', { sessionId: body?.sessionId, workspace, error: message });
    return errorResponse(err);
  }
}
