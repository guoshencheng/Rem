import { describe, it, expect } from 'vitest';
import { toPiMessage, fromPiMessage, toPiTool, toLegacyProviderChunks } from '../../src/pi-adapter.js';

describe('toPiMessage / fromPiMessage round-trip', () => {
  it('round-trips user message', () => {
    const rem: import('../../src/types.js').ModelMessage = { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hello' }] };
    const pi = toPiMessage(rem);
    expect(pi.role).toBe('user');
    const back = fromPiMessage(pi, 'u1');
    expect(back).toEqual(rem);
  });

  it('round-trips assistant message with text and tool-call', () => {
    const rem: import('../../src/types.js').ModelMessage = {
      id: 'a1', role: 'assistant',
      content: [
        { type: 'text', text: 'ok' },
        { type: 'tool-call', toolCallId: 'c1', toolName: 'echo', arguments: { x: 1 } },
      ],
    };
    const pi = toPiMessage(rem);
    expect(pi.role).toBe('assistant');
    expect(pi.content).toHaveLength(2);
    const back = fromPiMessage(pi, 'a1');
    expect(back).toEqual(rem);
  });
});

describe('toLegacyProviderChunks', () => {
  it('yields text-delta', () => {
    const chunks = [...toLegacyProviderChunks({ type: 'text_delta', contentIndex: 0, delta: 'hi', partial: {} as any })];
    expect(chunks).toEqual([{ type: 'text-delta', step: 0, text: 'hi' }]);
  });

  it('yields tool-call on toolcall_end', () => {
    const chunks = [
      ...toLegacyProviderChunks({
        type: 'toolcall_end',
        contentIndex: 0,
        toolCall: { type: 'toolCall', id: 'c1', name: 'echo', arguments: { x: 1 } },
        partial: {} as any,
      }),
    ];
    expect(chunks).toEqual([{ type: 'tool-call', step: 0, toolCallId: 'c1', toolName: 'echo', input: { x: 1 } }]);
  });
});

describe('toPiTool', () => {
  it('converts ToolSchema to pi-ai Tool', () => {
    const tool = toPiTool('echo', { description: 'echo tool', parameters: { type: 'object' } });
    expect(tool.name).toBe('echo');
    expect(tool.description).toBe('echo tool');
  });
});
