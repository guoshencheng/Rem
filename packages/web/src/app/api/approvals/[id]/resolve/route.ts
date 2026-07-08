import { NextRequest, NextResponse } from 'next/server';
import { ServiceError, type IAgentService } from 'rem-agent-bridge';
import type { ApprovalDecision } from 'rem-agent-core';
import { getContainer } from '@/lib/container';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : 'Internal error';
  return NextResponse.json({ error: message }, { status: 500 });
}

import { getWorkspace } from '../../../workspace-param';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { sessionId, decision } = body as { sessionId?: string; decision?: ApprovalDecision };

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }
    if (!decision) {
      return NextResponse.json({ error: 'decision is required' }, { status: 400 });
    }

    const workspace = getWorkspace(request);
    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');
    const result = await agentService.resolveApproval(workspace, sessionId, id, decision);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
