import { NextRequest, NextResponse } from 'next/server';
import { AgentService } from 'rem-agent-bridge';

const agentService = AgentService.getInstance();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, content, interrupt } = body as {
      sessionId: string;
      content?: string;
      interrupt?: boolean;
    };

    if (interrupt) {
      const result = agentService.interrupt(sessionId);
      return NextResponse.json({ sessionId, interrupted: result.interrupted });
    }

    if (!content || !sessionId) {
      return NextResponse.json({ error: 'sessionId and content are required' }, { status: 400 });
    }

    await agentService.run({ sessionId, content });
    agentService.addUserMessage(sessionId, content);

    return NextResponse.json({ sessionId, streamUrl: `/api/stream/${sessionId}` });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
