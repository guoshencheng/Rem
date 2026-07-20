import { describe, it, expect } from 'vitest';
import { splitHeadTail } from '../../src/plugins/compressor/llm-summary/split.js';
import { buildSummaryPrompt } from '../../src/plugins/compressor/llm-summary/prompt.js';
import type { Message } from '@earendil-works/pi-ai';

function makeMsg(role: Message['role'], text: string): Message {
  return { role, content: [{ type: 'text', text }], timestamp: Date.now() };
}

describe('splitHeadTail', () => {
  it('splits messages into head, middle, tail', () => {
    const msgs = Array.from({ length: 30 }, (_, i) => makeMsg('user', `msg ${i}`));
    const { head, middle, tail } = splitHeadTail(msgs, 3, 20);
    expect(head).toHaveLength(3);
    expect(middle).toHaveLength(7);
    expect(tail).toHaveLength(20);
    expect(head[0].content).toEqual([{ type: 'text', text: 'msg 0' }]);
    expect(tail[19].content).toEqual([{ type: 'text', text: 'msg 29' }]);
  });

  it('returns all as head when too short', () => {
    const msgs = Array.from({ length: 5 }, (_, i) => makeMsg('user', `msg ${i}`));
    const { head, middle, tail } = splitHeadTail(msgs, 3, 20);
    expect(head).toHaveLength(5);
    expect(middle).toHaveLength(0);
    expect(tail).toHaveLength(0);
  });

  it('handles exact boundary', () => {
    const msgs = Array.from({ length: 23 }, (_, i) => makeMsg('user', `msg ${i}`));
    const { head, middle, tail } = splitHeadTail(msgs, 3, 20);
    expect(head).toHaveLength(3);
    expect(middle).toHaveLength(0);
    expect(tail).toHaveLength(20);
  });
});

describe('buildSummaryPrompt', () => {
  it('includes tool instruction and serialized messages', () => {
    const middle = [
      makeMsg('user', 'help me refactor'),
      makeMsg('assistant', 'sure, I will read the file'),
    ];
    const prompt = buildSummaryPrompt(middle);
    expect(prompt).toContain('submit_summary');
    expect(prompt).toContain('[User]: help me refactor');
    expect(prompt).toContain('[Assistant]: sure, I will read the file');
  });
});
