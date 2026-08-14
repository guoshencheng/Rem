import type { ReactNode } from 'react';
import { useMediaQuery } from '@/hooks/use-media-query';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

interface WorkbenchShellProps {
  topBar: ReactNode;
  sessionPanel: ReactNode;
  inspector?: ReactNode;
  statusBar: ReactNode;
  children: ReactNode;
  sessionOpen?: boolean;
  onSessionOpenChange?: (open: boolean) => void;
  inspectorOpen?: boolean;
  onInspectorOpenChange?: (open: boolean) => void;
}

export function WorkbenchShell({
  topBar,
  sessionPanel,
  inspector,
  statusBar,
  children,
  sessionOpen = false,
  onSessionOpenChange,
  inspectorOpen = false,
  onInspectorOpenChange,
}: WorkbenchShellProps) {
  const desktop = useMediaQuery('(min-width: 900px)');

  return (
    <div className="grid h-full min-h-0 grid-rows-[var(--ds-topbar-height)_1fr_var(--ds-statusbar-height)] overflow-hidden bg-background">
      {topBar}
      {desktop ? (
        <div
          data-testid="workbench-body"
          data-layout="desktop"
          className={cn(
            'grid min-h-0',
            inspector
              ? 'grid-cols-[var(--ds-left-panel-width)_minmax(var(--ds-stage-min-width),1fr)_var(--ds-right-panel-width)]'
              : 'grid-cols-[var(--ds-left-panel-width)_minmax(var(--ds-stage-min-width),1fr)]',
          )}
        >
          <aside className="min-h-0 overflow-hidden border-r border-border bg-panel">
            {sessionPanel}
          </aside>
          <main className="min-h-0 min-w-0 bg-surface">{children}</main>
          {inspector && (
            <aside className="min-h-0 overflow-hidden border-l border-border bg-panel">
              {inspector}
            </aside>
          )}
        </div>
      ) : (
        <div data-testid="workbench-body" data-layout="compact" className="min-h-0 min-w-0 bg-surface">
          {children}
        </div>
      )}
      {statusBar}

      {!desktop && (
        <>
          <Sheet open={sessionOpen} onOpenChange={onSessionOpenChange}>
            <SheetContent side="left">
              <SheetHeader className="sr-only">
                <SheetTitle>Sessions</SheetTitle>
              </SheetHeader>
              {sessionPanel}
            </SheetContent>
          </Sheet>
          {inspector && (
            <Sheet open={inspectorOpen} onOpenChange={onInspectorOpenChange}>
              <SheetContent side="right">
                <SheetHeader className="sr-only">
                  <SheetTitle>执行检查器</SheetTitle>
                </SheetHeader>
                {inspector}
              </SheetContent>
            </Sheet>
          )}
        </>
      )}
    </div>
  );
}
