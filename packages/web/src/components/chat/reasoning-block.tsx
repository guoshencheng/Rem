'use client';

import { useState, useEffect } from 'react';
import { ChevronRight, Sparkles, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ReasoningBlockProps {
  text: string;
  isStreaming: boolean;
}

export function ReasoningBlock({ text, isStreaming }: ReasoningBlockProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (isStreaming && text.length > 0) {
      setOpen(true);
    }
  }, [isStreaming, text]);

  if (!text && !isStreaming) return null;

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-chip bg-ac-soft/50 text-ac text-xs font-medium hover:bg-ac-soft transition-colors w-full text-left"
      >
        <ChevronRight
          size={12}
          className={cn('transition-transform flex-shrink-0', open && 'rotate-90')}
        />
        <Sparkles size={12} className="flex-shrink-0" />
        <span>Thinking</span>
        {isStreaming && <Loader2 size={10} className="animate-spin ml-auto" />}
      </button>

      {open && (
        <div className="mt-1.5 mx-2 px-3 py-2 rounded-card bg-card2 border border-bd text-tx2 text-xs italic leading-relaxed max-h-48 overflow-y-auto">
          {text || (isStreaming ? '...' : '')}
        </div>
      )}
    </div>
  );
}
