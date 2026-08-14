import { useState } from 'react';
import { ChevronRight, Wrench } from 'lucide-react';
import type { ToolCall } from 'rem-agent-core';
import { StatusDot } from '@/components/status-dot';
import type { StatusTone } from '@/components/status-dot';
import { cn } from '@/lib/utils';

export interface ToolResultInfo {
  output?: string;
  error?: string;
  details?: unknown;
  partialResult?: unknown;
  pending?: boolean;
}

interface ToolCallBlockProps {
  tool: ToolCall;
  result?: ToolResultInfo;
}

export function ToolCallBlock({ tool, result }: ToolCallBlockProps) {
  const [open, setOpen] = useState(false);
  const tone: StatusTone = !result || result.pending ? 'running' : result.error ? 'error' : 'success';
  const statusText = !result
    ? '执行中…'
    : result.pending
      ? `执行中… ${JSON.stringify(result.partialResult ?? '').slice(0, 48)}`
    : result.error
      ? '执行失败'
      : (result.output?.slice(0, 60) ?? '完成');

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        data-tone={tone}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex h-[var(--ds-control-sm-height)] w-full items-center gap-[var(--ds-space-row-gap)] rounded-md border px-[var(--ds-control-sm-padding-x)] text-left text-meta leading-control font-medium transition-colors [&_svg]:size-3',
          tone === 'error'
            ? 'border-destructive/40 bg-destructive/10 text-destructive'
            : tone === 'success'
              ? 'border-status-success/30 bg-status-success/10 text-status-success'
              : 'border-border bg-raised text-muted-foreground',
        )}
      >
        <ChevronRight className={cn('shrink-0 transition-transform', open && 'rotate-90')} />
        <Wrench className="shrink-0" />
        <span className="truncate font-mono">{tool.name}</span>
        <StatusDot tone={tone} />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{statusText}</span>
      </button>
      {open && (
        <div className="mx-[var(--ds-space-inner)] mt-[var(--ds-space-tree)] rounded-md border border-border-subtle bg-surface p-[var(--ds-space-card)] text-meta">
          <div className="mb-[var(--ds-space-tree)] font-medium text-muted-foreground">入参</div>
          <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-meta text-foreground">
            {JSON.stringify(tool.arguments, null, 2) || '{}'}
          </pre>
          {result && (
            <>
              <div className="mb-[var(--ds-space-tree)] mt-[var(--ds-space-inner)] font-medium text-muted-foreground">
                {result.pending ? '实时结果' : result.error ? '错误' : '出参'}
              </div>
              <pre className={cn(
                'max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-meta',
                result.error ? 'text-destructive' : 'text-foreground',
              )}>
                {result.error ?? result.output ?? JSON.stringify(result.partialResult, null, 2)}
              </pre>
              {result.details !== undefined && (
                <pre className="mt-[var(--ds-space-tree)] max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-meta text-foreground">
                  {JSON.stringify(result.details, null, 2)}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
