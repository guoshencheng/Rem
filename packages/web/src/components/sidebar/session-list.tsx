'use client';

import { SessionItem } from './session-item';
import type { SessionSummary } from '@/lib/use-agents';

interface SessionListProps {
  sessions: SessionSummary[];
  currentSessionId: string | null;
  onSwitch(id: string): void;
  onDelete(id: string): void;
}

export function SessionList({ sessions, currentSessionId, onSwitch, onDelete }: SessionListProps) {
  const sorted = [...sessions].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return (Number(b.updatedAt) ?? 0) - (Number(a.updatedAt) ?? 0);
  });

  if (sessions.length === 0) {
    return (
      <div className="px-4 py-8 text-xs text-tx3 text-center">No conversations</div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
      {sorted.map((s) => (
        <SessionItem
          key={s.sessionId}
          session={s}
          isActive={s.sessionId === currentSessionId}
          onSwitch={onSwitch}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
