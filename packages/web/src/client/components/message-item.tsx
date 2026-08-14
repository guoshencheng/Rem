import type { Message } from 'rem-agent-core';
import { RuntimeMessageContent } from '@/components/runtime-message-content';
import type { RuntimeChatMessage } from '@/types';
import type { ContentBlock } from '@/state/runtime-stream-projection';
import type { RuntimeToolResult } from '@/state/runtime-stream-projection';
import { cn } from '@/lib/utils';

export function messageText(message: Message): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  return content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

export function MessageItem({
  item,
  toolResults = {},
}: {
  item: RuntimeChatMessage;
  toolResults?: Record<string, RuntimeToolResult>;
}) {
  const isUser = item.message.role === 'user';
  const text = messageText(item.message);
  if (!text && item.message.role === 'user') return null;

  return (
    <article className={cn('max-w-[78%] text-body leading-body', isUser && 'max-w-[68%] self-end')}>
      {isUser ? (
        <div className="rounded-lg border border-selected-border bg-selected-bg p-[var(--ds-space-card)] text-foreground">
          {text}
        </div>
      ) : (
        <div className="border-l-2 border-selected-border pl-[var(--ds-space-card)] text-secondary-foreground">
          <div className="mb-[var(--ds-space-tree)] text-label font-extrabold uppercase leading-control tracking-[0.1em] text-muted-foreground">
            REM
          </div>
          <RuntimeMessageContent
            parts={item.message.content as ContentBlock[]}
            toolResults={toolResults}
          />
        </div>
      )}
    </article>
  );
}
