import type { Message, LLMResponse, ChatOptions, ModelClient } from '../../src/core/model-client.js';

export function createMockModelClient(
  response: LLMResponse = { content: 'Mock response' }
): ModelClient {
  return {
    chat: async (_messages: Message[], _options?: ChatOptions): Promise<LLMResponse> => response,
  };
}
