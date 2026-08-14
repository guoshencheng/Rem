import { Bot } from 'lucide-react';
import type { WorkbenchSession } from '@/types';
import { SectionLabel } from '@/components/section-label';
import { StatusDot } from '@/components/status-dot';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface SessionListProps {
  sessions: WorkbenchSession[];
  currentId?: string;
  runningSessionIds?: ReadonlySet<string>;
  onSelect: (sessionId: string) => void;
}

const activityLabels: Record<NonNullable<WorkbenchSession['activity']>, string> = {
  idle: '空闲',
  running: '运行中',
};

export function SessionList({ sessions, currentId, runningSessionIds, onSelect }: SessionListProps) {
  return (
    <div className="flex h-full min-h-0 flex-col p-[var(--ds-space-panel)]">
      <SectionLabel className="mx-[var(--ds-space-tree)] mb-[var(--ds-space-card)]">
        Sessions
      </SectionLabel>
      {sessions.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>还没有 Session</EmptyTitle>
            <EmptyDescription>从右上角新建一个会话</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="grid gap-[var(--ds-space-tree)] pr-[var(--ds-space-tree)]">
            {sessions.map((session) => {
              const selected = session.sessionId === currentId;
              const active = runningSessionIds?.has(session.sessionId)
                || (session.activity !== undefined && session.activity !== 'idle');
              return (
                <button
                  key={session.sessionId}
                  type="button"
                  data-selected={selected}
                  onClick={() => onSelect(session.sessionId)}
                  className={cn(
                    'grid h-[var(--ds-row-md-height)] w-full grid-cols-[var(--ds-icon-sm)_minmax(0,1fr)] items-center gap-[var(--ds-space-row-gap)] rounded-md border border-transparent px-[var(--ds-space-row-x)] text-left text-control leading-compact text-secondary-foreground transition-colors hover:bg-hover',
                    selected && 'border-selected-border bg-selected-bg',
                  )}
                >
                  <span className="grid size-[var(--ds-icon-sm)] place-items-center rounded-sm bg-raised text-muted-foreground [&_svg]:size-3">
                    <Bot />
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate font-semibold">
                      {session.title ?? session.sessionId}
                    </strong>
                    <small className="flex items-center gap-[var(--ds-space-row-gap)] truncate text-label text-muted-foreground">
                      {active && <StatusDot tone="running" />}
                      {session.activity ? activityLabels[session.activity] : `${session.messageCount} 条消息`}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
