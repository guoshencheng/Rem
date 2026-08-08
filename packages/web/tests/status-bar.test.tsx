// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBar } from '@/components/status-bar';
import type { SessionInfo } from 'rem-agent-core';

const session = {
  sessionId: 's1',
  title: '产品方案讨论',
  mode: 'multi-agent',
} as SessionInfo;

describe('StatusBar', () => {
  it('显示 Session、Thread 与连接状态', () => {
    render(
      <StatusBar
        session={session}
        threadCount={3}
        runningThreads={1}
        connection="connected"
      />,
    );

    expect(screen.getByText('会话：产品方案讨论')).toBeTruthy();
    expect(screen.getByText('Threads：3 · 1 运行中')).toBeTruthy();
    expect(screen.getByText('SSE 已连接')).toBeTruthy();
    expect(document.querySelector('[data-tone="success"]')).toBeTruthy();
  });

  it('重连时使用运行状态', () => {
    render(
      <StatusBar
        threadCount={0}
        runningThreads={0}
        connection="reconnecting"
      />,
    );

    expect(screen.getByText('SSE 重连中…')).toBeTruthy();
    expect(document.querySelector('[data-tone="running"]')).toBeTruthy();
  });
});
