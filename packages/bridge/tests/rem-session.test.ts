import { describe, expect, it, vi } from 'vitest';
import type { BusEvent, REMAgent } from 'rem-agent-core';
import type { REMAgentEvent } from 'rem-agent-core';
import { REMSession } from '../src/rem-session.js';

function createSession(): { s: REMSession; events: BusEvent[] } {
  const events: BusEvent[] = [];
  const s = new REMSession({ sessionId: 's-1', workspace: 'default', publish: (e) => events.push(e) });
  return { s, events };
}

describe('REMSession', () => {
  it('同一 session 只创建一个 root Agent，child Agent 单独计数', () => {
    const { s } = createSession();
    const root = { interrupt: vi.fn() } as unknown as REMAgent;
    const otherRoot = { interrupt: vi.fn() } as unknown as REMAgent;
    const child = {} as REMAgent;
    const createRoot = vi.fn(() => root);

    expect(s.getOrCreateRootAgent(createRoot)).toBe(root);
    expect(s.getOrCreateRootAgent(() => otherRoot)).toBe(root);
    expect(createRoot).toHaveBeenCalledTimes(1);

    s.addChildAgent(child);
    expect(s.rootAgent).toBe(root);
    expect(s.childAgentCount).toBe(1);
  });

  it('interruptRun 同时中止本轮 controller 和 root Agent', () => {
    const { s } = createSession();
    const interrupt = vi.fn();
    s.getOrCreateRootAgent(() => ({ interrupt }) as unknown as REMAgent);
    const controller = s.startRun();

    s.interruptRun();

    expect(controller.signal.aborted).toBe(true);
    expect(interrupt).toHaveBeenCalledTimes(1);
  });

  it('startRun 置 running 并发 session-start / activity-change', () => {
    const { s, events } = createSession();
    const controller = s.startRun();
    expect(s.status).toBe('running');
    expect(controller).toBeInstanceOf(AbortController);
    expect(events.map((e) => e.type)).toEqual(['session-start', 'activity-change']);
  });

  it('running 中重复 startRun 抛错', () => {
    const { s } = createSession();
    s.startRun();
    expect(() => s.startRun()).toThrow('already running');
  });

  it('finishRun 发 session-end 并复位状态（幂等）', () => {
    const { s, events } = createSession();
    s.startRun();
    s.finishRun();
    s.finishRun();
    expect(s.status).toBe('idle');
    expect(s.runController).toBeUndefined();
    expect(events.filter((e) => e.type === 'session-end')).toHaveLength(1);
  });

  it('finishRun(error) 发 session-error 并置 error', () => {
    const { s, events } = createSession();
    s.startRun();
    s.finishRun('boom');
    expect(s.status).toBe('error');
    expect(events.some((e) => e.type === 'session-error' && e.error === 'boom')).toBe(true);
  });

  it('applyEvent: turn_start → activity pending 并返回 activity-change', () => {
    const { s } = createSession();
    s.startRun();
    const out = s.applyEvent('root', { type: 'turn_start' } as unknown as REMAgentEvent);
    // startRun 已置 pending，turn_start 不变 → 无新事件
    expect(out).toEqual([]);
    const out2 = s.applyEvent('root', {
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 't', partial: {} },
    } as unknown as REMAgentEvent);
    expect(s.activity).toBe('thinking');
    expect(out2).toEqual([{ workspace: 'default', sessionId: 's-1', type: 'activity-change', activity: 'thinking' }]);
  });

  it('applyEvent: assistant message_start 建 snapshot，message_update 追加 parts', () => {
    const { s } = createSession();
    s.startRun();
    s.applyEvent('root', { type: 'message_start', message: { role: 'assistant' } } as unknown as REMAgentEvent);
    expect(s.streamingSnapshot).toBeTruthy();
    s.applyEvent('root', {
      type: 'message_update',
      assistantMessageEvent: {
        type: 'text_delta', contentIndex: 0, delta: 'hi',
        partial: { content: [{ type: 'text', text: 'hi' }] },
      },
    } as unknown as REMAgentEvent);
    expect(s.getSnapshotParts().length).toBeGreaterThan(0);
  });

  it('addTokenUsage 累计；restoreTokenUsage 从历史恢复', () => {
    const { s } = createSession();
    s.addTokenUsage({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
    expect(s.tokenUsage.totalTokens).toBe(2);
    const { s: s2 } = createSession();
    s2.restoreTokenUsage([
      { input: 5, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, runAt: new Date(), turns: [] },
    ]);
    expect(s2.tokenUsage.totalTokens).toBe(10);
  });
});
