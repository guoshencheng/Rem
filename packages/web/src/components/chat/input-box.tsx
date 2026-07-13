'use client';

import { useState, useRef, useCallback, KeyboardEvent } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import type { ApprovalDecision, ApprovalRequest, LanguageModelUsage, Rule } from 'rem-agent-core';
import { cn } from '@/lib/utils';
import { ApprovalBar } from './approval-bar';
import { TokenStatsBadge } from './token-stats';
import { DEFAULT_CONTEXT_WINDOW } from '@/lib/context-window';

interface InputBoxProps {
  streaming: boolean;
  initialized: boolean;
  pendingApprovals?: ApprovalRequest[];
  tokenUsage?: LanguageModelUsage;
  maxTokens?: number;
  onResolveApproval(approvalId: string, decision: ApprovalDecision, rule?: Omit<Rule, 'source'>): void;
  onSend(content: string): void;
  onInterrupt(): void;
}

export function InputBox({
  streaming,
  initialized,
  pendingApprovals,
  tokenUsage,
  maxTokens = DEFAULT_CONTEXT_WINDOW,
  onResolveApproval,
  onSend,
  onInterrupt,
}: InputBoxProps) {
  const [content, setContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const text = content.trim();
    if (!text || streaming || !initialized) return;
    onSend(text);
    setContent('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [content, streaming, initialized, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  };

  const placeholder = initialized ? 'Message...' : 'Connecting...';

  return (
    <div>
      <ApprovalBar approvals={pendingApprovals ?? []} onResolve={onResolveApproval} />
      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={streaming || !initialized}
        placeholder={placeholder}
        rows={1}
        className="w-full bg-transparent text-sm text-tx placeholder-tx3 outline-none resize-none min-h-[24px] max-h-[160px]"
      />
      <div className="flex items-center justify-between mt-3 gap-4">
        <div className="flex items-center gap-3">
          {tokenUsage && <TokenStatsBadge usage={tokenUsage} maxTokens={maxTokens} />}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!initialized}
            className="p-1.5 rounded-lg text-tx3 hover:bg-bd hover:text-tx disabled:opacity-50 transition-colors"
            aria-label="Add attachment"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          {streaming ? (
            <button
              type="button"
              onClick={onInterrupt}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-err text-white text-xs font-medium hover:opacity-90 transition-opacity"
            >
              <Square size={12} fill="currentColor" />
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!content.trim() || !initialized}
              className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
                content.trim() && initialized
                  ? 'bg-ac text-ac-ink hover:opacity-90'
                  : 'bg-tx3/20 text-tx3',
              )}
              aria-label="Send"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
