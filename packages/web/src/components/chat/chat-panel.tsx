'use client';

import { MessageList } from './message-list';
import { InputBox } from './input-box';
import { ActivityBar } from './activity-bar';
import type { UIMessage, SessionActivity } from '@/lib/types';

export type SessionStatus = 'idle' | 'loading' | 'streaming' | 'done' | 'error';

interface ChatPanelProps {
  messages: UIMessage[];
  status: SessionStatus;
  error: string | null;
  activity?: SessionActivity;
  initialized: boolean;
  onSend(content: string): void;
  onInterrupt(): void;
}

export function ChatPanel({ messages, status, error, activity, initialized, onSend, onInterrupt }: ChatPanelProps) {
  const streaming = status === 'streaming' || status === 'loading';

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <header className="flex items-center gap-3 px-4 h-12 border-b border-bd flex-shrink-0">
        <span className="text-sm font-medium text-tx truncate flex-1">Rem Agent</span>
        {error && (
          <span className="text-xs text-err bg-err-bg px-2 py-0.5 rounded-chip">{error}</span>
        )}
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4">
          <MessageList messages={messages} onSend={onSend} />
        </div>
      </div>
      <div className="max-w-3xl mx-auto w-full px-4 pb-4">
        <ActivityBar activity={activity} />
        <InputBox
          streaming={streaming}
          initialized={initialized}
          onSend={onSend}
          onInterrupt={onInterrupt}
        />
      </div>
    </div>
  );
}
