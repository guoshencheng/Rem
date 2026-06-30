import { NextRequest, NextResponse } from 'next/server';
import type { SessionService, IAgentService } from 'rem-agent-bridge';
import { getContainer } from '@/lib/container';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get('q') ?? '';
    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');
    let sessions = await agentService.listSessions();
    if (q) {
      const lower = q.toLowerCase();
      sessions = sessions.filter((s) => (s.title ?? '').toLowerCase().includes(lower));
    }
    return NextResponse.json(sessions);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

export async function POST() {
  const container = await getContainer();
  const sessionService = container.resolve<SessionService>('sessionService');
  const result = sessionService.create();
  return NextResponse.json(result);
}
