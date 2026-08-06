import { useState } from 'react';
import { ChevronRight, Wrench, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolCall } from 'rem-agent-core';

export interface ToolResultInfo {
  output?: string;
  error?: string;
}

interface ToolCallBlockProps {
  tool: ToolCall;
  result?: ToolResultInfo;
}

export function ToolCallBlock({ tool, result }: ToolCallBlockProps) {
  const [open, setOpen] = useState(false);
  const isError = !!result?.error;
  const isExecuting = !result;

  const statusIcon = isExecuting
    ? <Loader2 size={14} className="animate-spin text-muted-foreground" />
    : isError
      ? <XCircle size={14} className="text-destructive" />
      : <CheckCircle2 size={14} className="text-emerald-400" />;

  const statusText = isExecuting ? '执行中…' : isError ? '执行失败' : (result?.output?.slice(0, 60) ?? '完成');

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs font-medium transition-colors',
          isError ? 'bg-destructive/20 text-destructive'
            : isExecuting ? 'bg-muted text-muted-foreground'
              : 'bg-emerald-500/10 text-emerald-400',
        )}
      >
        <ChevronRight size={12} className={cn('shrink-0 transition-transform', open && 'rotate-90')} />
        <Wrench size={12} className="shrink-0" />
        <span className="truncate font-mono">{tool.name}</span>
        {statusIcon}
        <span className="flex-1 truncate text-muted-foreground">{statusText}</span>
      </button>
      {open && (
        <div className="mx-2 mt-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs">
          <div className="mb-1 font-medium text-muted-foreground">入参</div>
          <pre className="max-h-24 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-foreground">
            {JSON.stringify(tool.arguments, null, 2) || '{}'}
          </pre>
          {result && (
            <>
              <div className="mb-1 mt-2 font-medium text-muted-foreground">
                {isError ? '错误' : '出参'}
              </div>
              <pre className={cn(
                'max-h-32 overflow-x-auto whitespace-pre-wrap font-mono text-xs',
                isError ? 'text-destructive' : 'text-foreground',
              )}>
                {isError ? result.error : result.output}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
