import { useEffect, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import { Composer } from '@/components/composer';
import { MarkdownContent } from '@/components/markdown-content';
import { MessageItem } from '@/components/message-item';
import { SectionLabel } from '@/components/section-label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useStreamStore } from '@/state/stream-store';

interface ChatViewProps {
  sessionId: string;
  running: boolean;
  onSend: (content: string) => void;
}

export function ChatView({ sessionId, running, onSend }: ChatViewProps) {
  const session = useStreamStore((state) => state.bySession[sessionId]);
  const primaryThread = session?.threads.find(
    (thread) => thread.role === 'primary' || thread.role === 'organizer',
  );
  const streaming = primaryThread ? session?.streaming[primaryThread.agentThreadId] : undefined;
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' });
  }, [session?.chat.length, streaming]);

  const streamText = (streaming ?? [])
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');
  const messages = session?.chat ?? [];
  const empty = messages.length === 0 && !streamText && !session?.error;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 items-center border-b border-border px-[var(--ds-space-stage-x)]">
        <SectionLabel>公开会话</SectionLabel>
        <span className="ml-auto text-meta leading-compact text-muted-foreground">
          用户与中心投影
        </span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex min-h-full flex-col gap-[var(--ds-space-card-group)] p-[var(--ds-space-stage-x)]">
          {empty && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>开始一段公开会话</EmptyTitle>
                <EmptyDescription>消息会显示在这里</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {messages.map((item) => <MessageItem key={item.messageId} item={item} />)}
          {streamText && (
            <MarkdownContent
              text={`${streamText}\u258c`}
              className="border-l-2 border-selected-border pl-[var(--ds-space-card)] text-body leading-body"
            />
          )}
          {session?.error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Session 运行失败</AlertTitle>
              <AlertDescription>{session.error}</AlertDescription>
            </Alert>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      <Composer disabled={running} onSend={onSend} />
    </div>
  );
}
