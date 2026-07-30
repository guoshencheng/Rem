import type { Message } from '@earendil-works/pi-ai';
import type { Session } from '../session/model.js';
import type { ContextProvider } from './context-provider.js';

/** @deprecated Use ContextProvider instead */
export interface MemoryContext {
  systemPrompt: string;
  messages: Message[];
}

/** @deprecated Use ContextProvider instead */
export interface MemoryProvider extends ContextProvider {
  buildContext(session: Session, agentName: string): Promise<MemoryContext>;
}
