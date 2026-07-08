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
    const { sessionId } = body as { sessionId: string };

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 },
      );
    }

    const workspace = getWorkspace(request);
    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');
    await agentService.reset(workspace, sessionId);

    return NextResponse.json({ sessionId, reset: true });
  } catch (err) {
    return errorResponse(err);
  }
}
