'use client';

import { cn } from '@/lib/utils';
import { MarkdownContent } from './markdown-content';
import type { UIMessage } from 'rem-agent-bridge';
import { ReasoningBlock } from './reasoning-block';
import { ToolCallBlock } from './tool-call-block';

interface MessageItemProps {
  message: UIMessage;
}

export function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end py-3">
        <div className="max-w-[60%] rounded-card rounded-br-sm bg-ac text-ac-ink px-4 py-2.5 text-sm leading-relaxed">
          {message.parts.map((part, i) => {
            if (part.type === 'text') {
              return <span key={i}>{part.text}</span>;
            }
            return null;
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="py-3" style={{
      padding: 0,
    }}>
      <div className={cn(
        'text-sm leading-relaxed',
        message.status === 'error' ? 'text-err' : 'text-tx',
      )}>
        {message.parts.map((part, i) => {
          if (part.type === 'reasoning') {
            return (
              <ReasoningBlock
                key={i}
                text={part.text}
                isStreaming={message.status === 'streaming'}
                activePartType={message.activePartType}
              />
            );
          }
          if (part.type === 'tool-call') {
            const result = message.parts.find(
              (p): p is Extract<typeof part, { type: 'tool-result' }> =>
                p.type === 'tool-result' && p.toolCallId === part.toolCallId,
            );
            return <ToolCallBlock key={i} tool={part} result={result} />;
          }
          if (part.type === 'tool-result') {
            return null;
          }
          if (part.type === 'text' && part.text) {
            return <MarkdownContent key={i} text={part.text} className="markdown-body" />;
          }
          return null;
        })}
        {message.status === 'error' && message.error && (
          <div className="mt-2 px-3 py-2 rounded-btn bg-err-bg text-err text-xs border border-err/30">{message.error}</div>
        )}
        {message.role === 'assistant' && message.tokenUsage && message.status !== 'streaming' && (
          <div className="mt-2 text-xs text-muted-foreground">
            {message.tokenUsage.totalTokens.toLocaleString()} tokens
          </div>
        )}
      </div>
    </div>
  );
}
