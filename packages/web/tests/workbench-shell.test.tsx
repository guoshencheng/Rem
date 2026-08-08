// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkbenchShell } from '@/components/workbench-shell';
import { useMediaQuery } from '@/hooks/use-media-query';

vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: vi.fn() }));

afterEach(cleanup);

const content = {
  topBar: <div>top</div>,
  sessionPanel: <div>sessions</div>,
  inspector: <div>threads</div>,
  statusBar: <div>status</div>,
  children: <div>chat</div>,
};

describe('WorkbenchShell', () => {
  it('桌面渲染三栏工作台', () => {
    vi.mocked(useMediaQuery).mockReturnValue(true);
    render(<WorkbenchShell {...content} />);

    expect(screen.getByTestId('workbench-body').getAttribute('data-layout')).toBe('desktop');
    expect(screen.getByText('sessions')).toBeTruthy();
    expect(screen.getByText('chat')).toBeTruthy();
    expect(screen.getByText('threads')).toBeTruthy();
  });

  it('窄屏按受控状态显示 Session 抽屉', () => {
    vi.mocked(useMediaQuery).mockReturnValue(false);
    render(
      <WorkbenchShell
        {...content}
        sessionOpen
        onSessionOpenChange={vi.fn()}
        inspectorOpen={false}
        onInspectorOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId('workbench-body').getAttribute('data-layout')).toBe('compact');
    expect(screen.getByRole('dialog', { name: 'Sessions' })).toBeTruthy();
    expect(screen.getByText('sessions')).toBeTruthy();
    expect(screen.queryByText('threads')).toBeNull();
  });
});
