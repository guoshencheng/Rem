import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api/client';
import { startEventBus } from '@/api/bus';
import type { SseConnectionState } from '@/api/bus';
import { useStreamStore } from '@/state/stream-store';
import { TopBar } from '@/components/top-bar';
import { StatusBar } from '@/components/status-bar';
import { SessionList } from '@/components/session-list';
import { NewSessionDialog } from '@/components/new-session-dialog';
import { ChatView } from '@/components/chat-view';
import { ThreadPanel } from '@/components/thread-panel';
import { WorkbenchShell } from '@/components/workbench-shell';

export function App() {
  const sessions = useStreamStore((s) => s.sessions);
  const bySession = useStreamStore((s) => s.bySession);
  const [sessionId, setSessionId] = useState<string>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [connection, setConnection] = useState<SseConnectionState>('connecting');

  const current = sessions.find((s) => s.sessionId === sessionId);
  const currentState = sessionId ? bySession[sessionId] : undefined;
  const running = current?.activity !== undefined && current.activity !== 'idle';

  const loadSession = useCallback(async (id: string) => {
    const [chat, threads] = await Promise.all([api.getChat(id), api.getThreads(id)]);
    useStreamStore.getState().setChat(id, chat);
    useStreamStore.getState().setThreads(id, threads);
    const primary = threads.find((t) => t.role === 'primary' || t.role === 'organizer');
    if (primary) {
      const messages = await api.getThreadMessages(id, primary.agentThreadId);
      useStreamStore.getState().setThreadMessages(
        { sessionId: id, threadId: primary.agentThreadId }, messages);
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    useStreamStore.getState().setSessions(await api.listSessions());
  }, []);

  useEffect(() => {
    const updateConnection = (event: Event) => {
      setConnection((event as CustomEvent<SseConnectionState>).detail);
    };
    window.addEventListener('rem:sse-state', updateConnection);
    void refreshSessions();
    const stop = startEventBus({
      onEvent: (event) => useStreamStore.getState().applyEvent(event),
      onReconnect: () => {
        void refreshSessions();
        if (sessionId) void loadSession(sessionId);
      },
    });
    return () => {
      window.removeEventListener('rem:sse-state', updateConnection);
      stop();
    };
  }, [refreshSessions, loadSession, sessionId]);

  useEffect(() => {
    if (sessionId) void loadSession(sessionId);
  }, [sessionId, loadSession]);

  useEffect(() => {
    if (!sessionId || !currentState) return;
    void api.getChat(sessionId).then((chat) =>
      useStreamStore.getState().setChat(sessionId, chat));
  }, [sessionId, currentState?.chatVersion]);

  useEffect(() => {
    if (!sessionId || !currentState) return;
    const entries = Object.entries(currentState.threadVersions);
    for (const [threadId, version] of entries) {
      if (version > 0) {
        void api.getThreadMessages(sessionId, threadId).then((messages) =>
          useStreamStore.getState().setThreadMessages({ sessionId, threadId }, messages));
      }
    }
  }, [sessionId, currentState?.threadVersions]);

  const send = async (content: string) => {
    if (!sessionId) return;
    await api.sendMessage(sessionId, content);
    const chat = await api.getChat(sessionId);
    useStreamStore.getState().setChat(sessionId, chat);
  };

  const hasInspector = sessionId !== undefined && current?.mode === 'multi-agent';
  const selectSession = (id: string) => {
    setSessionId(id);
    setSessionOpen(false);
  };

  return (
    <>
      <WorkbenchShell
        topBar={<TopBar
        session={current}
        running={running}
        hasInspector={hasInspector}
        onInterrupt={() => sessionId && void api.interrupt(sessionId)}
        onNewSession={() => setDialogOpen(true)}
        onOpenSessions={() => setSessionOpen(true)}
        onOpenInspector={() => setInspectorOpen(true)}
      />}
        sessionPanel={<SessionList sessions={sessions} currentId={sessionId} onSelect={selectSession} />}
        inspector={hasInspector && sessionId ? <ThreadPanel sessionId={sessionId} /> : undefined}
        statusBar={<StatusBar
        session={current}
        threadCount={currentState?.threads.length ?? 0}
        runningThreads={Object.keys(currentState?.streaming ?? {}).length}
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
          setSessionId(id);
        }}
      />
    </>
  );
}
