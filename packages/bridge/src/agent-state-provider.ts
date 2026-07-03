import type { AgentStateProvider, AgentRuntimeState } from 'rem-agent-core';

export class BridgeAgentStateProvider implements AgentStateProvider {
  private states = new Map<string, AgentRuntimeState>();

  async getState(sessionId: string): Promise<AgentRuntimeState> {
    return this.states.get(sessionId) ?? { pendingApprovals: [] };
  }

  async setState(sessionId: string, state: AgentRuntimeState): Promise<void> {
    this.states.set(sessionId, state);
  }
}
