// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThreadPanel } from '@/components/thread-panel';
import { useStreamStore } from '@/state/stream-store';
import type { AgentThread } from 'rem-agent-core';

vi.mock('@/components/markdown-content', () => ({
  MarkdownContent: ({ text }: { text: string }) => <div data-testid="md">{text}</div>,
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const thread = (id: string, agentId: string, role: AgentThread['role']): AgentThread => ({
  agentThreadId: id, sessionId: 's1', agentId, role,
  lifecycle: 'persistent', createdAt: new Date(), updatedAt: new Date(),
});

describe('ThreadPanel', () => {
  it('threads 为空时不渲染', () => {
    useStreamStore.getState().reset();
    const { container } = render(<ThreadPanel sessionId="s1" />);
    expect(container.firstChild).toBeNull();
  });

  it('默认选中第一个 thread 并渲染其消息', () => {
    useStreamStore.getState().reset();
    useStreamStore.getState().setThreads('s1', [
      thread('th1', 'organizer', 'organizer'),
      thread('th2', 'researcher', 'member'),
    ]);
    useStreamStore.getState().setThreadMessages({ sessionId: 's1', threadId: 'th1' }, [
      { role: 'user', content: '拆解任务', timestamp: Date.now() } as never,
    ]);
    render(<ThreadPanel sessionId="s1" />);
    expect(screen.getByText('拆解任务')).toBeTruthy();
    expect(screen.getByText('researcher')).toBeTruthy();
  });
});
