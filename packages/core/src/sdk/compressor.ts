import type { ModelMessage } from '../types.js';
import type { Session } from '../session.js';

export interface ContextCompressor {
  shouldCompress(session: Session): boolean;
  compress(messages: ModelMessage[]): Promise<ModelMessage[]>;
}
