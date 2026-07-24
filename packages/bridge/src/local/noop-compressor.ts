import type { ContextCompressor, Message, Session } from 'rem-agent-core/browser';

export class NoopCompressor implements ContextCompressor {
  shouldCompress(_session: Session): boolean {
    return false;
  }

  async compress(messages: Message[]): Promise<Message[]> {
    return messages;
  }
}
