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

import { getWorkspace } from '../workspace-param';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get('q') ?? '';
    const workspace = getWorkspace(request);
    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');
    let sessions = await agentService.listSessions(workspace);
    if (q) {
      const lower = q.toLowerCase();
      sessions = sessions.filter((s) => (s.title ?? '').toLowerCase().includes(lower));
    }
    return NextResponse.json(sessions);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspace = getWorkspace(request);
    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');
    const result = await agentService.createSession(workspace);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
