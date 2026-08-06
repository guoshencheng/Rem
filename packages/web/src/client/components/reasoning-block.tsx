import { useState } from 'react';
import { ChevronRight, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ReasoningBlockProps {
  text: string;
}

export function ReasoningBlock({ text }: ReasoningBlockProps) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-md bg-accent/50 px-3 py-1.5 text-left text-xs font-medium text-accent-foreground transition-colors hover:bg-accent"
      >
        <ChevronRight size={12} className={cn('shrink-0 transition-transform', open && 'rotate-90')} />
        <Sparkles size={12} className="shrink-0" />
        <span>思考</span>
      </button>
      {open && (
        <div className="mx-2 mt-1.5 max-h-48 overflow-y-auto rounded-md border border-border bg-card px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {text}
        </div>
      )}
    </div>
  );
}
