import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { JsonlSessionStore } from '../src/plugins/session/jsonl-store.js';
import type { ModelMessage } from '../src/types.js';

describe('JsonlSessionStore', () => {
  let dir: string;
  let store: JsonlSessionStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'jsonl-store-test-'));
    store = new JsonlSessionStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('saves and loads session with conversation', async () => {
    const session = {
      sessionId: 's1',
      conversation: [
        { id: 'm1', role: 'user', content: [{ type: 'text', text: 'hi' }] } as ModelMessage,
      ],
      currentTurn: 1,
      metadata: { title: 't' },
      createdAt: new Date('2026-07-06T00:00:00Z'),
      updatedAt: new Date('2026-07-06T00:00:01Z'),
    };

    await store.save(session);
    const loaded = await store.load('s1');

    expect(loaded).not.toBeNull();
    expect(loaded!.sessionId).toBe('s1');
    expect(loaded!.conversation).toHaveLength(1);
    expect(loaded!.conversation[0].content).toEqual([{ type: 'text', text: 'hi' }]);
    expect(loaded!.currentTurn).toBe(1);
    expect(loaded!.metadata.title).toBe('t');
  });
});
