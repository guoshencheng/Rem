import { resolve } from 'path';
import { AgentService } from './agent-service';

const titles = new Map<string, string>();
const pins = new Map<string, boolean>();

export class SessionService {
  list() {
    const agentService = AgentService.getInstance();
    const result: Array<{ sessionId: string; title?: string; updatedAt: number; messageCount: number }> = [];

    // 从 msgCache 获取所有已知会话
    const knownSessions = new Set<string>();
    const msgCache = (agentService as unknown as { _msgCache?: Map<string, unknown> })._msgCache;
    if (msgCache) {
      for (const [sessionId, entry] of msgCache.entries()) {
        knownSessions.add(sessionId);
        const msgs = (entry as { messages: Array<{ role: string; content: string }> }).messages;
        result.push({
          sessionId,
          title: titles.get(sessionId) ?? extractTitle(msgs),
          updatedAt: Date.now(),
          messageCount: msgs.length,
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
    return AgentService.getInstance().getMessages(sessionId);
  }

  update(id: string, updates: { title?: string; pinned?: boolean }) {
    if (updates.title) titles.set(id, updates.title);
    if (updates.pinned !== undefined) pins.set(id, updates.pinned);
  }

  async delete(id: string) {
    titles.delete(id);
    pins.delete(id);
    const agentService = AgentService.getInstance();
    try { await (agentService as unknown as { sessionProvider?: { delete: (id: string) => Promise<void> } }).sessionProvider?.delete(id); } catch { /* ignore */ }
  }
}

function extractTitle(messages: Array<{ role: string; content: string }>): string {
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser) return 'New Chat';
  const text = firstUser.content.trim();
  return text.length > 20 ? text.slice(0, 20) + '...' : text;
}
