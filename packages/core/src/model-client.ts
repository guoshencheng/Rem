import type { Message, LLMResponse, ToolDefinition } from './types.js';

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
}

export interface ModelClient {
  chat(messages: Message[], options?: ChatOptions): Promise<LLMResponse>;
}
