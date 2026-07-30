import type { Message } from '@earendil-works/pi-ai';
import type { Session } from '../session/model.js';

export interface ContextProvider {
  build(session: Session, agentName: string): Promise<{ system: string; messages: Message[] }>;
}
