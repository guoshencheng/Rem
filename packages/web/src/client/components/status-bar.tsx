import type { SseConnectionState } from '@/api/bus';
import type { SessionInfo } from 'rem-agent-core';
import { StatusDot } from '@/components/status-dot';

interface StatusBarProps {
  workspace?: string;
  session?: SessionInfo;
  threadCount: number;
  runningThreads: number;
  connection: SseConnectionState;
}

const connectionLabels: Record<SseConnectionState, string> = {
  connecting: 'SSE 连接中…',
  connected: 'SSE 已连接',
  reconnecting: 'SSE 重连中…',
};

export function StatusBar({
  workspace,
  session,
  threadCount,
  runningThreads,
  connection,
}: StatusBarProps) {
  return (
    <footer className="flex h-full items-center gap-[var(--ds-space-status-gap)] border-t border-border bg-surface px-[var(--ds-space-status-x)] text-label leading-control text-muted-foreground">
      {workspace && <span className="truncate">工作区：{workspace}</span>}
      {session && <span className="truncate">会话：{session.title ?? session.sessionId}</span>}
      {threadCount > 0 && <span>Threads：{threadCount} · {runningThreads} 运行中</span>}
      <span className="ml-auto flex items-center gap-[var(--ds-space-row-gap)]">
        <StatusDot tone={connection === 'connected' ? 'success' : 'running'} />
        {connectionLabels[connection]}
      </span>
    </footer>
  );
}
