import type { ConnectionState, WorkbenchSession } from '@/types';
import { StatusDot } from '@/components/status-dot';

interface StatusBarProps {
  session?: WorkbenchSession;
  runningRuns?: number;
  connection: ConnectionState;
}

const connectionLabels: Record<ConnectionState, string> = {
  connecting: 'Runtime 连接中…',
  connected: 'Runtime 已连接',
  reconnecting: 'Runtime 重连中…',
};

export function StatusBar({
  session,
  runningRuns,
  connection,
}: StatusBarProps) {
  return (
    <footer className="flex h-full items-center gap-[var(--ds-space-status-gap)] border-t border-border bg-surface px-[var(--ds-space-status-x)] text-label leading-control text-muted-foreground">
      {session && <span className="truncate">会话：{session.title ?? session.sessionId}</span>}
      {(runningRuns ?? 0) > 0 && <span>{runningRuns} 个运行中</span>}
      <span className="ml-auto flex items-center gap-[var(--ds-space-row-gap)]">
        <StatusDot tone={connection === 'connected' ? 'success' : 'running'} />
        {connectionLabels[connection]}
      </span>
    </footer>
  );
}
