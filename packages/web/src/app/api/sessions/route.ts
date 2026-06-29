import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '../services';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get('q') ?? '';
    const sessionService = await getSessionService();
    let sessions = await sessionService.list();
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
  const sessionService = await getSessionService();
  const result = sessionService.create();
  return NextResponse.json(result);
}
