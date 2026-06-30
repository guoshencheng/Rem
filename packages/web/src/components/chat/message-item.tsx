'use client';

import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { cn } from '@/lib/utils';
import type { UIMessage } from 'rem-agent-bridge';
import { ReasoningBlock } from './reasoning-block';
import { ToolCallBlock } from './tool-call-block';
import { ThinkingBar } from './thinking-bar';

interface MessageItemProps {
  message: UIMessage;
}

export function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === 'user';

  const markdownComponents = useMemo(
    () => ({
      pre({ children, ...props }: Record<string, unknown>) {
        return (
          <pre className="bg-bd rounded-btn p-3 overflow-x-auto max-h-[140px] text-xs font-mono my-2 border border-bd2" {...props}>
            {children as React.ReactNode}
          </pre>
        );
      },
      code({ className, children, ...props }: Record<string, unknown>) {
        const codeProps = props as Record<string, unknown>;
        const isInline = !className;
        if (isInline) {
          return <code className="bg-bd px-1.5 py-0.5 rounded text-ac text-xs font-mono" {...codeProps}>{children as React.ReactNode}</code>;
        }
        return <code className={cn('text-xs font-mono', className as string | undefined)} {...codeProps}>{children as React.ReactNode}</code>;
      },
      table({ children, ...props }: Record<string, unknown>) {
        return (
          <div className="overflow-x-auto my-2">
            <table className="min-w-full border-collapse border border-bd2 text-xs" {...props}>{children as React.ReactNode}</table>
          </div>
        );
      },
      th({ children, ...props }: Record<string, unknown>) {
        return <th className="border border-bd2 px-3 py-1.5 bg-bd text-tx2 font-medium text-left" {...props}>{children as React.ReactNode}</th>;
      },
      td({ children, ...props }: Record<string, unknown>) {
        return <td className="border border-bd2 px-3 py-1.5 text-tx" {...props}>{children as React.ReactNode}</td>;
      },
    }),
    [],
  );

  if (isUser) {
    return (
      <div className="flex justify-end px-4 py-3">
        <div className="max-w-[80%] rounded-card rounded-br-sm bg-ac text-ac-ink px-4 py-2.5 text-sm leading-relaxed">
          {message.parts.map((part, i) => {
            if (part.type === 'text') {
              return (
                <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={markdownComponents as unknown as Components}>
                  {part.text}
                </ReactMarkdown>
              );
            }
            return null;
          })}
        </div>
      </div>
    );
  }

  const hasContent = message.parts.some((p) => p.type === 'text' && p.text.length > 0);
  const hasReasoning = message.parts.some((p) => p.type === 'reasoning');

  const thinkingStatus: 'pending' | 'streaming' | null =
    message.status === 'pending' ? 'pending'
    : (message.status === 'streaming' && !hasContent && !hasReasoning) ? 'streaming'
    : null;

  return (
    <div className="px-4 py-3">
      <div className={cn(
        'max-w-[85%] rounded-card rounded-bl-sm bg-card border border-bd px-4 py-2.5 text-sm leading-relaxed',
        message.status === 'error' && 'border-err/50',
      )}>
        {thinkingStatus && <ThinkingBar status={thinkingStatus} />}
        {message.parts.map((part, i) => {
          if (part.type === 'reasoning') {
            return <ReasoningBlock key={i} text={part.text} isStreaming={message.status === 'streaming'} />;
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
            return (
              <div key={i} className="prose prose-invert prose-sm max-w-none text-tx">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={markdownComponents as unknown as Components}>
                  {part.text}
                </ReactMarkdown>
              </div>
            );
          }
          return null;
        })}
        {message.status === 'error' && message.error && (
          <div className="mt-2 px-3 py-2 rounded-btn bg-err-bg text-err text-xs border border-err/30">{message.error}</div>
        )}
      </div>
    </div>
  );
}
