'use client';

import { MessageList } from './message-list';
import { ChatComposer } from './chat-composer';
import { TodoPanel } from './todo-panel';
import { useTodos } from '@/lib/use-todos';
import type { UIMessage, SessionActivity } from '@/lib/types';
import type { ApprovalDecision, ApprovalRequest, LanguageModelUsage, Rule } from 'rem-agent-core';
import type { IAgentService } from 'rem-agent-bridge/client';

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
  childAgents?: Map<string, {
    childSessionId: string;
    summary: string;
    status: 'running' | 'completed' | 'failed';
    tokenUsage?: LanguageModelUsage;
  }>;
  onOpenChild?: (sessionId: string) => void;
  onSend(content: string): void;
  onInterrupt(): void;
  onResolveApproval(approvalId: string, decision: ApprovalDecision, rule?: Omit<Rule, 'source'>): void;
  agentService: IAgentService;
  workspace: string;
  sessionId: string;
}

export function ChatPanel({
  messages,
  status,
  error,
  activity,
  pendingApprovals,
  initialized,
  tokenUsage,
  maxTokens = 128_000,
  childAgents,
  onOpenChild,
  onSend,
  onInterrupt,
  onResolveApproval,
  agentService,
  workspace,
  sessionId,
}: ChatPanelProps) {
  const streaming = status === 'streaming' || status === 'loading';
  const { todos } = useTodos(agentService, workspace, sessionId);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <header className="flex items-center gap-3 px-4 h-12 border-b border-bd flex-shrink-0">
        <span className="text-sm font-medium text-tx truncate flex-1">Rem Agent</span>
        {error && (
          <span className="text-xs text-err bg-err-bg px-2 py-0.5 rounded-chip">{error}</span>
        )}
      </header>
      <MessageList messages={messages} onSend={onSend} childAgents={childAgents} onOpenChild={onOpenChild} />
      <div className="max-w-3xl mx-auto w-full px-4 pb-4">
        <TodoPanel todos={todos} />
        <ChatComposer
          streaming={streaming}
          initialized={initialized}
          activity={activity}
          tokenUsage={tokenUsage}
          maxTokens={maxTokens}
          pendingApprovals={pendingApprovals}
          onSend={onSend}
          onInterrupt={onInterrupt}
          onResolveApproval={onResolveApproval}
        />
      </div>
    </div>
  );
}
