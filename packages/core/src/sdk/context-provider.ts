import type { ModelMessage } from '../types.js';
import type { Session } from '../session.js';

export interface ContextProvider {
  build(session: Session, agentName: string): Promise<{ system: string; messages: ModelMessage[] }>;
}
