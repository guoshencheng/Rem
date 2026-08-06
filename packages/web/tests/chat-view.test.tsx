// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatView } from '@/components/chat-view';
import { useStreamStore } from '@/state/stream-store';

vi.mock('@/components/markdown-content', () => ({
  MarkdownContent: ({ text }: { text: string }) => <div data-testid="md">{text}</div>,
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe('ChatView', () => {
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
