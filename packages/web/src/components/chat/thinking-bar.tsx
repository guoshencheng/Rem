'use client';

import { Loader2, Clock } from 'lucide-react';

interface ThinkingBarProps {
  status: 'pending' | 'streaming';
}

export function ThinkingBar({ status }: ThinkingBarProps) {
  if (status === 'pending') {
    return (
      <div className="flex items-center gap-2 px-4 py-2 text-tx3 text-sm">
        <Clock size={14} />
        <span>Pending</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2 text-tx3 text-sm">
      <Loader2 size={14} className="animate-spin" />
      <span>Thinking</span>
      <span className="inline-flex gap-0.5">
        <span className="w-1 h-1 rounded-full bg-tx3 animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1 h-1 rounded-full bg-tx3 animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1 h-1 rounded-full bg-tx3 animate-bounce" style={{ animationDelay: '300ms' }} />
      </span>
    </div>
  );
}
