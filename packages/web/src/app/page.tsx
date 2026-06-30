'use client';

import { useEffect, useMemo } from 'react';
import { useSessionStore } from '@/lib/session-store';
import { SessionSidebar } from '@/components/sidebar/session-sidebar';
import { ChatPanel } from '@/components/chat/chat-panel';
import { useSSE } from '@/lib/use-sse';
import { AgentRemoteService } from 'rem-agent-bridge/client';
import type { SessionStatus } from '@/components/chat/chat-panel';

export default function Home() {
  const init = useSessionStore((s) => s.init);
  const messages = useSessionStore((s) => s.messages);
  const streaming = useSessionStore((s) => s.streaming);
  const reconnecting = useSessionStore((s) => s.reconnecting);
  const serverError = useSessionStore((s) => s.serverError);
  const storeError = useSessionStore((s) => s.error);
  const initialized = useSessionStore((s) => s.initialized);
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const pendingContent = useSessionStore((s) => s.pendingContent);
  const sessions = useSessionStore((s) => s.sessions);
  const onChunk = useSessionStore((s) => s.onChunk);
  const setReconnecting = useSessionStore((s) => s.setReconnecting);
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const interrupt = useSessionStore((s) => s.interrupt);
  const selectSession = useSessionStore((s) => s.selectSession);
  const createSession = useSessionStore((s) => s.createSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const setSearchQuery = useSessionStore((s) => s.setSearchQuery);

  const agentService = useMemo(() => new AgentRemoteService(''), []);
  const { connect, disconnect } = useSSE(agentService);

  useEffect(() => {
    init().then(() => {
      const state = useSessionStore.getState();
      if (state.sessions.length > 0 && !state.currentSessionId) {
        state.selectSession(state.sessions[0].sessionId);
      } else if (!state.currentSessionId) {
        state.createSession();
      } else {
        useSessionStore.setState({ initialized: true });
      }
    });
  }, [init]);

  useEffect(() => {
    if (!pendingContent || !currentSessionId) return;

    connect(
      currentSessionId,
      pendingContent,
      (chunk) => onChunk(chunk),
      (err) => {
        console.error('SSE error:', err);
        onChunk({ type: 'error', error: err } as any);
      },
      (status) => {
        setReconnecting(status === 'reconnecting');
      },
    );

    return () => disconnect();
  }, [pendingContent, currentSessionId]);

  const status: SessionStatus = reconnecting
    ? 'loading'
    : streaming
      ? 'streaming'
      : serverError || storeError
        ? 'error'
        : initialized
          ? 'done'
          : 'idle';

  const error = serverError ? '服务异常' : storeError;

  return (
    <div className="flex h-full">
      <SessionSidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSwitch={selectSession}
        onCreate={createSession}
        onDelete={deleteSession}
        onSearch={setSearchQuery}
      />
      <ChatPanel
        messages={messages}
        status={status}
        error={error}
        initialized={initialized}
        onSend={sendMessage}
        onInterrupt={interrupt}
      />
    </div>
  );
}
