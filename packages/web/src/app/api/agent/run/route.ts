import { NextRequest, NextResponse } from 'next/server';
import { ServiceError, type IAgentService } from 'rem-agent-bridge';
import { createSSEResponse } from 'rem-agent-bridge';
import { getContainer } from '@/lib/container';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : 'Internal error';
  return NextResponse.json({ error: message }, { status: 500 });
}

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
    return errorResponse(err);
  }
}
