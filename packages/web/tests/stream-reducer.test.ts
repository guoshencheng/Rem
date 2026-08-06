import { describe, expect, it } from 'vitest';
import { reduceStreamEvent, type ContentBlock } from '@/state/stream-reducer';

describe('reduceStreamEvent', () => {
  it('text_start + text_delta 累积文本', () => {
    let parts: ContentBlock[] = [];
    parts = reduceStreamEvent(parts, { type: 'text_start', contentIndex: 0 } as never);
    parts = reduceStreamEvent(parts, { type: 'text_delta', contentIndex: 0, delta: 'he' } as never);
    parts = reduceStreamEvent(parts, { type: 'text_delta', contentIndex: 0, delta: 'llo' } as never);
    expect(parts).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('thinking_delta 累积思考内容', () => {
    let parts: ContentBlock[] = [];
    parts = reduceStreamEvent(parts, { type: 'thinking_start', contentIndex: 1 } as never);
    parts = reduceStreamEvent(parts, { type: 'thinking_delta', contentIndex: 1, delta: 'hmm' } as never);
    expect(parts[1]).toEqual({ type: 'thinking', thinking: 'hmm' });
  });

  it('toolcall_end 落定完整 ToolCall', () => {
    const toolCall = { type: 'toolCall', id: 't1', name: 'bash', arguments: { cmd: 'ls' } } as const;
    const parts = reduceStreamEvent([], { type: 'toolcall_end', contentIndex: 0, toolCall: toolCall as never } as never);
    expect(parts[0]).toMatchObject({ type: 'toolCall', id: 't1' });
  });
});
