'use client';

import { useSessionStore } from '@/lib/session-store';
import { useEffect } from 'react';
import { MessageList } from './message-list';
import { InputBox } from './input-box';
import { useSSE } from '@/lib/use-sse';
import { getStreamUrl } from '@/lib/agent-client';

export function ChatPanel() {
  const streaming = useSessionStore((s) => s.streaming);
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const reconnecting = useSessionStore((s) => s.reconnecting);
  const serverError = useSessionStore((s) => s.serverError);
  const onChunk = useSessionStore((s) => s.onChunk);
  const setReconnecting = useSessionStore((s) => s.setReconnecting);
  const { connect, disconnect } = useSSE();

  useEffect(() => {
    if (!streaming || !currentSessionId) return;

    const streamUrl = getStreamUrl(currentSessionId);
    connect(
      streamUrl,
      (chunk) => onChunk(chunk),
      (err) => {
        console.error('SSE error:', err);
        onChunk({ type: 'error', error: err });
      },
      (status) => {
        setReconnecting(status === 'reconnecting');
      },
    );

    return () => disconnect();
  }, [streaming, currentSessionId, connect, disconnect, onChunk, setReconnecting]);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <header className="flex items-center gap-3 px-4 h-12 border-b border-bd flex-shrink-0">
        <span className="text-sm font-medium text-tx truncate flex-1">Rem Agent</span>
        {reconnecting && (
          <span className="text-xs text-warn bg-warn-bg px-2 py-0.5 rounded-chip animate-pulse">正在重连...</span>
        )}
        {serverError && (
          <span className="text-xs text-err bg-err-bg px-2 py-0.5 rounded-chip">服务异常</span>
        )}
      </header>
      <MessageList />
      <InputBox />
    </div>
  );
}
