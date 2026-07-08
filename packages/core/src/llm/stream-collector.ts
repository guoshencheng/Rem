import type { GenerateResult, StreamChunk } from './types.js';

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
        inputTokenDetails: chunk.inputTokenDetails,
        outputTokenDetails: chunk.outputTokenDetails,
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
