import { describe, it, expect } from 'vitest';
import { splitHeadTail } from '../../src/plugins/compressor/llm-summary/split.js';
import { buildSummaryPrompt } from '../../src/plugins/compressor/llm-summary/prompt.js';
import type { ModelMessage } from '../../src/types.js';

function makeMsg(id: string, role: ModelMessage['role'], text: string): ModelMessage {
  return { id, role, content: [{ type: 'text', text }] };
}

describe('splitHeadTail', () => {
  it('splits messages into head, middle, tail', () => {
    const msgs = Array.from({ length: 30 }, (_, i) => makeMsg(`m${i}`, 'user', `msg ${i}`));
    const { head, middle, tail } = splitHeadTail(msgs, 3, 20);
    expect(head).toHaveLength(3);
    expect(middle).toHaveLength(7);
    expect(tail).toHaveLength(20);
    expect(head[0].id).toBe('m0');
    expect(tail[19].id).toBe('m29');
  });

  it('returns all as head when too short', () => {
    const msgs = Array.from({ length: 5 }, (_, i) => makeMsg(`m${i}`, 'user', `msg ${i}`));
    const { head, middle, tail } = splitHeadTail(msgs, 3, 20);
    expect(head).toHaveLength(5);
    expect(middle).toHaveLength(0);
    expect(tail).toHaveLength(0);
  });

  it('handles exact boundary', () => {
    const msgs = Array.from({ length: 23 }, (_, i) => makeMsg(`m${i}`, 'user', `msg ${i}`));
    const { head, middle, tail } = splitHeadTail(msgs, 3, 20);
    expect(head).toHaveLength(3);
    expect(middle).toHaveLength(0);
    expect(tail).toHaveLength(20);
  });
});

describe('buildSummaryPrompt', () => {
  it('includes template and serialized messages', () => {
    const middle = [
      makeMsg('m1', 'user', 'help me refactor'),
      makeMsg('m2', 'assistant', 'sure, I will read the file'),
    ];
    const prompt = buildSummaryPrompt(middle);
    expect(prompt).toContain('## Objective');
    expect(prompt).toContain('[User]: help me refactor');
    expect(prompt).toContain('[Assistant]: sure, I will read the file');
  });
});
