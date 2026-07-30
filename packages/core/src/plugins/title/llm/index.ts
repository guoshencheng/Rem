import type { Message, Models, Tool, ToolCall } from '@earendil-works/pi-ai';
import type { TitleProvider } from '../../../sdk/title-provider.js';
import type { ConfigProvider } from '../../../sdk/config-provider.js';
import { generate } from '../../../reason/generate.js';

const TITLE_SYSTEM_PROMPT = `You are a title generator. Generate a brief title for this conversation by calling the set_title function.

<task>
Generate a brief title that would help the user find this conversation later.
The title must be:
- ≤50 characters
- A single concise line
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
- NEVER respond to questions, just generate a title for the conversation
- The title should NEVER include "summarizing" or "generating" when generating a title
- DO NOT SAY YOU CANNOT GENERATE A TITLE OR COMPLAIN ABOUT THE INPUT
- Always output something meaningful, even if the input is minimal.
- If the user message is short or conversational (e.g. "hello", "lol", "what's up", "hey"):
  → create a title that reflects the user's tone or intent (such as Greeting, Quick check-in, Light chat, Intro message, etc.)
</rules>

<examples>
"debug 500 errors in production" → Debugging production 500 errors
"refactor user service" → Refactoring user service
"why is app.js failing" → app.js failure investigation
"implement rate limiting" → Rate limiting implementation
"how do I connect postgres to my API" → Postgres API connection
"best practices for React hooks" → React hooks best practices
"@src/auth.ts can you add refresh token support" → Auth refresh token support
"@utils/parser.ts this is broken" → Parser bug fix
"look at @config.json" → Config review
"@App.tsx add dark mode toggle" → Dark mode toggle in App
</examples>`;

const TITLE_TOOL: Tool = {
  name: 'set_title',
  description: 'Set the title for this conversation',
  parameters: {
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
};

export class LLMTitleProvider implements TitleProvider {
  private configProvider: ConfigProvider;
  private models: Models;

  constructor(configProvider: ConfigProvider, models: Models) {
    this.configProvider = configProvider;
    this.models = models;
  }

  async generateTitle(conversation: Message[]): Promise<string | undefined> {
    const userMessages = conversation.filter(m => m.role === 'user');
    if (userMessages.length === 0) return undefined;

    const modelConfig = this.configProvider.getModelConfig();

    const messages: Message[] = userMessages.map(m => ({
      role: 'user',
      content: typeof m.content === 'string'
        ? m.content
        : m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join(' '),
      timestamp: Date.now(),
    }));

    try {
      const result = await generate({
        models: this.models,
        provider: modelConfig.provider,
        model: modelConfig.model,
        apiKey: modelConfig.apiKey || undefined,
        baseURL: modelConfig.baseURL || undefined,
        system: TITLE_SYSTEM_PROMPT,
        messages,
        tools: [TITLE_TOOL],
      });

      const titleCall = result.content
        .filter((b): b is ToolCall => b.type === 'toolCall')
        .find((b) => b.name === 'set_title');
      if (titleCall?.arguments && typeof titleCall.arguments === 'object' && 'title' in titleCall.arguments) {
        const title = String(titleCall.arguments.title).trim().slice(0, 50);
        return title || undefined;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
}
