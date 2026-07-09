'use client';

import type { SessionActivity } from 'rem-agent-bridge';
import type { ApprovalDecision, ApprovalRequest, LanguageModelUsage } from 'rem-agent-core';
import { ActivityBar } from './activity-bar';
import { InputBox } from './input-box';

export interface ChatComposerProps {
  streaming: boolean;
  initialized: boolean;
  activity?: SessionActivity;
  tokenUsage?: LanguageModelUsage;
  maxTokens?: number;
  pendingApprovals?: ApprovalRequest[];
  onSend(content: string): void;
  onInterrupt(): void;
  onResolveApproval(approvalId: string, decision: ApprovalDecision): void;
}

export function ChatComposer({
  streaming,
  initialized,
  activity,
  tokenUsage,
  maxTokens = 128_000,
  pendingApprovals,
  onSend,
  onInterrupt,
  onResolveApproval,
}: ChatComposerProps) {
  return (
    <div className="bg-card border border-bd rounded-card overflow-hidden">
      {/* Agent status bar */}
      <div className="px-4 py-2.5 border-b border-bd min-h-[38px] flex items-center">
        <ActivityBar activity={activity} showIdle />
      </div>

      {/* Input block: approvals + textarea + token stats + actions */}
      <div className="px-4 py-3">
        <InputBox
          streaming={streaming}
          initialized={initialized}
          pendingApprovals={pendingApprovals}
          tokenUsage={tokenUsage}
          maxTokens={maxTokens}
          onResolveApproval={onResolveApproval}
          onSend={onSend}
          onInterrupt={onInterrupt}
        />
      </div>
    </div>
  );
}
