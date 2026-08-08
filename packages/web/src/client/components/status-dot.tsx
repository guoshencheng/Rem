import { cn } from '@/lib/utils';

export type StatusTone = 'running' | 'success' | 'error' | 'offline';

const toneClasses: Record<StatusTone, string> = {
  running: 'bg-status-running',
  success: 'bg-status-success',
  error: 'bg-status-error',
  offline: 'bg-status-offline',
};

export function StatusDot({ tone, className }: { tone: StatusTone; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-tone={tone}
      className={cn('size-1.5 shrink-0 rounded-full', toneClasses[tone], className)}
    />
  );
}
