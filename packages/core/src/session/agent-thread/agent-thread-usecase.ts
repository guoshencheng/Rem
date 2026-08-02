import type { AgentThreadStore } from './store.js';
import type { AgentThread } from './model.js';
import { generateId } from '../../shared/generate-id.js';
import type { ResolvedTeam } from '../../sdk/agent-role.js';

export class AgentThreadUsecase {
  constructor(private readonly store: AgentThreadStore) {}

  async ensurePrimaryThread(sessionId: string, agentId: string): Promise<AgentThread> {
    const existing = (await this.store.listBySession(sessionId)).find((item) => item.role === 'primary');
    if (existing) return existing;
    const now = new Date();
    const thread: AgentThread = {
      agentThreadId: generateId(), sessionId, agentId,
      role: 'primary', lifecycle: 'persistent', createdAt: now, updatedAt: now,
    };
    try {
      await this.store.save(thread);
      return thread;
    } catch (error) {
      const concurrent = (await this.store.listBySession(sessionId)).find((item) => item.role === 'primary');
      if (concurrent) return concurrent;
      throw error;
    }
  }

  async createDelegatedThread(sessionId: string, agentId: string): Promise<AgentThread> {
    const now = new Date();
    const thread: AgentThread = {
      agentThreadId: generateId(), sessionId, agentId,
      role: 'delegated', lifecycle: 'one-shot', createdAt: now, updatedAt: now,
    };
    await this.store.save(thread);
    return thread;
  }

  async ensureTeamThreads(sessionId: string, team: ResolvedTeam): Promise<AgentThread[]> {
    const specs = [
      { agentId: team.organizer.id, role: 'organizer' as const },
      ...team.members.map((member) => ({ agentId: member.id, role: 'member' as const })),
    ];
    const existing = await this.store.listBySession(sessionId);
    const result: AgentThread[] = [];
    for (const spec of specs) {
      const found = existing.find((thread) => thread.agentId === spec.agentId && thread.lifecycle === 'persistent');
      if (found) { result.push(found); continue; }
      const now = new Date();
      const thread: AgentThread = { agentThreadId: generateId(), sessionId, ...spec,
        lifecycle: 'persistent', createdAt: now, updatedAt: now };
      await this.store.save(thread);
      result.push(thread);
    }
    return result;
  }

  listBySession(sessionId: string): Promise<AgentThread[]> {
    return this.store.listBySession(sessionId);
  }

  get(agentThreadId: string): Promise<AgentThread | null> {
    return this.store.get(agentThreadId);
  }
}
