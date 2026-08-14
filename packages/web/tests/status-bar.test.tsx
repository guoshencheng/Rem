// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBar } from '@/components/status-bar';
import type { WorkbenchSession } from '@/types';

const session = {
  sessionId: 's1',
  title: '产品方案讨论',
  tenantId: 'local-web',
  updatedAt: Date.now(),
  messageCount: 0,
} satisfies WorkbenchSession;

describe('StatusBar', () => {
  it('显示 Session、运行状态与连接状态', () => {
    render(
      <StatusBar
        session={session}
        runningRuns={1}
        connection="connected"
      />,
    );

    expect(screen.getByText('会话：产品方案讨论')).toBeTruthy();
    expect(screen.getByText('1 个运行中')).toBeTruthy();
    expect(screen.getByText('Runtime 已连接')).toBeTruthy();
    expect(document.querySelector('[data-tone="success"]')).toBeTruthy();
  });

  it('重连时使用运行状态', () => {
    render(
      <StatusBar
        runningRuns={0}
        connection="reconnecting"
      />,
    );

    expect(screen.getByText('Runtime 重连中…')).toBeTruthy();
    expect(document.querySelector('[data-tone="running"]')).toBeTruthy();
  });
});
