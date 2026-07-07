import type { ModelMessage, LanguageModelUsage, ProviderChunk } from '../types.js';
import type { ToolSet } from '../llm/types.js';

export interface ReasonParams {
  provider: string;
  model: string;
  apiKey: string;
  baseURL?: string;
  system?: string;
  messages: ModelMessage[];
  tools?: ToolSet;
}

export interface ReasonContext {
  signal?: AbortSignal;
  sessionId?: string;
}

export interface ReasonOutput {
  text: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>;
  reasoning?: string;
  usage: LanguageModelUsage;
  finishReason: string;
}

export interface ReasonProvider {
  reason(
    params: ReasonParams,
    ctx: ReasonContext,
    emit: (chunk: ProviderChunk) => void | Promise<void>,
  ): Promise<ReasonOutput>;
}
