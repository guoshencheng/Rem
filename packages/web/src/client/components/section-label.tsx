import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function SectionLabel({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'text-label font-extrabold uppercase leading-control tracking-[0.12em] text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
