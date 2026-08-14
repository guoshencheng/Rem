import { describe, expect, it } from 'vitest';
import type { RunSignal } from 'rem-agent-core';
import {
  applyRuntimeRunSignal,
  createRuntimeRunProjection,
} from '@/state/runtime-stream-projection';

const signal = (type: string, data?: unknown): RunSignal => ({
  runId: 'run-1', type, data, occurredAt: new Date('2026-01-01T00:00:00Z'),
});

describe('RuntimeRunProjection', () => {
  it('按 message/content 索引累积文本与 reasoning，并处理生命周期', () => {
    let state = createRuntimeRunProjection('run-1');
    state = applyRuntimeRunSignal(state, signal('run.started'));
    state = applyRuntimeRunSignal(state, signal('assistant.message.started', { messageIndex: 0 }));
    state = applyRuntimeRunSignal(state, signal('assistant.text.delta', {
      messageIndex: 0, contentIndex: 0, delta: '你好',
    }));
    state = applyRuntimeRunSignal(state, signal('assistant.reasoning.delta', {
      messageIndex: 0, contentIndex: 1, delta: '思考中',
    }));
    state = applyRuntimeRunSignal(state, signal('assistant.text.delta', {
      messageIndex: 0, contentIndex: 0, delta: '，世界',
    }));
    state = applyRuntimeRunSignal(state, signal('run.completed'));

    expect(state.status).toBe('completed');
    expect(state.messages[0]?.parts).toEqual([
      { type: 'text', text: '你好，世界' },
      { type: 'thinking', thinking: '思考中' },
    ]);
  });

  it('隔离工具输入/结果并维护工具状态', () => {
    let state = createRuntimeRunProjection('run-1');
    const input = { path: 'README.md', nested: { ok: true } };
    state = applyRuntimeRunSignal(state, signal('tool.execution.started', {
      toolCallId: 'call-1', toolName: 'read', input,
    }));
    state = applyRuntimeRunSignal(state, signal('tool.execution.updated', {
      toolCallId: 'call-1', toolName: 'read', input, partialResult: { bytes: 4 },
    }));
    input.nested.ok = false;
    state = applyRuntimeRunSignal(state, signal('tool.execution.completed', {
      toolCallId: 'call-1', toolName: 'read',
      result: { output: '内容', details: { lines: 2 } }, isError: false,
    }));

    expect(state.activeTools['call-1']).toMatchObject({ status: 'completed', toolName: 'read' });
    expect(state.activeTools['call-1']?.input).toEqual({ path: 'README.md', nested: { ok: true } });
    expect(state.toolResults['call-1']).toEqual({ output: '内容', details: { lines: 2 } });
    expect(state.messages[0]?.parts[0]).toMatchObject({ type: 'toolCall', id: 'call-1' });
  });

  it('未知未来事件只推进已知生命周期，不污染投影', () => {
    const state = applyRuntimeRunSignal(
      createRuntimeRunProjection('run-1'),
      signal('assistant.audio.delta', { delta: 'ignored' }),
    );
    expect(state.messages).toEqual([]);
    expect(state.status).toBe('queued');
  });
});
