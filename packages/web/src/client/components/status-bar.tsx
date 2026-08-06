import { useEffect, useState } from 'react';
import type { SessionInfo } from 'rem-agent-core';

interface StatusBarProps {
  workspace?: string;
  session?: SessionInfo;
  threadCount: number;
  runningThreads: number;
}

export function StatusBar({ workspace, session, threadCount, runningThreads }: StatusBarProps) {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const update = () => setConnected(true);
    window.addEventListener('rem:sse-connected', update);
    return () => window.removeEventListener('rem:sse-connected', update);
  }, []);
  return (
    <footer className="flex h-6 items-center gap-4 border-t border-border bg-card px-3 text-[10px] text-muted-foreground">
      {workspace && <span className="truncate">workspace: {workspace}</span>}
      {session && <span>session: {session.title ?? session.sessionId}</span>}
      {threadCount > 0 && <span>threads: {threadCount} · {runningThreads} 运行中</span>}
      <span className="ml-auto">{connected ? 'SSE 已连接' : 'SSE 连接中…'}</span>
    </footer>
  );
}
