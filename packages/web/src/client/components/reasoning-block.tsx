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
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-[var(--ds-control-sm-height)] w-full items-center gap-[var(--ds-space-row-gap)] rounded-md border border-selected-border bg-selected-bg px-[var(--ds-control-sm-padding-x)] text-left text-meta leading-control font-medium text-composite-text transition-colors hover:bg-accent [&_svg]:size-3"
      >
        <ChevronRight className={cn('shrink-0 transition-transform', open && 'rotate-90')} />
        <Sparkles className="shrink-0" />
        <span>思考</span>
      </button>
      {open && (
        <div className="mx-[var(--ds-space-inner)] mt-[var(--ds-space-tree)] max-h-48 overflow-y-auto rounded-md border border-border-subtle bg-surface p-[var(--ds-space-card)] text-meta leading-body text-muted-foreground">
          {text}
        </div>
      )}
    </div>
  );
}
