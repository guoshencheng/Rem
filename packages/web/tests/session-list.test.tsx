// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SessionList } from '@/components/session-list';
import type { WorkbenchSession } from '@/types';

function session(
  sessionId: string,
  title: string,
  activity: WorkbenchSession['activity'] = 'idle',
): WorkbenchSession {
  return {
    sessionId,
    title,
    activity,
    tenantId: 'local-web',
    updatedAt: Date.now(),
    messageCount: 12,
  };
}

describe('SessionList', () => {
  it('渲染紧凑 Session 行与选中态', () => {
    const onSelect = vi.fn();
    render(
      <SessionList
        sessions={[
          session('single', '单 Agent 会话'),
          session('multi', '多 Agent 会话', 'running'),
        ]}
        currentId="multi"
        onSelect={onSelect}
      />,
    );

    const selected = screen.getByRole('button', { name: /多 Agent 会话/ });
    expect(selected.getAttribute('data-selected')).toBe('true');
    expect(screen.getByText('空闲')).toBeTruthy();
    expect(document.querySelector('[data-tone="running"]')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /单 Agent 会话/ }));
    expect(onSelect).toHaveBeenCalledWith('single');
  });

  it('没有 Session 时显示统一空态', () => {
    render(<SessionList sessions={[]} onSelect={vi.fn()} />);
    expect(screen.getByText('还没有 Session')).toBeTruthy();
    expect(screen.getByText('从右上角新建一个会话')).toBeTruthy();
  });
});
