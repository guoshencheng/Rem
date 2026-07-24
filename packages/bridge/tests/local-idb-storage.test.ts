import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IndexedDBStorageProvider } from '../src/local/idb-storage-provider.js';
import { BrowserSessionProvider } from '../src/local/browser-session-provider.js';

describe('IndexedDBStorageProvider', () => {
  let provider: IndexedDBStorageProvider;

  beforeEach(async () => {
    provider = new IndexedDBStorageProvider(`test-${Math.random().toString(36).slice(2)}`);
    await provider.init();
  });

  it('session round-trip with dates revived', async () => {
    const s = await provider.sessionStore.create('ws1');
    s.metadata.title = 'hello';
    await provider.sessionStore.save(s);
    const loaded = await provider.sessionStore.load(s.sessionId);
    expect(loaded?.metadata.title).toBe('hello');
    expect(loaded?.createdAt).toBeInstanceOf(Date);
  });

  it('listByWorkspace filters', async () => {
    await provider.sessionStore.create('ws1');
    await provider.sessionStore.create('ws2');
    expect(await provider.sessionStore.listByWorkspace('ws1')).toHaveLength(1);
    expect(await provider.sessionStore.listAll()).toHaveLength(2);
  });

  it('todo replace/get', async () => {
    await provider.todoStore.replaceForSession('s1', [{ id: 't1', title: 'x', status: 'pending' } as never]);
    expect(await provider.todoStore.getBySession('s1')).toHaveLength(1);
  });

  it('rule save/loadBySource', async () => {
    await provider.ruleStore.saveApproved({ permission: 'read', pattern: '**', action: 'allow' });
    expect(await provider.ruleStore.loadBySource('approved')).toHaveLength(1);
    expect(await provider.ruleStore.loadAll()).toHaveLength(1);
  });

  it('archive save/getLatest versions', async () => {
    await provider.archiveStore.save({ id: 'a1', sessionId: 's1', compressedAt: new Date(), version: 1, conversationSnapshot: [], summary: '' });
    await provider.archiveStore.save({ id: 'a2', sessionId: 's1', compressedAt: new Date(), version: 2, conversationSnapshot: [], summary: '' });
    expect((await provider.archiveStore.getLatest('s1'))?.version).toBe(2);
  });

  it('workspace add/list/remove', async () => {
    await provider.workspaceStore.add('/ws/a');
    expect(await provider.workspaceStore.list()).toHaveLength(1);
    await provider.workspaceStore.remove('/ws/a');
    expect(await provider.workspaceStore.list()).toHaveLength(0);
  });

  it('BrowserSessionProvider create/load/addMessage', async () => {
    const sp = new BrowserSessionProvider(provider.sessionStore);
    const s = await sp.create();
    const { messageId, message } = sp.addMessage(s, 'assistant');
    sp.appendContent(s, message, { type: 'text', text: 'hi' } as never);
    await sp.save(s);
    const loaded = await sp.load(s.sessionId);
    expect(loaded?.conversation).toHaveLength(1);
    expect(messageId).toBeTruthy();
  });
});
