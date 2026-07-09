'use client';

import { useRef, useEffect } from 'react';
import { MessageItem } from './message-item';
import type { UIMessage } from '@/lib/types';

interface MessageListProps {
  messages: UIMessage[];
  onSend(content: string): void;
}

export function MessageList({ messages, onSend }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastMessage = messages[messages.length - 1];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, lastMessage?.status, lastMessage?.parts?.length]);

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
    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin pb-6">
      <div className="max-w-3xl mx-auto px-4">
        {messages.map((msg, index) => (
          <MessageItem key={msg.id ?? index} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
