'use client';

import { useSessionStore } from '@/lib/session-store';
import { SessionItem } from './session-item';

export function SessionList() {
  const sessions = useSessionStore((s) => s.sessions);
  const currentSessionId = useSessionStore((s) => s.currentSessionId);

  const sorted = [...sessions].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return (Number(b.updatedAt) ?? 0) - (Number(a.updatedAt) ?? 0);
  });

  if (sessions.length === 0) {
    return (
      <div className="px-4 py-8 text-xs text-tx3 text-center">暂无对话</div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
      {sorted.map((s) => (
        <SessionItem key={s.sessionId} session={s} isActive={s.sessionId === currentSessionId} />
      ))}
    </div>
  );
}
