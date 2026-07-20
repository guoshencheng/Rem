'use client';

import { useEffect, useRef } from 'react';
import { Loader2, CheckCircle2, XCircle, X, ExternalLink } from 'lucide-react';
import { MessageItem } from './message-item';
import type { ChildAgentInfo, SessionView } from '@/lib/use-agents';

interface ChildAgentDrawerProps {
  child: ChildAgentInfo;
  session: SessionView | null;
  onClose(): void;
  onOpenFull(sessionId: string): void;
}

export function ChildAgentDrawer({ child, session, onClose, onOpenFull }: ChildAgentDrawerProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const messages = session?.messages ?? [];
  const lastMessage = messages[messages.length - 1];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, lastMessage?.status, lastMessage?.parts?.length]);

  const statusIcon =
    child.status === 'running' ? <Loader2 size={14} className="animate-spin text-ac" />
    : child.status === 'failed' ? <XCircle size={14} className="text-err" />
    : <CheckCircle2 size={14} className="text-ok" />;

  return (
    <div className="fixed inset-y-0 right-0 w-[32rem] max-w-[90vw] bg-card border-l border-bd shadow-xl z-40 flex flex-col">
      <header className="flex items-center gap-2 px-4 h-12 border-b border-bd flex-shrink-0">
        {statusIcon}
        <span className="text-sm font-medium text-tx truncate flex-1" title={child.summary}>
          {child.summary}
        </span>
        {child.tokenUsage && (
          <span className="text-xs text-tx3 flex-shrink-0">
            {child.tokenUsage.totalTokens.toLocaleString()} tokens
          </span>
        )}
        <button
          onClick={() => onOpenFull(child.childSessionId)}
          className="p-1.5 rounded-btn text-tx3 hover:text-tx hover:bg-bd transition-colors"
          title="打开完整会话"
        >
          <ExternalLink size={14} />
        </button>
        <button
          onClick={onClose}
          className="p-1.5 rounded-btn text-tx3 hover:text-tx hover:bg-bd transition-colors"
          title="关闭"
        >
          <X size={14} />
        </button>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin pb-6">
        <div className="px-4">
          {messages.length === 0 ? (
            <div className="py-8 text-center text-tx3 text-sm">
              {child.status === 'running' ? '子 Agent 启动中...' : '暂无消息'}
            </div>
          ) : (
            messages.map((msg, index) => (
              <MessageItem key={msg.id ?? index} message={msg} />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
