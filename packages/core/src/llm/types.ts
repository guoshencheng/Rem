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
  };
  finishReason?: string;
}

export type StreamChunk =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'usage'; inputTokens: number; outputTokens: number; totalTokens: number }
  | { type: 'finish'; reason: string };

export class StreamCollector {
  private text = '';
  private reasoningText = '';
  private toolCalls: GenerateResult['toolCalls'] = [];
  private usage: GenerateResult['usage'] = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  private finishReason?: string;

  feed(chunk: StreamChunk): void {
    if (chunk.type === 'text') {
      this.text += chunk.text;
    } else if (chunk.type === 'reasoning') {
      this.reasoningText += chunk.text;
    } else if (chunk.type === 'tool-call') {
      this.toolCalls.push({
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        input: chunk.input,
      });
    } else if (chunk.type === 'usage') {
      this.usage = {
        inputTokens: chunk.inputTokens,
        outputTokens: chunk.outputTokens,
        totalTokens: chunk.totalTokens,
      };
    } else if (chunk.type === 'finish') {
      this.finishReason = chunk.reason;
    }
  }

  result(): GenerateResult {
    return {
      text: this.text,
      reasoning: this.reasoningText || undefined,
      toolCalls: this.toolCalls,
      usage: this.usage,
      finishReason: this.finishReason,
    };
  }
}

export async function collectStream(stream: AsyncIterable<StreamChunk>): Promise<GenerateResult> {
  const collector = new StreamCollector();
  for await (const chunk of stream) {
    collector.feed(chunk);
  }
  return collector.result();
}
