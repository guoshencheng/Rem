import type { AgentRuntimeState, AgentStateProvider } from '../../../sdk/agent-state-provider.js';

export class InMemoryAgentStateProvider implements AgentStateProvider {
  private states = new Map<string, AgentRuntimeState>();

  async getState(sessionId: string): Promise<AgentRuntimeState> {
    return this.states.get(sessionId) ?? { pendingApprovals: [] };
  }

  async setState(sessionId: string, state: AgentRuntimeState): Promise<void> {
    this.states.set(sessionId, state);
  }
}
