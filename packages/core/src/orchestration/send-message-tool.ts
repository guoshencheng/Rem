import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition, ToolExecutor } from '../sdk/tool-provider.js';
import type { AgentOrchestrationActions } from './orchestration-actions.js';

const SendMessageSchema = Type.Object({
  to: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  content: Type.String({ minLength: 1 }),
}, { additionalProperties: false });

export type SendMessageToolInput = Static<typeof SendMessageSchema>;

export function createSendMessageToolDefinition(): ToolDefinition<typeof SendMessageSchema> {
  return { name: 'send_message', description: 'Send one public message to one or more agents in the current team.',
    parameters: SendMessageSchema, readOnly: false };
}

export function createSendMessageToolExecutor(
  actions: AgentOrchestrationActions,
): ToolExecutor<typeof SendMessageSchema> {
  return async (input) => {
    const toAgentIds = [...new Set(input.to.map((id) => id.trim()).filter(Boolean))];
    const content = input.content.trim();
    if (toAgentIds.length === 0) throw new Error('send_message requires at least one target');
    if (!content) throw new Error('send_message content cannot be empty');
    const result = await actions.sendMessage({ toAgentIds, content });
    return { output: JSON.stringify({ queued: true, ...result }), details: result };
  };
}
