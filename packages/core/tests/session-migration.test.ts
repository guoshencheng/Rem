import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { migrateConversationToPiAi } from '../src/pi-adapter.js';
import { FileSessionProvider } from '../src/plugins/session/file/index.js';
import { InMemorySessionProvider } from '../src/plugins/session/in-memory/index.js';
import type { Session } from '../src/sdk/session-provider.js';

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

function createLegacySession(): Session {
  return {
    sessionId: 'legacy-session',
    conversation: [
      { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ] as any,
    currentTurn: 0,
    metadata: { schemaVersion: 1 },
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };
}

describe('FileSessionProvider migration', () => {
  let dir: string;
  let provider: FileSessionProvider;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rem-session-migration-'));
    provider = new FileSessionProvider(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('migrates a schemaVersion=1 session on first load', async () => {
    const session = createLegacySession();
    await provider.save(session);

    const loaded = await provider.load('legacy-session');
    expect(loaded).not.toBeNull();
    expect(loaded?.metadata.schemaVersion).toBe(2);
    expect(loaded?.conversation).toHaveLength(2);
    expect(loaded?.conversation[0].role).toBe('user');
    expect(loaded?.conversation[1].role).toBe('assistant');
    expect(loaded?.metadata.messageMeta).toMatchObject({ u1: 'u1', a1: 'a1' });
  });

  it('does not migrate twice', async () => {
    const session = createLegacySession();
    await provider.save(session);

    const first = await provider.load('legacy-session');
    expect(first?.metadata.schemaVersion).toBe(2);
    const conversationBefore = JSON.stringify(first?.conversation);

    const second = await provider.load('legacy-session');
    expect(second?.metadata.schemaVersion).toBe(2);
    expect(JSON.stringify(second?.conversation)).toBe(conversationBefore);
  });
});

describe('InMemorySessionProvider migration', () => {
  let provider: InMemorySessionProvider;

  beforeEach(() => {
    provider = new InMemorySessionProvider();
  });

  it('migrates a schemaVersion=1 session on first load', async () => {
    const session = createLegacySession();
    await provider.save(session);

    const loaded = await provider.load('legacy-session');
    expect(loaded).not.toBeNull();
    expect(loaded?.metadata.schemaVersion).toBe(2);
    expect(loaded?.conversation).toHaveLength(2);
    expect(loaded?.metadata.messageMeta).toMatchObject({ u1: 'u1', a1: 'a1' });
  });

  it('does not migrate twice', async () => {
    const session = createLegacySession();
    await provider.save(session);

    const first = await provider.load('legacy-session');
    expect(first?.metadata.schemaVersion).toBe(2);
    const conversationBefore = JSON.stringify(first?.conversation);

    const second = await provider.load('legacy-session');
    expect(JSON.stringify(second?.conversation)).toBe(conversationBefore);
  });
});
