import { describe, it, expect } from 'vitest';
import { InMemorySessionProvider } from '../src/session.js';

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
    created.conversation.push({ role: 'user', content: 'hello' } as any);
    await provider.save(created);

    const loaded = await provider.load(created.sessionId);
    expect(loaded).not.toBeNull();
    expect(loaded!.conversation).toHaveLength(1);
    expect(loaded!.conversation[0].content).toBe('hello');
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
});
