import { NextRequest, NextResponse } from 'next/server';
import { SessionService } from '@/lib/services/session-service';

const sessionService = new SessionService();

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get('q') ?? '';
    let sessions = sessionService.list();
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
  const result = sessionService.create();
  return NextResponse.json(result);
}
