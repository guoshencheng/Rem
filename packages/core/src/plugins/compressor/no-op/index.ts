import type { ContextCompressor } from '../../../sdk/compressor.js';
import type { ModelMessage } from '../../../types.js';
import type { Session } from '../../../session.js';

export class NoOpCompressor implements ContextCompressor {
  shouldCompress(): boolean {
    return false;
  }

  async compress(messages: ModelMessage[]): Promise<ModelMessage[]> {
    return messages;
  }
}

export function createProvider(): NoOpCompressor {
  return new NoOpCompressor();
}
