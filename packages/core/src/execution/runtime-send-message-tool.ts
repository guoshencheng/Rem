import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition, ToolExecutor } from '../sdk/tool-provider.js';

const schema = Type.Object({
  to: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 32 }),
  content: Type.String({ minLength: 1, maxLength: 100_000 }),
}, { additionalProperties: false });

export type RuntimeSendMessageInput = Static<typeof schema>;

export interface RuntimeSendMessageActions {
  sendMessage(input: RuntimeSendMessageInput, invocationId?: string): Promise<{ batchId: string }>;
}

export function createRuntimeSendMessageTool(actions: RuntimeSendMessageActions): {
  definition: ToolDefinition<typeof schema>;
  executor: ToolExecutor<typeof schema>;
} {
  return {
    definition: {
      name: 'send_message',
      description: 'Send one message to one or more other agents in this Team run.',
      parameters: schema,
      sideEffect: 'none',
      supportsIdempotencyKey: true,
      readOnly: true,
    },
    executor: async (input, context) => {
      const targets = input.to.map((target) => target.trim());
      if (targets.some((target) => target.length === 0)) return { output: '', error: 'Every target agent must be non-empty' };
      if (new Set(targets).size !== targets.length) return { output: '', error: 'Team targets must be unique' };
      try {
        const result = await actions.sendMessage({ to: targets, content: input.content }, context.invocationId);
        return { output: JSON.stringify(result) };
      } catch (error) {
        return { output: '', error: error instanceof Error ? error.message : 'Message delivery failed' };
      }
    },
  };
}
