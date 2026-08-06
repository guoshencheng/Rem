import { useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageItem } from '@/components/message-item';
import { Composer } from '@/components/composer';
import { MarkdownContent } from '@/components/markdown-content';
import { useStreamStore } from '@/state/stream-store';

interface ChatViewProps {
  sessionId: string;
  running: boolean;
  onSend: (content: string) => void;
}

export function ChatView({ sessionId, running, onSend }: ChatViewProps) {
  const session = useStreamStore((s) => s.bySession[sessionId]);
  const primaryThread = session?.threads.find((t) => t.role === 'primary' || t.role === 'organizer');
  const streaming = primaryThread ? session?.streaming[primaryThread.agentThreadId] : undefined;
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' });
  }, [session?.chat.length, streaming]);

  const streamText = (streaming ?? [])
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2 text-[9px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
        中心会话
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-3 p-4">
          {(session?.chat ?? []).map((item) => <MessageItem key={item.messageId} item={item} />)}
          {streamText && <MarkdownContent text={streamText + '\u258c'} className="px-1 text-xs" />}
          {session?.error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {session.error}
            </p>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      <Composer disabled={running} onSend={onSend} />
    </div>
  );
}
