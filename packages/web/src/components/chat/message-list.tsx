'use client';

import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useRef, useEffect } from 'react';
import { useSessionStore } from '@/lib/session-store';
import { MessageItem } from './message-item';
import type { UIMessage } from '@/lib/types';

export function MessageList() {
  const messages = useSessionStore((s) => s.messages);
  const streamContent = messages.map((m) => m.content).join('');
  const streamReasoning = messages.map((m) => m.reasoning).join('');
  const virtRef = useRef<VirtuosoHandle>(null);

  useEffect(() => {
    if (messages.length > 0 && virtRef.current) {
      virtRef.current.scrollToIndex({ index: messages.length - 1, behavior: 'smooth' });
    }
  }, [messages.length]);

  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.status === 'streaming') {
      virtRef.current?.scrollToIndex({ index: messages.length - 1, behavior: 'auto' });
    }
  }, [streamContent, streamReasoning]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-tx3 text-sm gap-3">
        <div className="w-12 h-12 rounded-full bg-ac-soft flex items-center justify-center text-ac text-lg font-medium">
          R
        </div>
        <span>你好，请问有什么可以帮助你的？</span>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0">
      <Virtuoso
        ref={virtRef}
        data={messages}
        itemContent={(_index: number, msg: UIMessage) => <MessageItem message={msg} />}
        followOutput="smooth"
        className="scrollbar-thin"
      />
    </div>
  );
}
