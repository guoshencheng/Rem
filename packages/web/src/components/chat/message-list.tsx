'use client';

import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useRef, useEffect } from 'react';
import { MessageItem } from './message-item';
import type { UIMessage } from '@/lib/types';

interface MessageListProps {
  messages: UIMessage[];
  onSend(content: string): void;
}

export function MessageList({ messages, onSend }: MessageListProps) {
  const streamContent = messages
    .map((m) => (m.parts ?? []).filter((p) => p.type === 'text').map((p) => p.text).join(''))
    .join('');
  const streamReasoning = messages
    .map((m) => (m.parts ?? []).filter((p) => p.type === 'reasoning').map((p) => p.text).join(''))
    .join('');
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
        <span>Hello, how can I help?</span>
        <div className="flex gap-2 flex-wrap justify-center max-w-md mt-2">
          {['Write some code', 'Explain a concept', 'Analyze data'].map((hint) => (
            <button
              key={hint}
              onClick={() => onSend(hint)}
              className="px-3 py-1.5 rounded-chip bg-card border border-bd2 text-xs text-tx2 hover:text-tx hover:border-ac/50 transition-colors"
            >
              {hint}
            </button>
          ))}
        </div>
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
