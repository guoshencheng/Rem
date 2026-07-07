import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentService } from '../src/agent.js';
import type { ModelMessage } from 'rem-agent-core';

describe('AgentService session management', () => {
  let dir: string;
  let service: AgentService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-service-test-'));
    service = new AgentService({ workspaceRoot: dir });
    await service.init();
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

  it('merges tool-result parts into assistant messages', async () => {
    const summary = await service.createSession();
    const sessionProvider = service.context!.sessionProvider;
    const session = await sessionProvider.load(summary.sessionId);
    if (!session) throw new Error('Session not found');

    const assistantMsg: ModelMessage = {
      id: 'a1',
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'ls', arguments: { path: '.' } }],
    };
    const toolMsg: ModelMessage = {
      id: 't1',
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: 'tc1', toolName: 'ls', output: 'file.txt' }],
    };
    session.conversation.push(assistantMsg, toolMsg);
    await sessionProvider.save(session);

    const messages = await service.getMessages(summary.sessionId);
    expect(messages).toHaveLength(1);
    expect(messages[0].parts).toHaveLength(2);
    expect(messages[0].parts[0]).toEqual({ type: 'tool-call', toolCallId: 'tc1', toolName: 'ls', arguments: { path: '.' } });
    expect(messages[0].parts[1]).toEqual({ type: 'tool-result', toolCallId: 'tc1', toolName: 'ls', output: 'file.txt' });
  });
});
