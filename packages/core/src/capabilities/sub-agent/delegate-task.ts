import { Type, type Static } from '@sinclair/typebox';
import type { ToolContext, ToolDefinition, ToolExecutor } from '../../sdk/tool-provider.js';
import type { RunDelegation } from '../../delegation/types.js';
import { formatTaskResult } from './format-task-result.js';

const delegateTaskSchema = Type.Object(
  {
    task: Type.String({ description: 'Task description to delegate to the sub-agent.' }),
    systemPrompt: Type.Optional(Type.String({ description: 'Optional system prompt override for the sub-agent.' })),
    maxTurns: Type.Optional(Type.Number({ description: 'Optional max turns for the sub-agent.' })),
  },
  { additionalProperties: false },
);

export type DelegateTaskInput = Static<typeof delegateTaskSchema>;

export function createDelegateTaskToolDefinition(): ToolDefinition<typeof delegateTaskSchema> {
  return {
    name: 'delegate_task',
    description: 'Delegate an independent task to a sub-agent. The sub-agent runs in its own session, inherits the current model and tools, and returns the result when completed.',
    parameters: delegateTaskSchema,
    readOnly: false,
  };
}

export function createDelegateTaskExecutor(
  runDelegation: RunDelegation,
): ToolExecutor<typeof delegateTaskSchema> {
  return async (input: DelegateTaskInput, toolCtx: ToolContext) => {
    try {
      const result = await runDelegation(input, toolCtx);
      return {
        output: formatTaskResult({
          childSessionId: result.childSessionId,
          task: input.task,
          content: result.content,
          failed: result.status !== 'completed',
        }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        output: formatTaskResult({
          childSessionId: '',
          task: input.task,
          content: message,
          failed: true,
        }),
      };
    }
  };
}
