'use client';

import { MessageList } from './message-list';
import { InputBox } from './input-box';
import { ActivityBar } from './activity-bar';
import { TokenStatsBadge } from './token-stats';
import type { UIMessage, SessionActivity } from '@/lib/types';
import type { ApprovalDecision, ApprovalRequest, LanguageModelUsage } from 'rem-agent-core';

export type SessionStatus = 'idle' | 'loading' | 'streaming' | 'done' | 'error';

interface ChatPanelProps {
  messages: UIMessage[];
  status: SessionStatus;
  error: string | null;
  activity?: SessionActivity;
  pendingApprovals?: ApprovalRequest[];
  initialized: boolean;
  tokenUsage?: LanguageModelUsage;
  maxTokens?: number;
  onSend(content: string): void;
  onInterrupt(): void;
  onResolveApproval(approvalId: string, decision: ApprovalDecision): void;
}

export function ChatPanel({ messages, status, error, activity, pendingApprovals, initialized, tokenUsage, maxTokens = 128_000, onSend, onInterrupt, onResolveApproval }: ChatPanelProps) {
  const streaming = status === 'streaming' || status === 'loading';

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <header className="flex items-center gap-3 px-4 h-12 border-b border-bd flex-shrink-0">
        <span className="text-sm font-medium text-tx truncate flex-1">Rem Agent</span>
        {error && (
          <span className="text-xs text-err bg-err-bg px-2 py-0.5 rounded-chip">{error}</span>
        )}
      </header>
      <MessageList messages={messages} onSend={onSend} />
      <div className="max-w-3xl mx-auto w-full px-4 pb-4">
        {tokenUsage && (
          <div className="mb-2">
            <TokenStatsBadge usage={tokenUsage} maxTokens={maxTokens} />
          </div>
        )}
        <ActivityBar activity={activity} />
        <InputBox
          streaming={streaming}
          initialized={initialized}
          pendingApprovals={pendingApprovals}
          onResolveApproval={onResolveApproval}
          onSend={onSend}
          onInterrupt={onInterrupt}
        />
      </div>
    </div>
  );
}
