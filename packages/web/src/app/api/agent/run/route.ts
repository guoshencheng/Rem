import { NextRequest, NextResponse } from 'next/server';
import type { IAgentService } from 'rem-agent-bridge';
import { createSSEResponse } from 'rem-agent-bridge';
import { getContainer } from '@/lib/container';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, content, interrupt } = body as {
      sessionId: string;
      content?: string;
      interrupt?: boolean;
    };

    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');

    if (interrupt) {
      await agentService.interrupt(sessionId);
      return NextResponse.json({ sessionId, interrupted: true });
    }

    if (!content || !sessionId) {
      return NextResponse.json({ error: 'sessionId and content are required' }, { status: 400 });
    }

    const stream = await agentService.run(sessionId, content);

    return createSSEResponse(stream);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
