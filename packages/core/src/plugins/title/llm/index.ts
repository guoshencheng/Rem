import type { TitleProvider } from '../../../sdk/title-provider.js';
import type { ConfigProvider } from '../../../sdk/config-provider.js';
import type { ModelMessage } from '../../../types.js';
import { resolveProvider } from '../../../llm/api-registry.js';

const TITLE_SYSTEM_PROMPT = `You are a title generator. You output ONLY a JSON object with a "title" field. Nothing else.

<task>
Generate a brief title that would help the user find this conversation later.
Your output must be a JSON object: {"title": "..."}
- ≤50 characters
- No explanations
</task>

<rules>
- you MUST use the same language as the user message you are summarizing
- Title must be grammatically correct and read naturally - no word salad
- Never include tool names in the title (e.g. "read tool", "bash tool", "edit tool")
- Focus on the main topic or question the user needs to retrieve
- Vary your phrasing - avoid repetitive patterns like always starting with "Analyzing"
- When a file is mentioned, focus on WHAT the user wants to do WITH the file, not just that they shared it
- Keep exact: technical terms, numbers, filenames, HTTP codes
- Remove: the, this, my, a, an
- Never assume tech stack
- Never use tools
- NEVER respond to questions, just generate a title for the conversation
- The title should NEVER include "summarizing" or "generating" when generating a title
- DO NOT SAY YOU CANNOT GENERATE A TITLE OR COMPLAIN ABOUT THE INPUT
- Always output something meaningful, even if the input is minimal.
- If the user message is short or conversational (e.g. "hello", "lol", "what's up", "hey"):
  → create a title that reflects the user's tone or intent (such as Greeting, Quick check-in, Light chat, Intro message, etc.)
</rules>

<examples>
"debug 500 errors in production" → {"title": "Debugging production 500 errors"}
"refactor user service" → {"title": "Refactoring user service"}
"why is app.js failing" → {"title": "app.js failure investigation"}
"implement rate limiting" → {"title": "Rate limiting implementation"}
"how do I connect postgres to my API" → {"title": "Postgres API connection"}
"best practices for React hooks" → {"title": "React hooks best practices"}
"@src/auth.ts can you add refresh token support" → {"title": "Auth refresh token support"}
"@utils/parser.ts this is broken" → {"title": "Parser bug fix"}
"look at @config.json" → {"title": "Config review"}
"@App.tsx add dark mode toggle" → {"title": "Dark mode toggle in App"}
</examples>`;

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
        system: TITLE_SYSTEM_PROMPT,
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
