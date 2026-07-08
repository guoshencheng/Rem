import { NextRequest, NextResponse } from 'next/server';
import { ServiceError, type IAgentService } from 'rem-agent-bridge';
import { getContainer } from '@/lib/container';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : 'Internal error';
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');
    return NextResponse.json(await agentService.listWorkspaces());
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path, name } = body as { path: string; name?: string };
    if (!path) {
      return NextResponse.json({ error: 'path is required' }, { status: 400 });
    }
    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');
    return NextResponse.json(await agentService.addWorkspace(path, name));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { path } = body as { path: string };
    if (!path) {
      return NextResponse.json({ error: 'path is required' }, { status: 400 });
    }
    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');
    await agentService.removeWorkspace(path);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
