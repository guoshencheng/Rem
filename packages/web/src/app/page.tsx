'use client';

import { useEffect } from 'react';
import { useSessionStore } from '@/lib/session-store';
import { SessionSidebar } from '@/components/sidebar/session-sidebar';
import { ChatPanel } from '@/components/chat/chat-panel';

export default function Home() {
  const init = useSessionStore((s) => s.init);

  useEffect(() => {
    init().then(() => {
      const { sessions, currentSessionId, createSession } = useSessionStore.getState();
      if (!currentSessionId) {
        createSession();
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
