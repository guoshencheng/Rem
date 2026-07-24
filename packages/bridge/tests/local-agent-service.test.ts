import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { LocalAgentService } from '../src/local/agent-local-service.js';

describe('LocalAgentService', () => {
  it('init + workspace + session CRUD + stream', async () => {
    const svc = new LocalAgentService({
      credential: { provider: 'anthropic', apiKey: 'sk-test', model: 'claude-sonnet-4-5' },
      dbName: `svc-test-${Math.random().toString(36).slice(2)}`,
    });
    await svc.init();

    await svc.addWorkspace('default');
    expect(await svc.listWorkspaces()).toHaveLength(1);

    const s = await svc.createSession('default');
    expect(s.sessionId).toBeTruthy();
    expect(await svc.listSessions('default')).toHaveLength(1);

    await svc.updateSession('default', s.sessionId, { title: 'renamed' });
    expect((await svc.searchSessions('default', 'renam'))).toHaveLength(1);

    expect(await svc.getMessages('default', s.sessionId)).toEqual([]);
    expect(await svc.getTodos('default', s.sessionId)).toEqual([]);

    // stream 是可中断的 AsyncIterable
    const controller = new AbortController();
    const iter = svc.stream(controller.signal)[Symbol.asyncIterator]();
    controller.abort();
    await iter.next();

    await svc.deleteSession('default', s.sessionId);
    expect(await svc.listSessions('default')).toHaveLength(0);
  });
});
