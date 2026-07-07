import type { AgentLiveProvider } from '../../../sdk/agent-state-provider.js';
import type { AgentLiveState } from '../../../state.js';

export class InMemoryAgentLiveProvider implements AgentLiveProvider {
  private store = new Map<string, AgentLiveState>();

  async get(sessionId: string): Promise<AgentLiveState | undefined> {
    return this.store.get(sessionId);
  }

  async set(sessionId: string, state: AgentLiveState): Promise<void> {
    this.store.set(sessionId, state);
  }
}

/** @deprecated Use InMemoryAgentLiveProvider */
export const InMemoryAgentStateProvider = InMemoryAgentLiveProvider;
