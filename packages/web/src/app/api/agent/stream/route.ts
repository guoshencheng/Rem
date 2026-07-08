import { NextRequest, NextResponse } from 'next/server';
import type { BusEvent, IAgentService } from 'rem-agent-bridge';
import { createBusSSEResponse } from 'rem-agent-bridge';
import { getContainer } from '@/lib/container';
import { getWorkspace } from '../../workspace-param';

async function getAgentService(): Promise<IAgentService> {
  const container = await getContainer();
  return container.resolve('agentService') as IAgentService;
}

export async function GET(request: NextRequest) {
  try {
    const workspace = getWorkspace(request);
    const service = await getAgentService();
    return createBusSSEResponse(service.stream(workspace));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
