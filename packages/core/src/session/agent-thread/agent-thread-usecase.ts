import type { AgentThreadStore } from './store.js';
import type { AgentThread } from './model.js';
import { generateId } from '../../shared/generate-id.js';

export class AgentThreadUsecase {
  constructor(private readonly store: AgentThreadStore) {}

  async ensurePrimaryThread(sessionId: string, agentProfileId: string): Promise<AgentThread> {
    const existing = (await this.store.listBySession(sessionId)).find((item) => item.role === 'primary');
    if (existing) return existing;
    const now = new Date();
    const thread: AgentThread = {
      agentThreadId: generateId(), sessionId, agentProfileId,
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

  async createDelegatedThread(sessionId: string, agentProfileId: string): Promise<AgentThread> {
    const now = new Date();
    const thread: AgentThread = {
      agentThreadId: generateId(), sessionId, agentProfileId,
      role: 'delegated', lifecycle: 'one-shot', createdAt: now, updatedAt: now,
    };
    await this.store.save(thread);
    return thread;
  }

  listBySession(sessionId: string): Promise<AgentThread[]> {
    return this.store.listBySession(sessionId);
  }

  get(agentThreadId: string): Promise<AgentThread | null> {
    return this.store.get(agentThreadId);
  }
}
