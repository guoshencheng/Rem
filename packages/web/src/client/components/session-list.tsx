import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { SessionInfo } from 'rem-agent-core';

interface SessionListProps {
  sessions: SessionInfo[];
  currentId?: string;
  onSelect: (sessionId: string) => void;
}

export function SessionList({ sessions, currentId, onSelect }: SessionListProps) {
  return (
    <div className="flex h-full flex-col p-2">
      <div className="mx-1 mb-2 mt-1 text-[9px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
        Sessions
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 pr-1">
          {sessions.map((s) => (
            <button
              key={s.sessionId}
              onClick={() => onSelect(s.sessionId)}
              className={cn(
                'flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-xs hover:bg-muted',
                s.sessionId === currentId && 'border-primary/60 bg-accent',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{s.title ?? s.sessionId}</span>
                <span className="block text-[10px] text-muted-foreground">
                  {s.activity && s.activity !== 'idle' ? s.activity : `${s.messageCount} 条消息`}
                </span>
              </span>
              <Badge variant={s.mode === 'multi-agent' ? 'default' : 'outline'} className="text-[9px]">
                {s.mode === 'multi-agent' ? 'multi' : 'single'}
              </Badge>
            </button>
          ))}
          {sessions.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              还没有 Session，点右上角新建
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
