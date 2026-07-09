import type { TitleProvider } from '../../../sdk/title-provider.js';
import type { ConfigProvider } from '../../../sdk/config-provider.js';
import type { ModelMessage } from '../../../types.js';
import type { ToolSchema } from '../../../llm/types.js';
import { resolveProvider } from '../../../llm/api-registry.js';

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

const TITLE_TOOL: ToolSchema = {
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
        maxTokens: 100,
        temperature: 0.3,
        tools: { set_title: TITLE_TOOL },
      });

      const titleCall = result.toolCalls.find(tc => tc.toolName === 'set_title');
      if (titleCall?.input && typeof titleCall.input === 'object' && 'title' in titleCall.input) {
        const title = String(titleCall.input.title).trim().slice(0, 50);
        return title || undefined;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
}
