import type { TitleProvider } from '../../../sdk/title-provider.js';
import type { ConfigProvider } from '../../../sdk/config-provider.js';
import type { ModelMessage } from '../../../types.js';
import { resolveProvider } from '../../../llm/api-registry.js';

export class LLMTitleProvider implements TitleProvider {
  private configProvider: ConfigProvider;

  constructor(configProvider: ConfigProvider) {
    this.configProvider = configProvider;
  }

  async generateTitle(conversation: ModelMessage[]): Promise<string | undefined> {
    const userMessages = conversation.filter(m => m.role === 'user');
    if (userMessages.length === 0) return undefined;

    const modelConfig = this.configProvider.getModelConfig();

    const messages = userMessages.map(m => ({
      role: m.role,
      content: [{ type: 'text', text: m.content.filter(p => p.type === 'text').map(p => p.text).join(' ') || JSON.stringify(m.content) }],
    })) as ModelMessage[];

    const provider = resolveProvider(modelConfig.provider);
    try {
      const result = await provider.generate({
        model: modelConfig.model,
        apiKey: modelConfig.apiKey,
        baseURL: modelConfig.baseURL,
        system: [
          'Generate a brief, concise title for this conversation.',
          'Use the same language as the user message.',
          'Title must be ≤50 characters, grammatically correct, and focused on the main topic.',
          'Never include tool names, "summarizing", or "generating" in the title.',
          'For short casual messages (hello, hey, etc.), use a human-sounding label like "Greeting" or "Quick chat".',
        ].join(' '),
        messages,
        maxTokens: 50,
        temperature: 0.3,
        responseFormat: {
          type: 'json_schema',
          json_schema: {
            name: 'conversation_title',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description: 'A brief, concise title (≤50 chars) summarizing the conversation topic',
                },
              },
              required: ['title'],
              additionalProperties: false,
            },
          },
        },
      });

      const parsed = JSON.parse(result.text) as { title?: string };
      const title = parsed.title?.trim().slice(0, 50);
      return title || undefined;
    } catch {
      return undefined;
    }
  }
}
