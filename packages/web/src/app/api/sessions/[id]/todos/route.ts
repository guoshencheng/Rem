import { NextRequest, NextResponse } from 'next/server';
import { ServiceError, type IAgentService } from 'rem-agent-bridge';
import { getContainer } from '@/lib/container';
import { getWorkspace } from '../../../workspace-param';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : 'Internal error';
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const workspace = getWorkspace(request);
    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');
    const todos = await agentService.getTodos(workspace, id);
    return NextResponse.json(todos);
  } catch (err) {
    return errorResponse(err);
  }
}
