import { NextResponse } from 'next/server';
import type { BusEvent, IAgentService } from 'rem-agent-bridge';
import { createBusSSEResponse } from 'rem-agent-bridge';
import { getContainer } from '@/lib/container';

const WORKSPACE = 'default';

async function getAgentService(): Promise<IAgentService> {
  const container = await getContainer();
  return container.resolve('agentService') as IAgentService;
}

export async function GET() {
  try {
    const service = await getAgentService();
    return createBusSSEResponse(service.stream());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
