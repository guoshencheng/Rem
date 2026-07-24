'use client';

import { useCallback, useEffect, useState } from 'react';
import type { IAgentService } from 'rem-agent-bridge/client';
import { ChatPanel } from './chat/chat-panel';
import { ChildAgentDrawer } from './chat/child-agent-drawer';
import type { useAgents } from '../lib/use-agents';

type Agents = ReturnType<typeof useAgents>;

export interface ChatSessionViewProps {
  agentService: IAgentService;
  workspace: string;
  agents: Agents;
}

export function ChatSessionView({ agentService, workspace, agents }: ChatSessionViewProps) {
  const {
    currentSession,
    switchSession,
    send,
    interrupt,
    resolveApproval,
    initialized,
    getSessionState,
    loadSession,
  } = agents;
  const [drawerChildId, setDrawerChildId] = useState<string | null>(null);

  const currentSessionId = currentSession?.id ?? null;
  useEffect(() => {
    setDrawerChildId(null);
  }, [currentSessionId, workspace]);

  const handleOpenChild = useCallback((sessionId: string) => {
    loadSession(sessionId);
    setDrawerChildId(sessionId);
  }, [loadSession]);

  const handleOpenChildFull = useCallback((sessionId: string) => {
    setDrawerChildId(null);
    switchSession(sessionId);
  }, [switchSession]);

  const drawerChild = drawerChildId ? currentSession?.childAgents.get(drawerChildId) ?? null : null;
  const drawerSession = drawerChildId ? getSessionState(drawerChildId) : null;

  if (!currentSession) {
    return (
      <div className="flex-1 flex items-center justify-center text-tx3 text-sm">
        Select or create a conversation
      </div>
    );
  }

  return (
    <>
      <ChatPanel
        key={`${workspace}-${currentSession.id}`}
        messages={currentSession.messages}
        status={currentSession.status}
        error={currentSession.error}
        activity={currentSession.activity}
        pendingApprovals={currentSession.pendingApprovals}
        initialized={initialized}
        tokenUsage={currentSession.tokenUsage}
        childAgents={currentSession.childAgents}
        onOpenChild={handleOpenChild}
        onSend={send}
        onInterrupt={interrupt}
        onResolveApproval={resolveApproval}
        agentService={agentService}
        workspace={workspace}
        sessionId={currentSession.id}
      />
      {drawerChild && (
        <ChildAgentDrawer
          child={drawerChild}
          session={drawerSession}
          onClose={() => setDrawerChildId(null)}
          onOpenFull={handleOpenChildFull}
        />
      )}
    </>
  );
}
