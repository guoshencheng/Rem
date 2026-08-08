import type { ComponentProps } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

function InputGroup({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        'group/input-group relative flex w-full items-center rounded-lg border border-input bg-panel shadow-xs outline-none transition-[color,box-shadow] has-[>textarea]:h-auto has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-[3px] has-[[data-slot=input-group-control]:focus-visible]:ring-ring/50 has-[>[data-align=block-end]]:flex-col',
        className,
      )}
      {...props}
    />
  );
}

function InputGroupAddon({
  className,
  align = 'block-end',
  ...props
}: ComponentProps<'div'> & { align?: 'block-end' }) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(
        'order-last flex w-full items-center justify-between gap-[var(--ds-space-actions)] px-[var(--ds-space-card)] pb-[var(--ds-space-card)] text-label text-muted-foreground',
        className,
      )}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('button')) return;
        event.currentTarget.parentElement?.querySelector('textarea')?.focus();
      }}
      {...props}
    />
  );
}

function InputGroupTextarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <Textarea
      data-slot="input-group-control"
      className={cn(
        'min-h-[38px] flex-1 resize-none rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0',
        className,
      )}
      {...props}
    />
  );
}

export { InputGroup, InputGroupAddon, InputGroupTextarea };
