import { NextResponse } from 'next/server';
import type { IAgentService } from 'rem-agent-bridge';
import { createBusSSEResponse } from 'rem-agent-bridge';
import { log } from 'rem-agent-core';
import { getContainer } from '@/lib/container';

async function getAgentService(): Promise<IAgentService> {
  const container = await getContainer();
  return container.resolve('agentService') as IAgentService;
}

export async function GET() {
  try {
    const service = await getAgentService();
    log('api:stream', 'SSE connection established');
    return createBusSSEResponse(service.stream());
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    const cause = err instanceof Error && 'cause' in err ? String((err as { cause?: unknown }).cause) : undefined;
    const stack = err instanceof Error ? err.stack : undefined;
    log('api:stream', 'SSE connection failed', { error: message, cause, stack });
    return NextResponse.json(
      { error: message, cause },
      { status: 500 },
    );
  }
}
