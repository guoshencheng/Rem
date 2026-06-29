'use client';

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { Send, Square } from 'lucide-react';
import { useSessionStore } from '@/lib/session-store';

export function InputBox() {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streaming = useSessionStore((s) => s.streaming);
  const initialized = useSessionStore((s) => s.initialized);
  const serverError = useSessionStore((s) => s.serverError);
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const interrupt = useSessionStore((s) => s.interrupt);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || streaming || !initialized) return;
    sendMessage(trimmed);
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

  const placeholder = serverError
    ? '服务异常，请稍后重试'
    : !initialized
      ? '连接中...'
      : '输入消息...';

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
          disabled={streaming || serverError || !initialized}
          className="flex-1 resize-none rounded-btn bg-card border border-bd2 text-tx placeholder-tx3 px-4 py-2.5 text-sm outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ maxHeight: '160px' }}
        />{streaming ? (
          <button
            onClick={interrupt}
            className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-btn bg-err text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Square size={14} fill="currentColor" />
            中断
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim() || serverError || !initialized}
            className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-btn bg-ac text-ac-ink text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send size={14} />
            发送
          </button>
        )}
      </div>
    </div>
  );
}
