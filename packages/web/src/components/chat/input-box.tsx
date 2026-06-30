'use client';

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { Send, Square } from 'lucide-react';

interface InputBoxProps {
  streaming: boolean;
  initialized: boolean;
  onSend(content: string): void;
  onInterrupt(): void;
}

export function InputBox({ streaming, initialized, onSend, onInterrupt }: InputBoxProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || streaming || !initialized) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [text]);

  const placeholder = !initialized ? 'Connecting...' : 'Type a message...';

  return (
    <div className="border-t border-bd px-4 py-3 bg-bg">
      <div className="flex items-end gap-2 max-w-3xl mx-auto">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={streaming || !initialized}
          className="flex-1 resize-none rounded-btn bg-card border border-bd2 text-tx placeholder-tx3 px-4 py-2.5 text-sm outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ maxHeight: '160px' }}
        />
        {streaming ? (
          <button
            onClick={onInterrupt}
            className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-btn bg-err text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Square size={14} fill="currentColor" />
            Stop
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim() || !initialized}
            className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-btn bg-ac text-ac-ink text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send size={14} />
            Send
          </button>
        )}
      </div>
    </div>
  );
}
