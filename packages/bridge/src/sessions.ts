import { AgentService } from './agent.js';

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
  private agentService: AgentService;

  constructor() {
    this.agentService = AgentService.getInstance();
  }

  list() {
    const agentSvc = AgentService.getInstance();
    const result: Array<{ sessionId: string; title?: string; updatedAt: number; messageCount: number }> = [];

    const msgCache = (agentSvc as unknown as { msgCache?: Map<string, { messages: Array<{ role: string; content: string }> }> }).msgCache;
    if (msgCache) {
      for (const [sessionId, entry] of msgCache.entries()) {
        result.push({
          sessionId,
          title: meta.get(sessionId)?.title ?? extractTitle(entry.messages),
          updatedAt: Date.now(),
          messageCount: entry.messages.length,
        });
      }
    }

    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  create() {
    const sessionId = crypto.randomUUID();
    return { sessionId, title: 'New Chat', updatedAt: Date.now(), messageCount: 0 };
  }

  getMessages(sessionId: string) {
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
