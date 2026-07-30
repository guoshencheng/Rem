import type { Message } from '@earendil-works/pi-ai';
import type { Session } from '../session/model.js';

export interface ContextCompressor {
  shouldCompress(session: Session): boolean;
  compress(messages: Message[]): Promise<Message[]>;
}
