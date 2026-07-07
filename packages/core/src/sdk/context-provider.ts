import type { ModelMessage } from '../types.js';
import type { AgentState } from '../state.js';

export interface ContextProvider {
  build(state: AgentState): Promise<{ system: string; messages: ModelMessage[] }>;
}
