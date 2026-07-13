'use client';

import { Loader2, Wrench, PenLine, Hourglass } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SessionActivity } from 'rem-agent-bridge';

interface ActivityBarProps {
  activity?: SessionActivity;
  showIdle?: boolean;
}

const config: Record<Exclude<SessionActivity, 'idle'>, { label: string; icon: React.ReactNode; color: string }> = {
  pending: {
    label: 'Pending...',
    icon: <Hourglass size={14} />,
    color: 'text-tx3',
  },
  thinking: {
    label: 'Thinking...',
    icon: <Loader2 size={14} className="animate-spin" />,
    color: 'text-ac',
  },
  'calling-function': {
    label: 'Calling function...',
    icon: <Wrench size={14} />,
    color: 'text-warn',
  },
  outputting: {
    label: 'Outputting...',
    icon: <PenLine size={14} />,
    color: 'text-success',
  },
  compressing: {
    label: 'Compressing context...',
    icon: <Loader2 size={14} className="animate-spin" />,
    color: 'text-ac',
  },
};

export function ActivityBar({ activity, showIdle }: ActivityBarProps) {
  if (!activity || activity === 'idle') {
    if (!showIdle) return null;
    return (
      <div className="flex items-center gap-2 px-1 py-2 text-xs text-tx3">
        <span className="inline-flex items-center justify-center w-3.5 h-3.5">●</span>
        <span>Idle</span>
      </div>
    );
  }

  const { label, icon, color } = config[activity];
  return (
    <div className={cn('flex items-center gap-2 px-1 py-2 text-xs', color)}>
      {icon}
      <span>{label}</span>
    </div>
  );
}
