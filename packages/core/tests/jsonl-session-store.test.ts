import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { JsonlSessionStore } from '../src/plugins/session/jsonl-store.js';
import type { ModelMessage } from '../src/types.js';
import type { Session } from '../src/session.js';

function textMessage(id: string, text: string): ModelMessage {
  return { id, role: 'user', content: [{ type: 'text', text }] };
}

function makeSession(sessionId: string, messages: ModelMessage[], overrides: Partial<Session> = {}): Session {
  return {
    sessionId,
    conversation: messages,
    currentTurn: 0,
    metadata: {},
    createdAt: new Date('2026-07-06T00:00:00Z'),
    updatedAt: new Date('2026-07-06T00:00:00Z'),
    ...overrides,
  };
}

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
    const session = makeSession('s1', [textMessage('m1', 'hi')], {
      currentTurn: 1,
      metadata: { title: 't' },
    });

    await store.save(session);
    const loaded = await store.load('s1');

    expect(loaded).not.toBeNull();
    expect(loaded!.sessionId).toBe('s1');
    expect(loaded!.conversation).toHaveLength(1);
    expect(loaded!.conversation[0].content).toEqual([{ type: 'text', text: 'hi' }]);
    expect(loaded!.currentTurn).toBe(1);
    expect(loaded!.metadata.title).toBe('t');
  });

  it('appends only delta messages when saving a session twice', async () => {
    const session = makeSession('s1', [textMessage('m1', 'first')]);
    await store.save(session);

    session.conversation.push(textMessage('m2', 'second'));
    await store.save(session);

    const raw = await readFile(join(dir, 's1.jsonl'), 'utf-8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe('m1');
    expect(JSON.parse(lines[1]).id).toBe('m2');

    const loaded = await store.load('s1');
    expect(loaded!.conversation).toHaveLength(2);
  });

  it('does not duplicate messages when saving after loading from disk', async () => {
    const session = makeSession('s1', [textMessage('m1', 'first')]);
    await store.save(session);

    const freshStore = new JsonlSessionStore(dir);
    const loaded = await freshStore.load('s1');
    expect(loaded).not.toBeNull();

    loaded!.conversation.push(textMessage('m2', 'second'));
    await freshStore.save(loaded!);

    const raw = await readFile(join(dir, 's1.jsonl'), 'utf-8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe('m1');
    expect(JSON.parse(lines[1]).id).toBe('m2');
  });

  it('persists in-place content updates when saving a session twice', async () => {
    const msg: ModelMessage = { id: 'm1', role: 'assistant', content: [] };
    const session = makeSession('s1', [msg]);
    await store.save(session);

    msg.content.push({ type: 'text', text: 'updated' });
    await store.save(session);

    const loaded = await store.load('s1');
    expect(loaded).not.toBeNull();
    expect(loaded!.conversation).toHaveLength(1);
    expect(loaded!.conversation[0].content).toEqual([{ type: 'text', text: 'updated' }]);
  });

  it('delete removes both jsonl and meta files', async () => {
    const session = makeSession('s1', [textMessage('m1', 'hi')]);
    await store.save(session);

    await store.delete('s1');

    const entries = await readdir(dir);
    expect(entries.filter((e) => e.startsWith('s1'))).toHaveLength(0);
    expect(await store.load('s1')).toBeNull();
  });

  it('listSummaries returns all persisted sessions sorted by updatedAt descending', async () => {
    const sessions = [
      { id: 'older', updatedAt: '2026-07-01T00:00:00Z', messageCount: 1, title: 'First' },
      { id: 'middle', updatedAt: '2026-07-03T00:00:00Z', messageCount: 2, title: 'Second' },
      { id: 'newer', updatedAt: '2026-07-05T00:00:00Z', messageCount: 3, title: 'Third' },
    ];

    for (const session of sessions) {
      const messages = Array.from({ length: session.messageCount }, (_, i) =>
        textMessage(`m-${session.id}-${i}`, `msg-${i}`),
      );
      const lines = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
      await writeFile(join(dir, `${session.id}.jsonl`), lines, 'utf-8');

      const meta = {
        sessionId: session.id,
        currentTurn: 0,
        metadata: { title: session.title, pinned: session.id === 'middle' },
        createdAt: '2026-06-01T00:00:00Z',
        updatedAt: session.updatedAt,
      };
      await writeFile(join(dir, `${session.id}.meta.json`), JSON.stringify(meta, null, 2), 'utf-8');
    }

    const summaries = await store.listSummaries();
    expect(summaries).toHaveLength(3);
    expect(summaries.map((s) => s.sessionId)).toEqual(['newer', 'middle', 'older']);
    expect(summaries.find((s) => s.sessionId === 'middle')?.pinned).toBe(true);
    expect(summaries.find((s) => s.sessionId === 'newer')?.messageCount).toBe(3);
  });

  it('load returns null when neither file exists', async () => {
    const loaded = await store.load('missing');
    expect(loaded).toBeNull();
  });

  it('load returns session with default metadata when only jsonl exists', async () => {
    const lines = [textMessage('m1', 'only-jsonl')].map((m) => JSON.stringify(m)).join('\n') + '\n';
    await writeFile(join(dir, 'only.jsonl'), lines, 'utf-8');

    const loaded = await store.load('only');

    expect(loaded).not.toBeNull();
    expect(loaded!.sessionId).toBe('only');
    expect(loaded!.conversation).toHaveLength(1);
    expect(loaded!.conversation[0].content).toEqual([{ type: 'text', text: 'only-jsonl' }]);
    expect(loaded!.metadata).toEqual({});
    expect(loaded!.currentTurn).toBe(0);
    expect(loaded!.createdAt).toEqual(new Date(0));
    expect(loaded!.updatedAt).toEqual(new Date(0));
  });

  it('load returns session with empty conversation when only meta exists', async () => {
    const meta = {
      sessionId: 'only-meta',
      currentTurn: 5,
      metadata: { title: 'meta-only title', pinned: true },
      createdAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-06-15T00:00:00Z',
    };
    await writeFile(join(dir, 'only-meta.meta.json'), JSON.stringify(meta, null, 2), 'utf-8');

    const loaded = await store.load('only-meta');

    expect(loaded).not.toBeNull();
    expect(loaded!.sessionId).toBe('only-meta');
    expect(loaded!.conversation).toHaveLength(0);
    expect(loaded!.currentTurn).toBe(5);
    expect(loaded!.metadata).toEqual({ title: 'meta-only title', pinned: true });
    expect(loaded!.createdAt).toEqual(new Date('2026-06-01T00:00:00Z'));
    expect(loaded!.updatedAt).toEqual(new Date('2026-06-15T00:00:00Z'));
  });

  it('returns null when jsonl is corrupted', async () => {
    await store.save({
      sessionId: 's1',
      conversation: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'hi' }] } as ModelMessage],
      currentTurn: 0,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // corrupt the jsonl file
    await writeFile(join(dir, 's1.jsonl'), '{invalid json}\n', 'utf-8');
    const loaded = await store.load('s1');
    expect(loaded).toBeNull();
  });

  it('writeMeta uses temp file and rename, leaving no tmp file behind', async () => {
    const session = makeSession('s1', [textMessage('m1', 'hi')]);
    await store.save(session);

    const entries = await readdir(dir);
    expect(entries).not.toContain('s1.meta.json.tmp');
    expect(entries).toContain('s1.meta.json');

    const raw = await readFile(join(dir, 's1.meta.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.sessionId).toBe('s1');
    expect(parsed.currentTurn).toBe(0);
    expect(parsed.metadata).toEqual({});
    expect(typeof parsed.createdAt).toBe('string');
    expect(typeof parsed.updatedAt).toBe('string');
    expect(new Date(parsed.updatedAt).getTime()).toBeGreaterThan(0);
  });
});
