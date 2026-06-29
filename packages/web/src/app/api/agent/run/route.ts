import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateAgent, setActiveRun, interruptActiveRun, addUserMessage } from '@/lib/server-agent-state';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, content, interrupt } = body as {
      sessionId: string;
      content?: string;
      interrupt?: boolean;
    };

    if (interrupt) {
      const interrupted = interruptActiveRun(sessionId);
      return NextResponse.json({ sessionId, interrupted });
    }

    if (!content || !sessionId) {
      return NextResponse.json({ error: 'sessionId and content are required' }, { status: 400 });
    }

    const agent = await getOrCreateAgent(sessionId);
    const abort = new AbortController();
    const result = agent.run({ content, timestamp: new Date() });
    setActiveRun(sessionId, result, abort);
    addUserMessage(sessionId, content);

    return NextResponse.json({ sessionId, streamUrl: `/api/stream/${sessionId}` });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
