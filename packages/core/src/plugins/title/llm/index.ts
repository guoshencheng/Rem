import type { TitleProvider } from '../../../sdk/title-provider.js';
import type { ModelMessage } from '../../../types.js';
import { InferenceEngine } from '../../../llm/engine.js';
import { resolveProvider } from '../../../llm/api-registry.js';

export class LLMTitleProvider implements TitleProvider {
  async generateTitle(
    conversation: ModelMessage[],
    config: { provider: string; providerConfig: { model: string; apiKey: string; baseURL?: string } },
  ): Promise<string | undefined> {
    const userMessages = conversation.filter(m => m.role === 'user');
    if (userMessages.length === 0) return undefined;

    const messages = userMessages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));

    const provider = resolveProvider(config.provider);
    const rawStream = provider.stream({
      model: config.providerConfig.model,
      apiKey: config.providerConfig.apiKey,
      baseURL: config.providerConfig.baseURL,
      system: 'Generate a concise title (10 words or fewer) summarizing the conversation topic based on the user messages below.',
      messages,
      maxTokens: 50,
      temperature: 0.3,
      tools: {
        set_title: {
          description: 'Set the conversation title',
          parameters: {
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
          },
        },
      },
    });

    const engine = new InferenceEngine();
    try {
      const result = await engine.infer({
        messages,
        stream: rawStream,
      });

      const tc = result.toolCalls.find(t => t.toolName === 'set_title');
      let title = ((tc?.input as Record<string, unknown>)?.title as string ?? '').trim().slice(0, 80);
      if (!title) {
        title = result.text.trim().slice(0, 80);
      }
      if (!title && result.reasoning) {
        title = result.reasoning.trim().slice(0, 80);
      }
      return title || undefined;
    } catch {
      return undefined;
    }
  }
}

export function createProvider(options: unknown): LLMTitleProvider {
  return new LLMTitleProvider();
}
