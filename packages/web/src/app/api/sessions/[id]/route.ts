import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateAgent, getSessionMessages } from '@/lib/server-agent-state';

const titles = new Map<string, string>();
const pins = new Map<string, boolean>();

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await getOrCreateAgent(id);

    return NextResponse.json({
      sessionId: id,
      title: titles.get(id) ?? 'New Chat',
      messages: getSessionMessages(id),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
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

    if (title) {
      titles.set(id, title);
    }
    if (pinned !== undefined) {
      pins.set(id, pinned);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    titles.delete(id);
    pins.delete(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
