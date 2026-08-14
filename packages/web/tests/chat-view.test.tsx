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
    useStreamStore.getState().setError('s1', '运行失败');
    render(<ChatView sessionId="s1" running={false} onSend={() => {}} />);
    expect(screen.getByRole('alert').textContent).toContain('运行失败');
  });

  it('渲染 Runtime 实时文本、折叠 reasoning 与工具状态', () => {
    useStreamStore.getState().reset();
    useStreamStore.getState().beginRuntimeRun('s1', 'run-1', '你好');
    const store = useStreamStore.getState();
    store.applyRuntimeSignal('s1', {
      runId: 'run-1', type: 'run.started', occurredAt: new Date(),
    });
    store.applyRuntimeSignal('s1', {
      runId: 'run-1', type: 'assistant.message.started',
      data: { messageIndex: 0 }, occurredAt: new Date(),
    });
    store.applyRuntimeSignal('s1', {
      runId: 'run-1', type: 'assistant.text.delta',
      data: { messageIndex: 0, contentIndex: 0, delta: '实时回复' }, occurredAt: new Date(),
    });
    store.applyRuntimeSignal('s1', {
      runId: 'run-1', type: 'assistant.reasoning.delta',
      data: { messageIndex: 0, contentIndex: 1, delta: '内部推理' }, occurredAt: new Date(),
    });
    store.applyRuntimeSignal('s1', {
      runId: 'run-1', type: 'tool.execution.started',
      data: { toolCallId: 'call-1', toolName: 'search', input: { q: 'rem' } }, occurredAt: new Date(),
    });
    render(<ChatView sessionId="s1" running onSend={() => {}} />);
    expect(screen.getByText('你好')).toBeTruthy();
    expect(screen.getByTestId('md').textContent).toContain('实时回复');
    expect(screen.getByRole('button', { name: /思考/ })).toBeTruthy();
    expect(screen.getByText('search')).toBeTruthy();
    expect(screen.getByText('▍')).toBeTruthy();
  });
});
