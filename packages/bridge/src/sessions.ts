import type { IAgentService } from './agent-service.interface.js';

interface SessionEntry {
  title?: string;
  pinned?: boolean;
}

const meta = new Map<string, SessionEntry>();

export function extractTitle(messages: Array<{ role: string; content: string }>): string {
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser) return 'New Chat';
  const text = firstUser.content.trim();
  return text.length > 20 ? text.slice(0, 20) + '...' : text;
}

export class SessionService {
  constructor(private agentService: IAgentService) {}

  async list() {
    const sessions = await this.agentService.listSessions();
    return sessions.map((s) => ({
      ...s,
      title: meta.get(s.sessionId)?.title ?? s.title,
      updatedAt: Date.now(),
    }));
  }

  create() {
    const sessionId = crypto.randomUUID();
    return { sessionId, title: 'New Chat', updatedAt: Date.now(), messageCount: 0 };
  }

  async getMessages(sessionId: string) {
    return this.agentService.getMessages(sessionId);
  }

  update(id: string, updates: { title?: string; pinned?: boolean }) {
    const entry = meta.get(id) ?? {};
    if (updates.title !== undefined) entry.title = updates.title;
    if (updates.pinned !== undefined) entry.pinned = updates.pinned;
    meta.set(id, entry);
  }

  delete(id: string) {
    meta.delete(id);
  }
}
