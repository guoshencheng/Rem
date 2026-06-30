import { NextRequest, NextResponse } from 'next/server';
import type { IAgentService, SessionService } from 'rem-agent-bridge';
import { getContainer } from '@/lib/container';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');
    const messages = await agentService.getMessages(id);
    return NextResponse.json({
      sessionId: id,
      title: 'New Chat',
      messages,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, pinned } = body as { title?: string; pinned?: boolean };
    const container = await getContainer();
    const sessionService = container.resolve<SessionService>('sessionService');
    sessionService.update(id, { title, pinned });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const container = await getContainer();
    const sessionService = container.resolve<SessionService>('sessionService');
    sessionService.delete(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
