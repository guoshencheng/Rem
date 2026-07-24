'use client';

import { useEffect, useMemo } from 'react';
import { AgentRemoteService } from 'rem-agent-bridge/client';
import { useAgents } from '../lib/use-agents';
import { ChatSessionView } from './chat-session-view';

export interface RemChatProps {
  sessionId: string;
  workspace?: string;
  apiPrefix?: string;
  baseUrl?: string;
  className?: string;
}

export function RemChat({ sessionId, workspace = 'default', apiPrefix = '/api/rem', baseUrl = '', className }: RemChatProps) {
  const agentService = useMemo(
    () => new AgentRemoteService(baseUrl, { apiPrefix }),
    [baseUrl, apiPrefix],
  );
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
      <ChatSessionView agentService={agentService} workspace={workspace} agents={agents} />
    </div>
  );
}
