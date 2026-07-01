import { NextRequest, NextResponse } from 'next/server';
import type { IAgentService } from 'rem-agent-bridge';
import { getContainer } from '@/lib/container';

function errorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : 'Internal error';
  const status = err instanceof Error && message.includes('Session not found') ? 404 : 500;
  return NextResponse.json({ error: message }, { status });
}

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
    return errorResponse(err);
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
    const agentService = container.resolve<IAgentService>('agentService');
    await agentService.updateSession(id, { title, pinned });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');
    await agentService.deleteSession(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
