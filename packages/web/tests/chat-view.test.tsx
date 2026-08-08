// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ChatView } from '@/components/chat-view';
import { useStreamStore } from '@/state/stream-store';

vi.mock('@/components/markdown-content', () => ({
  MarkdownContent: ({ text }: { text: string }) => <div data-testid="md">{text}</div>,
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

describe('ChatView', () => {
  it('没有消息时显示公开会话空态', () => {
    useStreamStore.getState().reset();
    render(<ChatView sessionId="empty" running={false} onSend={() => {}} />);
    expect(screen.getByText('开始一段公开会话')).toBeTruthy();
    expect(screen.getByText('消息会显示在这里')).toBeTruthy();
  });

  it('在消息上下文内显示 Session 错误', () => {
    useStreamStore.getState().reset();
    useStreamStore.getState().applyEvent({
      workspace: '/w',
      sessionId: 's1',
      type: 'session-error',
      error: '运行失败',
    });
    render(<ChatView sessionId="s1" running={false} onSend={() => {}} />);
    expect(screen.getByRole('alert').textContent).toContain('运行失败');
  });

  it('渲染中心流消息与 streaming 增量', () => {
    useStreamStore.getState().reset();
    useStreamStore.getState().setChat('s1', [
      {
        messageId: 'm1',
        message: { role: 'user', content: '你好', timestamp: Date.now() } as never,
      },
    ]);
    useStreamStore.getState().setThreads('s1', [
      {
        agentThreadId: 'th1', sessionId: 's1', agentId: 'default',
        role: 'primary', lifecycle: 'persistent',
        createdAt: new Date(), updatedAt: new Date(),
      },
    ]);
    useStreamStore.getState().applyEvent({
      workspace: '/w', sessionId: 's1', type: 'chunk', agentThreadId: 'th1',
      chunk: {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '回复中' },
      } as never,
    });
    render(<ChatView sessionId="s1" running={false} onSend={() => {}} />);
    expect(screen.getByText('你好')).toBeTruthy();
    expect(screen.getByTestId('md').textContent).toContain('回复中');
  });
});
