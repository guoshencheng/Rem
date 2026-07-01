'use client';

import { useMemo, useCallback } from 'react';
import { useAgents } from '@/lib/use-agents';
import type { SessionSummary } from '@/lib/use-agents';
import { SessionSidebar } from '@/components/sidebar/session-sidebar';
import { ChatPanel } from '@/components/chat/chat-panel';
import { AgentRemoteService } from 'rem-agent-bridge/client';

export default function Home() {
  const agentService = useMemo(() => new AgentRemoteService(''), []);
  const {
    currentSession,
    sessions,
    switchSession,
    createSession,
    deleteSession,
    send,
    interrupt,
    initialized,
  } = useAgents(agentService);

  const handleSearch = useCallback(async (q: string) => {
    if (q) {
      await fetch(`/api/sessions?q=${encodeURIComponent(q)}`);
    } else {
      agentService.listSessions().catch(() => {});
    }
  }, [agentService]);

  return (
    <div className="flex h-full">
      <SessionSidebar
        sessions={sessions as SessionSummary[]}
        currentSessionId={currentSession?.id ?? null}
        onSwitch={switchSession}
        onCreate={createSession}
        onDelete={deleteSession}
        onSearch={handleSearch}
      />
      {currentSession ? (
        <ChatPanel
          key={currentSession.id}
          messages={currentSession.messages}
          status={currentSession.status}
          error={currentSession.error}
          activity={currentSession.activity}
          initialized={initialized}
          onSend={send}
          onInterrupt={interrupt}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-tx3 text-sm">
          Select or create a conversation
        </div>
      )}
    </div>
  );
}
