import type { Message } from '@earendil-works/pi-ai';
import type { ContextCompressor } from '../sdk/compressor.js';

export class NoOpRuntimeCompressor implements ContextCompressor {
  shouldCompress(): boolean { return false; }
  async compress(messages: Message[]): Promise<Message[]> { return messages.slice(); }
}
