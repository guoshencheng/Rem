import type { AgentLiveProvider } from 'rem-agent-core';
import { AgentLiveState } from 'rem-agent-core';

export class BridgeAgentLiveProvider implements AgentLiveProvider {
  private store = new Map<string, AgentLiveState>();

  async get(sessionId: string): Promise<AgentLiveState | undefined> {
    return this.store.get(sessionId);
  }

  async getOrCreate(sessionId: string): Promise<AgentLiveState> {
    let state = this.store.get(sessionId);
    if (!state) {
      state = new AgentLiveState();
      this.store.set(sessionId, state);
    }
    return state;
  }

  async set(sessionId: string, state: AgentLiveState): Promise<void> {
    this.store.set(sessionId, state);
  }
}

/** @deprecated Use BridgeAgentLiveProvider */
export const BridgeAgentStateProvider = BridgeAgentLiveProvider;
