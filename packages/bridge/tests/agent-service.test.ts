import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentService } from '../src/agent.js';
import { FileSessionProvider, createProviderManager } from 'rem-agent-core';
import type { ProviderManager } from 'rem-agent-core';

describe('AgentService session management', () => {
  let dir: string;
  let pm: ProviderManager;
  let service: AgentService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-service-test-'));
    const sessionProvider = new FileSessionProvider(dir);
    pm = await createProviderManager({ sessionProvider });
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

  it('refreshes updatedAt when updating session', async () => {
    const summary = await service.createSession();
    const before = await service.listSessions();
    const beforeUpdatedAt = before.find((s) => s.sessionId === summary.sessionId)!.updatedAt;

    await new Promise((r) => setTimeout(r, 10));
    await service.updateSession(summary.sessionId, { title: 'Renamed' });

    const after = await service.listSessions();
    const afterUpdatedAt = after.find((s) => s.sessionId === summary.sessionId)!.updatedAt;
    expect(afterUpdatedAt).toBeGreaterThan(beforeUpdatedAt);
  });

  it('deletes a session', async () => {
    const summary = await service.createSession();
    await service.deleteSession(summary.sessionId);
    const list = await service.listSessions();
    expect(list.some((s) => s.sessionId === summary.sessionId)).toBe(false);
  });

  it('throws 404 when deleting non-existent session', async () => {
    await expect(service.deleteSession('nonexistent')).rejects.toThrow(/Session not found/);
  });

  it('returns messages for existing session', async () => {
    const summary = await service.createSession();
    const messages = await service.getMessages(summary.sessionId);
    expect(messages).toEqual([]);
  });

  it('throws 404 when getting messages for non-existent session', async () => {
    await expect(service.getMessages('nonexistent')).rejects.toThrow(/Session not found/);
  });

  it('throws 404 when updating non-existent session', async () => {
    await expect(service.updateSession('nonexistent', { title: 'X' })).rejects.toThrow(/Session not found/);
  });
});
