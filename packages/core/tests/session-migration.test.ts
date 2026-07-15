import { describe, it, expect } from 'vitest';
import { migrateConversationToPiAi } from '../src/pi-adapter.js';

describe('migrateConversationToPiAi', () => {
  it('migrates user and assistant messages', () => {
    const legacy = [
      { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ];
    const { messages, messageIds } = migrateConversationToPiAi(legacy as any);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect(messageIds.get('u1')).toBeDefined();
    expect(messageIds.get('a1')).toBeDefined();
  });

  it('skips system messages', () => {
    const legacy = [
      { id: 's1', role: 'system', content: [{ type: 'text', text: 'sys' }] },
      { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ];
    const { messages, messageIds } = migrateConversationToPiAi(legacy as any);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messageIds.has('s1')).toBe(false);
  });
});
