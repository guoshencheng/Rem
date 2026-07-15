import type { Message } from '@earendil-works/pi-ai';

export const SUMMARY_SYSTEM_PROMPT = `You are a context summarization assistant for coding sessions.

Summarize only the conversation history you are given. The newest turns may be kept verbatim outside your summary, so focus on the older context that still matters for continuing the work.

Always use the submit_summary tool to return your summary. Keep every section, preserve exact file paths and identifiers when known, and prefer terse bullets over paragraphs.

Do not answer the conversation itself. Do not mention that you are summarizing or compacting context. Respond in the same language as the conversation.`;

export const SUMMARY_TOOL_NAME = 'submit_summary';

export const SUMMARY_TOOL_SCHEMA = {
  description: 'Submit a structured summary of the conversation history',
  parameters: {
    type: 'object',
    properties: {
      objective: {
        type: 'string',
        description: 'One or two brief sentences describing what the user is trying to accomplish',
      },
      importantDetails: {
        type: 'array',
        items: { type: 'string' },
        description: 'Constraints/preferences, decisions and why, important facts/assumptions, exact context needed to continue',
      },
      completed: {
        type: 'array',
        items: { type: 'string' },
        description: 'Finished work, verified facts, or changes made',
      },
      active: {
        type: 'array',
        items: { type: 'string' },
        description: 'Current work, partial changes, or investigation state',
      },
      blocked: {
        type: 'array',
        items: { type: 'string' },
        description: 'Blockers, failing commands, or unknowns',
      },
      nextMove: {
        type: 'array',
        items: { type: 'string' },
        description: 'Immediate concrete actions, in priority order',
      },
      relevantFiles: {
        type: 'array',
        items: { type: 'string' },
        description: 'File or directory paths and why they matter',
      },
    },
    required: ['objective', 'importantDetails', 'completed', 'active', 'blocked', 'nextMove', 'relevantFiles'],
  },
} as const;

export interface SummaryData {
  objective: string;
  importantDetails: string[];
  completed: string[];
  active: string[];
  blocked: string[];
  nextMove: string[];
  relevantFiles: string[];
}

export function buildSummaryPrompt(middle: Message[]): string {
  return `Summarize the following conversation history using the ${SUMMARY_TOOL_NAME} tool.\n\nConversation history to summarize:\n\n${serializeMessages(middle)}`;
}

export function formatSummaryAsMarkdown(data: SummaryData): string {
  const lines: string[] = [];
  lines.push('## Objective');
  lines.push(`- ${data.objective}`);
  lines.push('');
  lines.push('## Important Details');
  for (const item of data.importantDetails) {
    lines.push(`- ${item}`);
  }
  lines.push('');
  lines.push('## Work State');
  lines.push('### Completed');
  for (const item of data.completed) {
    lines.push(`- ${item}`);
  }
  lines.push('');
  lines.push('### Active');
  for (const item of data.active) {
    lines.push(`- ${item}`);
  }
  lines.push('');
  lines.push('### Blocked');
  for (const item of data.blocked) {
    lines.push(`- ${item}`);
  }
  lines.push('');
  lines.push('## Next Move');
  for (let i = 0; i < data.nextMove.length; i++) {
    lines.push(`${i + 1}. ${data.nextMove[i]}`);
  }
  lines.push('');
  lines.push('## Relevant Files');
  for (const item of data.relevantFiles) {
    lines.push(`- ${item}`);
  }
  return lines.join('\n');
}

function serializeMessages(messages: Message[]): string {
  return messages
    .map((msg) => {
      const content = typeof msg.content === 'string' ? [msg.content] : msg.content;
      const text = content
        .filter((p): p is { type: 'text'; text: string } => typeof p === 'object' && p.type === 'text')
        .map((p) => p.text)
        .join('\n');
      const role =
        msg.role === 'user'
          ? 'User'
          : msg.role === 'assistant'
            ? 'Assistant'
            : 'Tool';
      return `[${role}]: ${text}`;
    })
    .join('\n\n');
}
