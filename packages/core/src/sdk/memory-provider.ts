import type { ModelMessage } from '../types.js';
import type { AgentState } from '../state.js';
import type { ContextProvider } from './context-provider.js';

/** @deprecated Use ContextProvider instead */
export interface MemoryContext {
  systemPrompt: string;
  messages: ModelMessage[];
}

/** @deprecated Use ContextProvider instead */
export interface MemoryProvider extends ContextProvider {
  buildContext(state: AgentState): Promise<MemoryContext>;
}
