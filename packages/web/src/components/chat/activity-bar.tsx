'use client';

import { Loader2, Wrench, PenLine } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SessionActivity } from 'rem-agent-bridge';

interface ActivityBarProps {
  activity?: SessionActivity;
}

const config: Record<Exclude<SessionActivity, 'idle'>, { label: string; icon: React.ReactNode; color: string }> = {
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
};

export function ActivityBar({ activity }: ActivityBarProps) {
  if (!activity || activity === 'idle') return null;
  const { label, icon, color } = config[activity];
  return (
    <div className={cn('flex items-center gap-2 px-1 py-2 text-xs', color)}>
      {icon}
      <span>{label}</span>
    </div>
  );
}
