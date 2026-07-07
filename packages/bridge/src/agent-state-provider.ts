import type { AgentLiveProvider, AgentStateProvider } from 'rem-agent-core';
import { AgentLiveState } from 'rem-agent-core';

export class BridgeAgentLiveProvider implements AgentLiveProvider {
  private store = new Map<string, AgentLiveState>();

  async get(sessionId: string): Promise<AgentLiveState | undefined> {
    return this.store.get(sessionId);
  }

  async set(sessionId: string, state: AgentLiveState): Promise<void> {
    this.store.set(sessionId, state);
  }
}

/** @deprecated Use BridgeAgentLiveProvider */
export const BridgeAgentStateProvider = BridgeAgentLiveProvider;
