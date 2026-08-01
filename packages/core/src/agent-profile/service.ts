import type { AgentProfileStore } from './store.js';
import type { AgentProfile } from './model.js';

export const DEFAULT_PRIMARY_PROFILE_ID = 'default-primary';

export class AgentProfileService {
  constructor(private readonly store: AgentProfileStore) {}

  async ensureDefaultPrimary(): Promise<AgentProfile> {
    const existing = await this.store.get(DEFAULT_PRIMARY_PROFILE_ID);
    if (existing) return existing;
    const now = new Date();
    const profile: AgentProfile = {
      agentProfileId: DEFAULT_PRIMARY_PROFILE_ID,
      name: 'Primary Agent',
      createdAt: now,
      updatedAt: now,
    };
    await this.store.save(profile);
    return (await this.store.get(DEFAULT_PRIMARY_PROFILE_ID)) ?? profile;
  }

  get(agentProfileId: string): Promise<AgentProfile | null> {
    return this.store.get(agentProfileId);
  }

  list(): Promise<AgentProfile[]> {
    return this.store.list();
  }
}
