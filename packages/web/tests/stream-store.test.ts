import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentSystemEvent } from 'rem-agent-core';
import { useStreamStore } from '@/state/stream-store';

beforeEach(() => useStreamStore.getState().reset());

const chunk = (over: Record<string, unknown>): AgentSystemEvent => ({
  workspace: '/w', sessionId: 's1', type: 'chunk', agentThreadId: 'th1', ...over,
}) as AgentSystemEvent;

describe('stream-store', () => {
  it('message_update chunk 归并到对应 thread 的 streaming', () => {
    const store = useStreamStore.getState();
    store.applyEvent(chunk({
      chunk: {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'hi' },
      },
    }));
    const streaming = useStreamStore.getState().bySession.s1?.streaming.th1;
    expect(streaming).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('message_end 清空 streaming 并 bump version', () => {
    const store = useStreamStore.getState();
    store.applyEvent(chunk({
      chunk: {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'hi' },
      },
    }));
    store.applyEvent(chunk({ chunk: { type: 'message_end' } }));
    const state = useStreamStore.getState().bySession.s1;
    expect(state.streaming.th1).toBeUndefined();
    expect(state.threadVersions.th1).toBe(1);
    expect(state.chatVersion).toBe(1);
  });

  it('activity-change 更新 session 列表中的 activity', () => {
    const store = useStreamStore.getState();
    store.setSessions([{
      sessionId: 's1', workspace: '/w', updatedAt: 1, messageCount: 0, mode: 'single',
    }]);
    store.applyEvent({
      workspace: '/w', sessionId: 's1', type: 'activity-change', activity: 'thinking',
    });
    expect(useStreamStore.getState().sessions[0].activity).toBe('thinking');
  });

  it('session-error 记录到 session 级 error', () => {
    useStreamStore.getState().applyEvent({
      workspace: '/w', sessionId: 's1', type: 'session-error', error: 'boom',
    });
    expect(useStreamStore.getState().bySession.s1.error).toBe('boom');
  });
});
