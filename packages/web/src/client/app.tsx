import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api/client';
import { startEventBus } from '@/api/bus';
import { useStreamStore } from '@/state/stream-store';
import { TopBar } from '@/components/top-bar';
import { StatusBar } from '@/components/status-bar';
import { SessionList } from '@/components/session-list';
import { NewSessionDialog } from '@/components/new-session-dialog';
import { ChatView } from '@/components/chat-view';
import { ThreadPanel } from '@/components/thread-panel';

export function App() {
  const sessions = useStreamStore((s) => s.sessions);
  const bySession = useStreamStore((s) => s.bySession);
  const [sessionId, setSessionId] = useState<string>();
  const [dialogOpen, setDialogOpen] = useState(false);

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
    void refreshSessions();
    return startEventBus({
      onEvent: (event) => useStreamStore.getState().applyEvent(event),
      onReconnect: () => {
        void refreshSessions();
        if (sessionId) void loadSession(sessionId);
      },
    });
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

  return (
    <div className="grid h-screen grid-rows-[auto_1fr_auto]">
      <TopBar
        session={current}
        running={running}
        onInterrupt={() => sessionId && void api.interrupt(sessionId)}
        onNewSession={() => setDialogOpen(true)}
      />
      <div className="grid min-h-0 grid-cols-[220px_1fr_auto]">
        <aside className="border-r border-border bg-card">
          <SessionList sessions={sessions} currentId={sessionId} onSelect={setSessionId} />
        </aside>
        <main className="min-w-0 bg-background">
          {sessionId ? (
            <ChatView sessionId={sessionId} running={running} onSend={(c) => void send(c)} />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              选择或新建一个 Session 开始
            </div>
          )}
        </main>
        {sessionId && current?.mode === 'multi-agent' && (
          <aside className="border-l border-border bg-card">
            <ThreadPanel sessionId={sessionId} />
          </aside>
        )}
      </div>
      <StatusBar
        session={current}
        threadCount={currentState?.threads.length ?? 0}
        runningThreads={Object.keys(currentState?.streaming ?? {}).length}
      />
      <NewSessionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={(id) => {
          setDialogOpen(false);
          setSessionId(id);
        }}
      />
    </div>
  );
}
