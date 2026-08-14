import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import type { ConnectionState } from '@/types';
import { useStreamStore } from '@/state/stream-store';
import { TopBar } from '@/components/top-bar';
import { StatusBar } from '@/components/status-bar';
import { SessionList } from '@/components/session-list';
import { NewSessionDialog } from '@/components/new-session-dialog';
import { ChatView } from '@/components/chat-view';
import { RuntimeExecutionInspector } from '@/components/runtime-execution-inspector';
import { WorkbenchShell } from '@/components/workbench-shell';

export function App() {
  const sessions = useStreamStore((s) => s.sessions);
  const bySession = useStreamStore((s) => s.bySession);
  const [sessionId, setSessionId] = useState<string>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [agentId, setAgentId] = useState(() => {
    try { return globalThis.localStorage?.getItem('rem-agent.selected-agent') ?? api.defaultAgentId; }
    catch { return api.defaultAgentId; }
  });
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(new Set());
  const pendingSessionLoads = useRef(new Set<string>());
  const skipNextChatRefresh = useRef(new Set<string>());

  const current = sessions.find((s) => s.sessionId === sessionId);
  const currentState = sessionId ? bySession[sessionId] : undefined;
  const running = sessionId !== undefined && runningSessionIds.has(sessionId);

  const loadSession = useCallback(async (id: string) => {
    pendingSessionLoads.current.add(id);
    let loaded = false;
    try {
      const chat = await api.getChat(id);
      useStreamStore.getState().setChat(id, chat);
      loaded = true;
    } finally {
      pendingSessionLoads.current.delete(id);
      if (loaded) skipNextChatRefresh.current.add(id);
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    useStreamStore.getState().setSessions(await api.listSessions());
  }, []);

  useEffect(() => {
    void refreshSessions()
      .then(() => setConnection('connected'))
      .catch(() => setConnection('reconnecting'));
  }, [refreshSessions]);

  useEffect(() => {
    if (sessionId) void loadSession(sessionId);
  }, [sessionId, loadSession]);

  useEffect(() => {
    // `loadSession` hydrates the initial chat. Only a positive stream version
    // represents a later event-driven refresh; otherwise selection would
    // immediately issue a second `/entries` request.
    if (!sessionId || !currentState || currentState.chatVersion === 0) return;
    if (pendingSessionLoads.current.has(sessionId)) return;
    if (skipNextChatRefresh.current.delete(sessionId)) return;
    void api.getChat(sessionId).then((chat) =>
      useStreamStore.getState().setChat(sessionId, chat));
  }, [sessionId, currentState?.chatVersion]);

  const send = async (content: string) => {
    if (!sessionId) return;
    const sendingSessionId = sessionId;
    let runId: string | undefined;
    setRunningSessionIds((current) => new Set(current).add(sessionId));
    useStreamStore.getState().setError(sessionId, undefined);
    try {
      const completed = await api.sendMessage(sessionId, content, agentId, {
        onStarted: (run) => {
          runId = run.runId;
          useStreamStore.getState().beginRuntimeRun(sendingSessionId, run.runId, content);
        },
        onSignal: (signal) => useStreamStore.getState().applyRuntimeSignal(sendingSessionId, signal),
      });
      if (completed.status === 'completed') {
        const chat = await api.getChat(sendingSessionId);
        useStreamStore.getState().setChat(sendingSessionId, chat);
        await refreshSessions();
      } else if (runId) {
        useStreamStore.getState().failRuntimeRun(sendingSessionId, runId, '运行已取消', 'cancelled');
        useStreamStore.getState().setError(sendingSessionId, '运行已取消');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (runId) useStreamStore.getState().failRuntimeRun(sendingSessionId, runId, message);
      useStreamStore.getState().setError(sendingSessionId, message);
    } finally {
      setRunningSessionIds((current) => {
        const next = new Set(current); next.delete(sendingSessionId); return next;
      });
    }
  };

  const hasInspector = sessionId !== undefined;
  const selectSession = (id: string) => {
    if (id === sessionId) {
      setSessionOpen(false);
      return;
    }
    pendingSessionLoads.current.add(id);
    setSessionId(id);
    setSessionOpen(false);
  };
  return (
    <>
      <WorkbenchShell
        topBar={<TopBar
        session={current}
        agentId={agentId}
        running={running}
        hasInspector={hasInspector}
        onInterrupt={() => sessionId && void api.interrupt(sessionId)}
        onNewSession={() => setDialogOpen(true)}
        onOpenSessions={() => setSessionOpen(true)}
        onOpenInspector={() => setInspectorOpen(true)}
      />}
        sessionPanel={<SessionList sessions={sessions} currentId={sessionId} runningSessionIds={runningSessionIds} onSelect={selectSession} />}
        inspector={hasInspector && sessionId ? <RuntimeExecutionInspector
          sessionId={sessionId}
          onResolved={async () => { await loadSession(sessionId); await refreshSessions(); }}
        /> : undefined}
        statusBar={<StatusBar
        session={current}
        runningRuns={running ? 1 : 0}
        connection={connection}
      />}
        sessionOpen={sessionOpen}
        onSessionOpenChange={setSessionOpen}
        inspectorOpen={inspectorOpen}
        onInspectorOpenChange={setInspectorOpen}
      >
        {sessionId ? (
          <ChatView sessionId={sessionId} running={running} onSend={(c) => void send(c)} />
        ) : (
          <div className="flex h-full items-center justify-center text-body text-muted-foreground">
            选择或新建一个 Session 开始
          </div>
        )}
      </WorkbenchShell>
      <NewSessionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={(id) => {
          setDialogOpen(false);
          void refreshSessions().then(() => selectSession(id));
        }}
        agentId={agentId}
        onAgentChange={(next) => {
          setAgentId(next);
          try { globalThis.localStorage?.setItem('rem-agent.selected-agent', next); } catch { /* unavailable in SSR */ }
        }}
      />
    </>
  );
}
