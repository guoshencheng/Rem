// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentThread, ToolCall } from 'rem-agent-core';
import { CollaborationInspector } from '@/components/collaboration-inspector';
import { ToolCallBlock } from '@/components/tool-call-block';
import { useStreamStore } from '@/state/stream-store';

vi.mock('@/components/markdown-content', () => ({
  MarkdownContent: ({ text }: { text: string }) => <div data-testid="md">{text}</div>,
}));

afterEach(() => {
  cleanup();
  useStreamStore.getState().reset();
});

const thread = (id: string, agentId: string, role: AgentThread['role']): AgentThread => ({
  agentThreadId: id,
  sessionId: 's1',
  agentId,
  role,
  lifecycle: 'persistent',
  createdAt: new Date(),
  updatedAt: new Date(),
});

const tool: ToolCall = {
  type: 'toolCall',
  id: 'call-1',
  name: 'read_thread_context',
  arguments: { threadId: 'th1' },
};

describe('CollaborationInspector', () => {
  it('受控选择 Thread 并渲染 Agent 身份与私有消息', () => {
    useStreamStore.getState().setThreads('s1', [
      thread('th1', 'organizer', 'organizer'),
      thread('th2', 'researcher', 'member'),
    ]);
    useStreamStore.getState().setThreadMessages({ sessionId: 's1', threadId: 'th1' }, [
      { role: 'user', content: '拆解任务', timestamp: Date.now() } as never,
    ]);
    const onChange = vi.fn();

    render(
      <CollaborationInspector
        sessionId="s1"
        selectedThreadId="th1"
        onSelectedThreadChange={onChange}
      />,
    );

    expect(screen.getByText('拆解任务')).toBeTruthy();
    expect(screen.getByText('organizer · th1')).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /researcher/ }), { button: 0 });
    expect(onChange).toHaveBeenCalledWith('th2');
  });

  it('没有 Thread 时显示统一空态', () => {
    render(
      <CollaborationInspector
        sessionId="s1"
        onSelectedThreadChange={vi.fn()}
      />,
    );
    expect(screen.getByText('没有协作 Thread')).toBeTruthy();
  });
});

describe('ToolCallBlock', () => {
  it.each([
    [undefined, 'running'],
    [{ output: '读取完成' }, 'success'],
    [{ error: '读取失败' }, 'error'],
  ] as const)('以语义状态呈现工具调用', (result, tone) => {
    render(<ToolCallBlock tool={tool} result={result} />);
    expect(screen.getByRole('button').getAttribute('data-tone')).toBe(tone);
    expect(document.querySelector(`[data-tone="${tone}"]`)).toBeTruthy();
    cleanup();
  });
});
