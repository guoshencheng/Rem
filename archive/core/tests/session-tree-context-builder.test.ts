import { describe, it, expect } from 'vitest';
import type { Message } from '@earendil-works/pi-ai';
import { buildConversationFromEntries } from '../src/session-tree/context-builder.js';
import type { SessionTreeEntry } from '../src/session-tree/types.js';

const msg = (text: string): Message => ({ role: 'user', content: text, timestamp: 1 });
const entry = (id: string, parentId: string | null, text: string): SessionTreeEntry => ({
  id, sessionId: 's1', parentId, type: 'message',
  payload: { message: msg(text), messageId: id }, timestamp: 1,
});

describe('buildConversationFromEntries', () => {
  it('walks leaf to root and returns messages in order', () => {
    const entries = [entry('a', null, 'first'), entry('b', 'a', 'second'), entry('c', 'b', 'third')];
    const result = buildConversationFromEntries(entries, 'c');
    expect(result.map((m) => m.content)).toEqual(['first', 'second', 'third']);
  });

  it('returns empty array when leafId is null', () => {
    expect(buildConversationFromEntries([entry('a', null, 'x')], null)).toEqual([]);
  });

  it('ignores orphan branches not on the leaf path', () => {
    const entries = [entry('a', null, 'main'), entry('b', 'a', 'main2'), entry('x', 'a', 'orphan')];
    const result = buildConversationFromEntries(entries, 'b');
    expect(result.map((m) => m.content)).toEqual(['main', 'main2']);
  });

  it('skips non-message entries on the path', () => {
    const label: SessionTreeEntry = { id: 'l', sessionId: 's1', parentId: 'a', type: 'label', payload: { label: 'x' }, timestamp: 1 };
    const entries = [entry('a', null, 'main'), label];
    expect(buildConversationFromEntries(entries, 'l').map((m) => m.content)).toEqual(['main']);
  });
});
