import { describe, it, expect } from 'vitest';
import type { ModelMessage } from 'rem-agent-core';
import { AgentService } from '../../src/agent.js';
import { createTestService } from './shared.js';

describe('AgentService session management', { timeout: 20000 }, () => {
  it('creates a session', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession();
      expect(summary.sessionId).toBeDefined();
      expect(summary.title).toBe('New Chat');
      expect(summary.messageCount).toBe(0);

      const list = await service.listSessions();
      expect(list.some((s) => s.sessionId === summary.sessionId)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('lists sessions with pinned first', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const a = await service.createSession();
      const b = await service.createSession();
      await service.updateSession(a.sessionId, { pinned: true, title: 'Pinned' });

      const list = await service.listSessions();
      expect(list[0].sessionId).toBe(a.sessionId);
      expect(list[0].pinned).toBe(true);
      expect(list[0].title).toBe('Pinned');
      expect(list.some((s) => s.sessionId === b.sessionId)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('updates title and pinned', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession();
      await service.updateSession(summary.sessionId, { title: 'Renamed', pinned: true });
      const list = await service.listSessions();
      const found = list.find((s) => s.sessionId === summary.sessionId);
      expect(found?.title).toBe('Renamed');
      expect(found?.pinned).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('refreshes updatedAt when updating session', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession();
      const before = await service.listSessions();
      const beforeUpdatedAt = before.find((s) => s.sessionId === summary.sessionId)!.updatedAt;

      await new Promise((r) => setTimeout(r, 10));
      await service.updateSession(summary.sessionId, { title: 'Renamed' });

      const after = await service.listSessions();
      const afterUpdatedAt = after.find((s) => s.sessionId === summary.sessionId)!.updatedAt;
      expect(afterUpdatedAt).toBeGreaterThan(beforeUpdatedAt);
    } finally {
      await cleanup();
    }
  });

  it('deletes a session', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession();
      await service.deleteSession(summary.sessionId);
      const list = await service.listSessions();
      expect(list.some((s) => s.sessionId === summary.sessionId)).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('throws 404 when deleting non-existent session', async () => {
    const { service, cleanup } = await createTestService();
    try {
      await expect(service.deleteSession('nonexistent')).rejects.toThrow(/Session not found/);
    } finally {
      await cleanup();
    }
  });

  it('throws 404 when getting messages for non-existent session', async () => {
    const { service, cleanup } = await createTestService();
    try {
      await expect(service.getMessages('nonexistent')).rejects.toThrow(/Session not found/);
    } finally {
      await cleanup();
    }
  });

  it('throws 404 when updating non-existent session', async () => {
    const { service, cleanup } = await createTestService();
    try {
      await expect(service.updateSession('nonexistent', { title: 'X' })).rejects.toThrow(/Session not found/);
    } finally {
      await cleanup();
    }
  });

  it('returns messages for existing session', async () => {
    const { service, cleanup } = await createTestService();
    try {
      const summary = await service.createSession();
      const messages = await service.getMessages(summary.sessionId);
      expect(messages).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it('merges tool-result parts into assistant messages', async () => {
    const { service, cleanup } = await createTestService();
    try {
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
    } finally {
      await cleanup();
    }
  });

  it('persists sessions across AgentService instances using the same sessionsDir', async () => {
    const { service, dir, cleanup } = await createTestService();
    try {
      const summary = await service.createSession();
      await service.updateSession(summary.sessionId, { title: 'Persisted' });

      const sessionProvider = service.context!.sessionProvider;
      const session = await sessionProvider.load(summary.sessionId);
      if (!session) throw new Error('Session not found');
      session.conversation.push({
        id: 'u1',
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
      } as ModelMessage);
      await sessionProvider.save(session);

      const newService = new AgentService({ workspaceRoot: dir, sessionsDir: dir });
      await newService.init();

      const list = await newService.listSessions();
      expect(list.some((s) => s.sessionId === summary.sessionId && s.title === 'Persisted')).toBe(true);

      const messages = await newService.getMessages(summary.sessionId);
      expect(messages).toHaveLength(1);
      expect(messages[0].parts[0]).toEqual({ type: 'text', text: 'hello' });
    } finally {
      await cleanup();
    }
  });
});
