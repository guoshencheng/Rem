import type { ModelMessage } from '../types.js';
import type { AgentState } from '../state.js';

export interface MemoryContext {
  systemPrompt: string;
  messages: ModelMessage[];
}

export interface MemoryProvider {
  buildContext(state: AgentState): Promise<MemoryContext>;
}
