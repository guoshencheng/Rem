import type { ModelMessage } from '../types.js';
import type { AgentState } from '../state.js';

export interface ContextCompressor {
  shouldCompress(state: AgentState): boolean;
  compress(messages: ModelMessage[]): Promise<ModelMessage[]>;
}
