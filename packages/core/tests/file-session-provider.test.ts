import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileSessionProvider } from '../src/plugins/session/file/index.js';
import type { ModelMessage } from '../src/types.js';

describe('FileSessionProvider', () => {
  let dir: string;
  let provider: FileSessionProvider;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'file-session-test-'));
    provider = new FileSessionProvider(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('should create a new session and persist to file', async () => {
    const session = await provider.create();

    expect(session.sessionId).toBeDefined();
    expect(session.conversation).toEqual([]);
    expect(session.currentTurn).toBe(0);

    const loaded = await provider.load(session.sessionId);
    expect(loaded).not.toBeNull();
    expect(loaded!.sessionId).toBe(session.sessionId);
  });

  it('should save and load session with conversation', async () => {
    const session = await provider.create();
    session.conversation.push({ role: 'user', content: 'hello' } as ModelMessage);
    session.metadata.title = 'Test Title';
    await provider.save(session);

    const loaded = await provider.load(session.sessionId);
    expect(loaded).not.toBeNull();
    expect(loaded!.conversation).toHaveLength(1);
    expect(loaded!.conversation[0].content).toBe('hello');
    expect(loaded!.metadata.title).toBe('Test Title');
  });

  it('should return null for non-existent session', async () => {
    const loaded = await provider.load('nonexistent');
    expect(loaded).toBeNull();
  });

  it('should list sessions sorted by updatedAt desc', async () => {
    const a = await provider.create();
    await new Promise(r => setTimeout(r, 15));
    const b = await provider.create();
    await new Promise(r => setTimeout(r, 15));
    const c = await provider.create();

    a.metadata.title = 'First';
    await provider.save(a);
    await new Promise(r => setTimeout(r, 15));
    b.metadata.title = 'Second';
    await provider.save(b);
    await new Promise(r => setTimeout(r, 15));
    c.metadata.title = 'Third';
    await provider.save(c);

    const list = await provider.list();
    expect(list).toHaveLength(3);
    expect(list[0].sessionId).toBe(c.sessionId);
    expect(list[0].title).toBe('Third');
    expect(list[1].sessionId).toBe(b.sessionId);
    expect(list[2].sessionId).toBe(a.sessionId);
  });

  it('should deserialize Date fields correctly', async () => {
    const session = await provider.create();

    const loaded = await provider.load(session.sessionId);
    expect(loaded).not.toBeNull();
    expect(loaded!.createdAt).toBeInstanceOf(Date);
    expect(loaded!.updatedAt).toBeInstanceOf(Date);
    expect(loaded!.createdAt.getTime()).toBeGreaterThan(0);
  });

  it('should return empty list for empty directory', async () => {
    const list = await provider.list();
    expect(list).toEqual([]);
  });

  it('should auto-create directory on create', async () => {
    const subDir = join(dir, 'nested', 'sessions');
    const nestedProvider = new FileSessionProvider(subDir);
    const session = await nestedProvider.create();

    const loaded = await nestedProvider.load(session.sessionId);
    expect(loaded).not.toBeNull();
  });

  it('should delete a session file', async () => {
    const session = await provider.create();
    await provider.delete(session.sessionId);
    const loaded = await provider.load(session.sessionId);
    expect(loaded).toBeNull();
  });

  it('should list pinned metadata', async () => {
    const a = await provider.create();
    a.metadata.title = 'Pinned';
    a.metadata.pinned = true;
    await provider.save(a);

    const b = await provider.create();
    b.metadata.title = 'Normal';
    await provider.save(b);

    const list = await provider.list();
    const summaryA = list.find((s) => s.sessionId === a.sessionId);
    const summaryB = list.find((s) => s.sessionId === b.sessionId);
    expect(summaryA?.pinned).toBe(true);
    expect(summaryB?.pinned).toBeUndefined();
  });
});
