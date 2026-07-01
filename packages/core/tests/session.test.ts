import { describe, it, expect } from 'vitest';
import { InMemorySessionProvider } from '../src/plugins/session/in-memory/index.js';
import type { ModelMessage } from '../src/types.js';

describe('InMemorySessionProvider', () => {
  it('should create a new session', async () => {
    const provider = new InMemorySessionProvider();
    const session = await provider.create();

    expect(session.sessionId).toBeDefined();
    expect(session.conversation).toEqual([]);
    expect(session.currentTurn).toBe(0);
    expect(session.createdAt).toBeInstanceOf(Date);
    expect(session.updatedAt).toBeInstanceOf(Date);
  });

  it('should load an existing session', async () => {
    const provider = new InMemorySessionProvider();
    const created = await provider.create();
    created.conversation.push({ id: 'm1', role: 'user', content: [{ type: 'text', text: 'hello' }] } as ModelMessage);
    await provider.save(created);

    const loaded = await provider.load(created.sessionId);
    expect(loaded).not.toBeNull();
    expect(loaded!.conversation).toHaveLength(1);
    expect(loaded!.conversation[0].content).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('should return null for unknown session id', async () => {
    const provider = new InMemorySessionProvider();
    const loaded = await provider.load('unknown-id');
    expect(loaded).toBeNull();
  });

  it('should update updatedAt on save', async () => {
    const provider = new InMemorySessionProvider();
    const session = await provider.create();
    const before = session.updatedAt.getTime();
    await new Promise(r => setTimeout(r, 10));
    await provider.save(session);
    const loaded = await provider.load(session.sessionId);
    expect(loaded!.updatedAt.getTime()).toBeGreaterThan(before);
  });

  it('should list sessions sorted by updatedAt desc', async () => {
    const provider = new InMemorySessionProvider();
    const a = await provider.create();
    await new Promise(r => setTimeout(r, 10));
    const b = await provider.create();
    await new Promise(r => setTimeout(r, 10));
    const c = await provider.create();

    a.metadata.title = 'Alpha';
    a.conversation.push({ id: 'm1', role: 'user', content: [{ type: 'text', text: 'hi' }] } as ModelMessage);
    await provider.save(a);

    b.conversation.push({ id: 'm1', role: 'user', content: [{ type: 'text', text: 'hello' }] } as ModelMessage);
    b.conversation.push({ id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'hi' }] } as ModelMessage);
    await provider.save(b);

    await new Promise(r => setTimeout(r, 10));
    await provider.save(c);

    const list = await provider.list();
    expect(list).toHaveLength(3);
    // verify sorted by updatedAt desc
    for (let i = 0; i < list.length - 1; i++) {
      expect(list[i].updatedAt.getTime()).toBeGreaterThanOrEqual(list[i + 1].updatedAt.getTime());
    }
    expect(list.some(s => s.title === 'Alpha')).toBe(true);
    expect(list.some(s => s.messageCount === 2)).toBe(true);
  });

  it('should delete a session', async () => {
    const provider = new InMemorySessionProvider();
    const session = await provider.create();
    await provider.delete(session.sessionId);
    const loaded = await provider.load(session.sessionId);
    expect(loaded).toBeNull();
  });

  it('should list pinned metadata', async () => {
    const provider = new InMemorySessionProvider();
    const a = await provider.create();
    a.metadata.title = 'A';
    a.metadata.pinned = true;
    await provider.save(a);

    const b = await provider.create();
    b.metadata.title = 'B';
    await provider.save(b);

    const list = await provider.list();
    const summaryA = list.find((s) => s.sessionId === a.sessionId);
    const summaryB = list.find((s) => s.sessionId === b.sessionId);
    expect(summaryA?.pinned).toBe(true);
    expect(summaryB?.pinned).toBeUndefined();
  });
});
