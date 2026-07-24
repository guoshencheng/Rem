'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { AgentRemoteService } from 'rem-agent-bridge/client';
import type { Workspace } from 'rem-agent-bridge';
import { useAgents } from '../lib/use-agents';
import type { SessionSummary } from '../lib/use-agents';
import { WorkspaceSidebar } from './sidebar/workspace-sidebar';
import { ChatSessionView } from './chat-session-view';
import { AddWorkspaceDialog } from './workspace/add-workspace-dialog';

export interface RemAppProps {
  apiPrefix?: string;
  baseUrl?: string;
  className?: string;
}

export function RemApp({ apiPrefix = '/api/rem', baseUrl = '', className }: RemAppProps) {
  const agentService = useMemo(() => new AgentRemoteService(baseUrl, { apiPrefix }), [baseUrl, apiPrefix]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Track workspace that needs a session created after activation
  const [pendingCreate, setPendingCreate] = useState<string | null>(null);

  // Load workspace list on mount
  useEffect(() => {
    agentService.listWorkspaces().then((list) => {
      setWorkspaces(list);
      if (list.length > 0) {
        setActiveWorkspace(list[0].path);
      }
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [agentService]);

  // Sessions for the active workspace
  const agents = useAgents(agentService, { workspace: activeWorkspace ?? '' });
  const {
    currentSession,
    sessions,
    switchSession,
    createSession,
    deleteSession,
  } = agents;

  // Create session after workspace activation when triggered from a different workspace
  useEffect(() => {
    if (pendingCreate && pendingCreate === activeWorkspace) {
      createSession();
      setPendingCreate(null);
    }
  }, [pendingCreate, activeWorkspace, createSession]);

  const handleAddWorkspace = useCallback(async (path: string) => {
    const ws = await agentService.addWorkspace(path);
    setWorkspaces((prev) => [...prev, ws]);
    setActiveWorkspace(ws.path);
    setDialogOpen(false);
  }, [agentService]);

  const handleRemoveWorkspace = useCallback((path: string) => {
    setWorkspaces((prev) => {
      const next = prev.filter((w) => w.path !== path);
      if (activeWorkspace === path) {
        setActiveWorkspace(next[0]?.path ?? null);
      }
      return next;
    });
  }, [activeWorkspace]);

  const handleCreateSession = useCallback((wsPath: string) => {
    if (wsPath === activeWorkspace) {
      createSession();
    } else {
      setActiveWorkspace(wsPath);
      setPendingCreate(wsPath);
    }
  }, [activeWorkspace, createSession]);

  const handleSearch = useCallback(async (q: string) => {
    if (!activeWorkspace) return;
    if (q) {
      await fetch(`${apiPrefix}/sessions?workspace=${encodeURIComponent(activeWorkspace)}&q=${encodeURIComponent(q)}`);
    } else {
      agentService.listSessions(activeWorkspace).catch(() => {});
    }
  }, [agentService, apiPrefix, activeWorkspace]);

  if (!loaded) {
    return <div className="flex h-full items-center justify-center text-tx2 text-sm">Loading...</div>;
  }

  return (
    <div className={className ?? 'flex h-full'}>
      <WorkspaceSidebar
        workspaces={workspaces}
        activeWorkspace={activeWorkspace}
        sessions={sessions as SessionSummary[]}
        currentSessionId={currentSession?.id ?? null}
        onSelectWorkspace={setActiveWorkspace}
        onAddWorkspace={() => setDialogOpen(true)}
        onRemoveWorkspace={handleRemoveWorkspace}
        onSwitchSession={switchSession}
        onCreateSession={handleCreateSession}
        onDeleteSession={deleteSession}
        onSearch={handleSearch}
      />
      {activeWorkspace ? (
        <ChatSessionView agentService={agentService} workspace={activeWorkspace} agents={agents} />
      ) : (
        <div className="flex-1 flex items-center justify-center text-tx3 text-sm">
          Select or add a workspace
        </div>
      )}
      <AddWorkspaceDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onAdd={handleAddWorkspace} />
    </div>
  );
}
