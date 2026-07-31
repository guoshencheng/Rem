'use client';

import { useMemo } from 'react';
import { cn } from '../../lib/utils.js';
import { MarkdownContent } from './markdown-content.js';
import { ChildAgentCard } from './child-agent-card.js';
import { CopyButton } from './copy-button.js';
import type { UIMessage, UiContentBlock } from 'rem-agent-bridge';
import type { ChildAgentInfo } from '../../lib/use-agents.js';
import { ReasoningBlock } from './reasoning-block.js';
import { ToolCallBlock } from './tool-call-block.js';

interface MessageItemProps {
  message: UIMessage;
  childAgents?: Map<string, ChildAgentInfo>;
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

  // childAgents 是原地 mutate 的 Map（引用不变），不能用 useMemo 依赖引用，必须每次渲染重新计算
  const childByToolCallId = new Map<string, ChildAgentInfo>();
  if (childAgents) {
    for (const child of childAgents.values()) {
      if (child.toolCallId) childByToolCallId.set(child.toolCallId, child);
    }
  }

  const embeddedToolCallIds = new Set(
    message.parts.filter((p) => p.type === 'toolCall').map((p) => (p as { id: string }).id),
  );

  // 旧数据没有持久化 toolCallId，按 delegate_task 入参 task 与卡片 summary 前缀匹配兜底
  const matchByTask = (toolCallId: string, toolName: string, args: unknown): ChildAgentInfo | undefined => {
    const byId = childByToolCallId.get(toolCallId);
    if (byId) return byId;
    if (toolName !== 'delegate_task' || !childAgents) return undefined;
    const task = (args as { task?: unknown })?.task;
    if (typeof task !== 'string') return undefined;
    for (const c of childAgents.values()) {
      if (c.toolCallId) continue;
      if (task === c.summary || task.startsWith(c.summary)) return c;
    }
    return undefined;
  };

  const unlinkedChildren = childAgents
    ? Array.from(childAgents.values()).filter((c) => {
        if (c.toolCallId && embeddedToolCallIds.has(c.toolCallId)) return false;
        if (!c.toolCallId) {
          const matched = message.parts.some(
            (p) => p.type === 'toolCall' && !!matchByTask((p as { id: string }).id, (p as { name: string }).name, (p as { arguments: unknown }).arguments),
          );
          if (matched) return false;
        }
        return true;
      })
    : [];

  if (isUser) {
    return (
      <div className="flex justify-end py-3">
        <div className="max-w-[60%] rounded-card rounded-br-sm bg-ac text-ac-ink px-4 py-2.5 text-sm leading-relaxed">
          {message.parts.map((part, i) => {
            if (part.type === 'text') {
              return <span key={i}>{part.text}</span>;
            }
            if (part.type === 'image') {
              return (
                <img
                  key={i}
                  src={`data:${part.mimeType};base64,${part.data}`}
                  alt="attachment"
                  className="block max-w-[240px] max-h-[180px] rounded-lg mb-1"
                />
              );
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
            const child = matchByTask(part.id, part.name, part.arguments);
            return <ToolCallBlock key={i} tool={part} result={result} child={child} onOpenChild={onOpenChild} />;
          }
          if (part.type === 'text' && part.text) {
            return <MarkdownContent key={i} text={part.text} className="markdown-body" />;
          }
          return null;
        })}
        {unlinkedChildren.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {unlinkedChildren.map((child) => (
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
        {message.role === 'assistant' && message.tokenUsage && message.tokenUsage.totalTokens > 0 && message.status !== 'streaming' && (
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
