'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { MarkdownContent } from './markdown-content';
import { ChildAgentCard } from './child-agent-card';
import { CopyButton } from './copy-button';
import type { UIMessage, UiContentBlock } from 'rem-agent-bridge';
import type { Usage } from 'rem-agent-core';
import { ReasoningBlock } from './reasoning-block';
import { ToolCallBlock } from './tool-call-block';

interface MessageItemProps {
  message: UIMessage;
  childAgents?: Map<string, {
    childSessionId: string;
    summary: string;
    status: 'running' | 'completed' | 'failed';
    tokenUsage?: Usage;
  }>;
  onOpenChild?: (sessionId: string) => void;
}

export function MessageItem({ message, childAgents, onOpenChild }: MessageItemProps) {
  const isUser = message.role === 'user';

  const plainText = useMemo(() => {
    return message.parts
      .filter((p): p is Extract<UiContentBlock, { type: 'text' }> => p.type === 'text')
      .map((p) => p.text)
      .join('\n');
  }, [message.parts]);

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
    <div className="py-3 group relative" style={{
      padding: 0,
    }}>
      <div className={cn(
        'text-sm leading-relaxed',
        message.status === 'error' ? 'text-err' : 'text-tx',
      )}>
        {message.parts.map((part, i) => {
          if (part.type === 'thinking') {
            return (
              <ReasoningBlock
                key={i}
                thinking={part.thinking}
                isStreaming={message.status === 'streaming'}
                activePartType={message.activePartType}
              />
            );
          }
          if (part.type === 'toolCall') {
            const result = message.toolResults?.[part.id];
            return <ToolCallBlock key={i} tool={part} result={result} />;
          }
          if (part.type === 'text' && part.text) {
            return <MarkdownContent key={i} text={part.text} className="markdown-body" />;
          }
          return null;
        })}
        {childAgents && childAgents.size > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {Array.from(childAgents.values()).map((child) => (
              <ChildAgentCard
                key={child.childSessionId}
                summary={child.summary}
                status={child.status}
                tokenUsage={child.tokenUsage}
                onClick={() => onOpenChild?.(child.childSessionId)}
              />
            ))}
          </div>
        )}
        {message.status === 'error' && message.error && (
          <div className="mt-2 px-3 py-2 rounded-btn bg-err-bg text-err text-xs border border-err/30">{message.error}</div>
        )}
        {message.role === 'assistant' && message.tokenUsage && message.status !== 'streaming' && (
          <div className="mt-2 text-xs text-muted-foreground">
            {message.tokenUsage.totalTokens.toLocaleString()} tokens
          </div>
        )}
      </div>
      {plainText && message.status !== 'streaming' && (
        <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <CopyButton text={plainText} />
        </div>
      )}
    </div>
  );
}
