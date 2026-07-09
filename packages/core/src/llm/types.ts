import type { ModelMessage } from '../types.js';

export interface ToolSchema {
  description: string;
  parameters: Record<string, unknown>;
}

export type ToolSet = Record<string, ToolSchema>;

export interface ProviderConfig {
  model: string;
  apiKey: string;
  baseURL?: string;
}

export interface GenerateOptions extends ProviderConfig {
  system?: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** OpenAI-style response_format for structured output */
  responseFormat?: {
    type: 'json_schema' | 'json_object';
    json_schema?: {
      name: string;
      schema: Record<string, unknown>;
      strict?: boolean;
    };
  };
}

export interface GenerateResult {
  text: string;
  reasoning?: string;
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    input: unknown;
  }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    inputTokenDetails?: {
      noCacheTokens?: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    };
    outputTokenDetails?: {
      textTokens?: number;
      reasoningTokens?: number;
    };
  };
  finishReason?: string;
}

export type StreamChunk =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | {
      type: 'usage';
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      inputTokenDetails?: {
        noCacheTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
      };
      outputTokenDetails?: {
        textTokens?: number;
        reasoningTokens?: number;
      };
    }
  | { type: 'finish'; reason: string };
