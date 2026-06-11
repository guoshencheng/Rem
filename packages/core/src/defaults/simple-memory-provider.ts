import type { MemoryProvider, MemoryContext } from '../sdk/memory-provider.js';
import type { AgentState } from '../state.js';

export class SimpleMemoryProvider implements MemoryProvider {
  constructor(private agentName: string) {}

  async buildContext(state: AgentState): Promise<MemoryContext> {
    return {
      systemPrompt: `You are ${this.agentName}.`,
      messages: state.conversation,
    };
  }
}
