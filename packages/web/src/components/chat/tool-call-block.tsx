'use client';

import { useState } from 'react';
import { ChevronRight, Wrench, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolCallRecord } from 'rem-agent-core';

interface ToolCallBlockProps {
  tool: ToolCallRecord;
}

export function ToolCallBlock({ tool }: ToolCallBlockProps) {
  const [open, setOpen] = useState(false);
  const hasResult = !!tool.result;
  const isError = !!tool.result?.error;
  const isExecuting = !hasResult;

  const statusIcon = isExecuting
    ? <Loader2 size={14} className="animate-spin text-tx3" />
    : isError
      ? <XCircle size={14} className="text-err" />
      : <CheckCircle2 size={14} className="text-ok" />;

  const statusText = isExecuting ? '执行中...' : isError ? '执行失败' : tool.result?.output?.slice(0, 60) ?? '完成';

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-chip text-xs font-medium transition-colors w-full text-left',
          isError ? 'bg-err-bg text-err' : isExecuting ? 'bg-bd text-tx3' : 'bg-ok-bg text-ok',
        )}
      >
        <ChevronRight
          size={12}
          className={cn('transition-transform flex-shrink-0', open && 'rotate-90')}
        />
        <Wrench size={12} className="flex-shrink-0" />
        <span className="font-mono truncate">{tool.name}</span>
        {statusIcon}
        <span className="truncate text-tx3 flex-1">{statusText}</span>
      </button>

      {open && (
        <div className="mt-1.5 mx-2 px-3 py-2 rounded-card bg-card2 border border-bd text-xs">
          <div className="text-tx3 mb-1 font-medium">入参</div>
          <pre className="text-tx2 font-mono text-xs overflow-x-auto max-h-24 whitespace-pre-wrap">
            {JSON.stringify(tool.arguments, null, 2) || '{}'}
          </pre>
          {hasResult && (
            <>
              <div className="text-tx3 mt-2 mb-1 font-medium">
                {isError ? '错误' : '出参'}
              </div>
              <pre
                className={cn(
                  'font-mono text-xs overflow-x-auto max-h-32 whitespace-pre-wrap',
                  isError ? 'text-err' : 'text-tx2',
                )}
              >
                {isError ? tool.result!.error : tool.result!.output}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
