'use client';

import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LanguageModelUsage } from 'rem-agent-core';

interface ChildAgentCardProps {
  summary: string;
  status: 'running' | 'completed' | 'failed';
  tokenUsage?: LanguageModelUsage;
  onClick?: () => void;
}

export function ChildAgentCard({ summary, status, tokenUsage, onClick }: ChildAgentCardProps) {
  const isRunning = status === 'running';
  const isFailed = status === 'failed';

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2 rounded-card text-xs text-left transition-colors',
        isFailed ? 'bg-err-bg text-err border border-err/30' : 'bg-card border border-bd hover:bg-card/80',
      )}
    >
      {isRunning && <Loader2 size={14} className="animate-spin text-ac" />}
      {!isRunning && (isFailed ? <XCircle size={14} className="text-err" /> : <CheckCircle2 size={14} className="text-ok" />)}
      <span className="flex-1 truncate">{summary}</span>
      {tokenUsage && (
        <span className="text-tx3">{tokenUsage.totalTokens.toLocaleString()} tokens</span>
      )}
    </button>
  );
}
