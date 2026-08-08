// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SessionList } from '@/components/session-list';
import type { SessionInfo } from 'rem-agent-core';

function session(
  sessionId: string,
  title: string,
  mode: SessionInfo['mode'],
  activity: SessionInfo['activity'] = 'idle',
): SessionInfo {
  return {
    sessionId,
    title,
    mode,
    activity,
    workspace: '/workspace',
    updatedAt: Date.now(),
    messageCount: 12,
  };
}

describe('SessionList', () => {
  it('渲染紧凑 Session 行、模式与选中态', () => {
    const onSelect = vi.fn();
    render(
      <SessionList
        sessions={[
          session('single', '单 Agent 会话', 'single'),
          session('multi', '多 Agent 会话', 'multi-agent', 'thinking'),
        ]}
        currentId="multi"
        onSelect={onSelect}
      />,
    );

    const selected = screen.getByRole('button', { name: /多 Agent 会话/ });
    expect(selected.getAttribute('data-selected')).toBe('true');
    expect(screen.getByText('多 Agent')).toBeTruthy();
    expect(screen.getByText('单 Agent')).toBeTruthy();
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
