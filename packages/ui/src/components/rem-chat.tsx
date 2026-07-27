'use client';

import { useEffect } from 'react';
import type { IAgentService } from 'rem-agent-bridge/client';
import { useAgents } from '../lib/use-agents';
import { ChatSessionView } from './chat-session-view';

export interface RemChatProps {
  service: IAgentService;
  sessionId: string;
  workspace?: string;
  className?: string;
}

export function RemChat({ service: agentService, sessionId, workspace = 'default', className }: RemChatProps) {
  const agents = useAgents(agentService, { workspace });
  const { switchSession, currentSession } = agents;

  useEffect(() => {
    switchSession(sessionId);
  }, [sessionId, switchSession]);

  if (!currentSession || currentSession.id !== sessionId) {
    return (
      <div className={className}>
        <div className="flex h-full items-center justify-center text-tx2 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className={className ?? 'flex h-full flex-1'}>
      <ChatSessionView workspace={workspace} agents={agents} />
    </div>
  );
}
