import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateAgent } from '@/lib/server-agent-state';

const titles = new Map<string, string>();
const pins = new Map<string, boolean>();

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const agent = await getOrCreateAgent(id);

    const messages = agent.conversation
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg, idx) => ({
      id: `msg-${idx}`,
      role: msg.role as 'user' | 'assistant',
      content: extractText(msg.content),
      status: 'done' as const,
      toolCalls: [] as unknown[],
    }));

    return NextResponse.json({
      sessionId: id,
      title: titles.get(id) ?? 'New Chat',
      messages,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter((p) => p.type === 'text')
      .map((p) => p.text ?? '')
      .join('');
  }
  return '';
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
