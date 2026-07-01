import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentService } from '../src/agent.js';
import { FileSessionProvider, createAgentFromEnv } from 'rem-agent-core';
import type { ProviderManager } from 'rem-agent-core';

describe('AgentService session management', () => {
  let dir: string;
  let pm: ProviderManager;
  let service: AgentService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-service-test-'));
    const sessionProvider = new FileSessionProvider(dir);
    const result = await createAgentFromEnv({ sessionProvider });
    pm = result.pm;
    service = new AgentService(pm);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates a session', async () => {
    const summary = await service.createSession();
    expect(summary.sessionId).toBeDefined();
    expect(summary.title).toBe('New Chat');
    expect(summary.messageCount).toBe(0);

    const list = await service.listSessions();
    expect(list.some((s) => s.sessionId === summary.sessionId)).toBe(true);
  });

  it('lists sessions with pinned first', async () => {
    const a = await service.createSession();
    const b = await service.createSession();
    await service.updateSession(a.sessionId, { pinned: true, title: 'Pinned' });

    const list = await service.listSessions();
    expect(list[0].sessionId).toBe(a.sessionId);
    expect(list[0].pinned).toBe(true);
    expect(list[0].title).toBe('Pinned');
  });

  it('updates title and pinned', async () => {
    const summary = await service.createSession();
    await service.updateSession(summary.sessionId, { title: 'Renamed', pinned: true });
    const list = await service.listSessions();
    const found = list.find((s) => s.sessionId === summary.sessionId);
    expect(found?.title).toBe('Renamed');
    expect(found?.pinned).toBe(true);
  });

  it('deletes a session', async () => {
    const summary = await service.createSession();
    await service.deleteSession(summary.sessionId);
    const list = await service.listSessions();
    expect(list.some((s) => s.sessionId === summary.sessionId)).toBe(false);
  });

  it('throws 404 when updating non-existent session', async () => {
    await expect(service.updateSession('nonexistent', { title: 'X' })).rejects.toThrow(/Session not found/);
  });
});
