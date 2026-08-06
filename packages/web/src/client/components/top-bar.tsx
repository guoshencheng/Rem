import { Square, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { SessionInfo } from 'rem-agent-core';

interface TopBarProps {
  session?: SessionInfo;
  running: boolean;
  onInterrupt: () => void;
  onNewSession: () => void;
}

export function TopBar({ session, running, onInterrupt, onNewSession }: TopBarProps) {
  return (
    <header className="flex h-11 items-center border-b border-border bg-card px-3">
      <span className="border-r border-border pr-3 text-[10px] font-extrabold tracking-[0.16em] text-muted-foreground">
        REM
      </span>
      <div className="ml-3 flex items-center gap-2 text-xs">
        <span className="font-medium">{session?.title ?? session?.sessionId ?? '未选择 Session'}</span>
        {session && (
          <Badge variant={session.mode === 'multi-agent' ? 'default' : 'outline'}>
            {session.mode === 'multi-agent' ? 'multi-agent' : 'single'}
          </Badge>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {running && session && (
          <Button variant="secondary" size="sm" onClick={onInterrupt}>
            <Square data-icon="inline-start" />
            中断
          </Button>
        )}
        <Button size="sm" onClick={onNewSession}>
          <Plus data-icon="inline-start" />
          Session
        </Button>
      </div>
    </header>
  );
}
