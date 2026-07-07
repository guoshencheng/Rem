import type { ModelMessage } from '../types.js';
import type { Session } from '../session.js';
import type { ContextProvider } from './context-provider.js';

/** @deprecated Use ContextProvider instead */
export interface MemoryContext {
  systemPrompt: string;
  messages: ModelMessage[];
}

/** @deprecated Use ContextProvider instead */
export interface MemoryProvider extends ContextProvider {
  buildContext(session: Session, agentName: string): Promise<MemoryContext>;
}
