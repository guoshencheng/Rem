import { PanelLeft, PanelRight, Plus, Square } from 'lucide-react';
import type { SessionInfo } from 'rem-agent-core';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface TopBarProps {
  session?: SessionInfo;
  running: boolean;
  hasInspector: boolean;
  onInterrupt: () => void;
  onNewSession: () => void;
  onOpenSessions: () => void;
  onOpenInspector: () => void;
}

export function TopBar({
  session,
  running,
  hasInspector,
  onInterrupt,
  onNewSession,
  onOpenSessions,
  onOpenInspector,
}: TopBarProps) {
  return (
    <header className="flex h-full items-center border-b border-border bg-panel px-[var(--ds-space-topbar-x)]">
      <Button
        aria-label="打开 Sessions"
        className="mr-[var(--ds-space-actions)] min-[900px]:hidden"
        variant="ghost"
        size="icon-sm"
        onClick={onOpenSessions}
      >
        <PanelLeft />
      </Button>
      <span className="border-r border-divider pr-3 text-control font-extrabold leading-control tracking-[0.16em] text-muted-foreground">
        REM
      </span>
      <div className="ml-3 flex min-w-0 items-center gap-[var(--ds-space-row-gap)] text-nav leading-compact">
        <span className="truncate font-medium">
          {session?.title ?? session?.sessionId ?? '未选择 Session'}
        </span>
        {session && (
          <Badge variant={session.mode === 'multi-agent' ? 'secondary' : 'outline'}>
            {session.mode === 'multi-agent' ? 'multi-agent' : 'single'}
          </Badge>
        )}
      </div>
      <div className="ml-auto flex items-center gap-[var(--ds-space-actions)]">
        {hasInspector && (
          <Button
            aria-label="打开 Threads"
            className="min-[900px]:hidden"
            variant="ghost"
            size="icon-sm"
            onClick={onOpenInspector}
          >
            <PanelRight />
          </Button>
        )}
        {running && session && (
          <Button variant="secondary" onClick={onInterrupt}>
            <Square data-icon="inline-start" />
            中断
          </Button>
        )}
        <Button onClick={onNewSession}>
          <Plus data-icon="inline-start" />
          Session
        </Button>
      </div>
    </header>
  );
}
