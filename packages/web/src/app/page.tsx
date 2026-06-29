'use client';

import { useEffect } from 'react';
import { useSessionStore } from '@/lib/session-store';
import { SessionSidebar } from '@/components/sidebar/session-sidebar';
import { ChatPanel } from '@/components/chat/chat-panel';

export default function Home() {
  const init = useSessionStore((s) => s.init);

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

  return (
    <div className="flex h-full">
      <SessionSidebar />
      <ChatPanel />
    </div>
  );
}
