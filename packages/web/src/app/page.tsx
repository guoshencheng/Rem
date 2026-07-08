'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { AgentRemoteService } from 'rem-agent-bridge/client';
import type { Workspace } from 'rem-agent-bridge';
import { useAgents } from '@/lib/use-agents';
import type { SessionSummary } from '@/lib/use-agents';
import { SessionSidebar } from '@/components/sidebar/session-sidebar';
import { ChatPanel } from '@/components/chat/chat-panel';
import { WorkspaceTabs } from '@/components/workspace/workspace-tabs';
import { AddWorkspaceDialog } from '@/components/workspace/add-workspace-dialog';
import { WorkspaceOnboarding } from '@/components/workspace/workspace-onboarding';

export default function Home() {
  const agentService = useMemo(() => new AgentRemoteService('', 'default'), []);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    agentService.listWorkspaces().then((list) => {
      setWorkspaces(list);
      if (list.length > 0) {
        setActiveWorkspace(list[0].path);
      }
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [agentService]);

  const handleAdd = useCallback(async (path: string, name?: string) => {
    const ws = await agentService.addWorkspace(path, name);
    setWorkspaces((prev) => [...prev, ws]);
    setActiveWorkspace(ws.path);
    setDialogOpen(false);
  }, [agentService]);

  const handleClose = useCallback((path: string) => {
    setWorkspaces((prev) => {
      const next = prev.filter((w) => w.path !== path);
      if (activeWorkspace === path) {
        setActiveWorkspace(next[0]?.path ?? null);
      }
      return next;
    });
  }, [activeWorkspace]);

  if (!loaded) {
    return <div className="flex h-full items-center justify-center">Loading...</div>;
  }

  if (workspaces.length === 0) {
    return (
      <div className="flex h-full">
        <WorkspaceOnboarding onAdd={() => setDialogOpen(true)} />
        <AddWorkspaceDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onAdd={handleAdd} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <WorkspaceTabs
        workspaces={workspaces}
        activePath={activeWorkspace}
        onSelect={setActiveWorkspace}
        onClose={handleClose}
        onAdd={() => setDialogOpen(true)}
      />
      <div className="flex-1 overflow-hidden">
        {activeWorkspace && (
          <WorkspacePanel
            key={activeWorkspace}
            workspace={activeWorkspace}
          />
        )}
      </div>
      <AddWorkspaceDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onAdd={handleAdd} />
    </div>
  );
}

function WorkspacePanel({ workspace }: { workspace: string }) {
  const agentService = useMemo(() => new AgentRemoteService('', workspace), [workspace]);
  const {
    currentSession,
    sessions,
    switchSession,
    createSession,
    deleteSession,
    send,
    interrupt,
    resolveApproval,
    initialized,
  } = useAgents(agentService, { workspace });

  const handleSearch = useCallback(async (q: string) => {
    if (q) {
      await fetch(`/api/sessions?workspace=${encodeURIComponent(workspace)}&q=${encodeURIComponent(q)}`);
    } else {
      agentService.listSessions(workspace).catch(() => {});
    }
  }, [agentService, workspace]);

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
          pendingApprovals={currentSession.pendingApprovals}
          initialized={initialized}
          tokenUsage={currentSession.tokenUsage}
          onSend={send}
          onInterrupt={interrupt}
          onResolveApproval={resolveApproval}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-tx3 text-sm">
          Select or create a conversation
        </div>
      )}
    </div>
  );
}
