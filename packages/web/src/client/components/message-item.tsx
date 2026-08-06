import type { SessionChatMessage } from 'rem-agent-core';
import { MarkdownContent } from '@/components/markdown-content';
import { cn } from '@/lib/utils';

export function messageText(message: SessionChatMessage['message']): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  return content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

export function MessageItem({ item }: { item: SessionChatMessage }) {
  const isUser = item.message.role === 'user';
  const text = messageText(item.message);
  if (!text) return null;
  return (
    <div className={cn('max-w-[85%] text-xs leading-relaxed', isUser && 'self-end')}>
      {isUser ? (
        <div className="rounded-lg border border-primary/60 bg-accent px-3 py-2">{text}</div>
      ) : (
        <MarkdownContent text={text} className="px-1" />
      )}
    </div>
  );
}
