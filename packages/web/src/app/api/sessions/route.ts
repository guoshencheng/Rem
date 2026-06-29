import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateAgent, listAgentSessions } from '@/lib/server-agent-state';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get('q') ?? '';

    let sessions = await listAgentSessions();
    if (q) {
      const lower = q.toLowerCase();
      sessions = sessions.filter((s) => (s.title ?? '').toLowerCase().includes(lower));
    }

    return NextResponse.json(sessions);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    const sessionId = crypto.randomUUID();
    await getOrCreateAgent(sessionId);

    return NextResponse.json({
      sessionId,
      title: 'New Chat',
      updatedAt: Date.now(),
      messageCount: 0,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
