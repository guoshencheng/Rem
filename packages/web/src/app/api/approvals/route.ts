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

import { getWorkspace } from '../workspace-param.js';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const workspace = getWorkspace(request);
    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');
    const approvals = await agentService.listPendingApprovals(workspace, sessionId);
    return NextResponse.json(approvals);
  } catch (err) {
    return errorResponse(err);
  }
}
