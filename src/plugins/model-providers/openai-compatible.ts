import { OpenAI } from 'openai';
import type { Message, LLMResponse, ModelConfig, ToolDefinition } from '../../core/types.js';
import type { ChatOptions, ModelClient } from '../../core/model-client.js';

export class OpenAICompatibleClient implements ModelClient {
  private client: OpenAI;
  private model: string;

  constructor(config: ModelConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this.model = config.model;
  }

  async chat(messages: Message[], options: ChatOptions = {}): Promise<LLMResponse> {
    const formattedMessages = messages.map(m => ({
      role: m.role,
      content: m.content,
      tool_calls: m.toolCalls,
      tool_call_id: m.toolCallId,
    }));

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: formattedMessages as any,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
      tools: options.tools?.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
    });

    const choice = response.choices[0];
    const message = choice.message;

    return {
      content: message.content ?? '',
      toolCalls: message.tool_calls?.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      })),
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
    };
  }
}
