import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition, ToolExecutor } from '../sdk/tool-provider.js';

const schema = Type.Object({
  task: Type.String({ minLength: 1, description: 'Task to run in an inline delegated node.' }),
  systemPrompt: Type.Optional(Type.String({ description: 'Optional system prompt override.' })),
  maxTurns: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
}, { additionalProperties: false });

export type RuntimeDelegateTaskInput = Static<typeof schema>;
export type RuntimeDelegateTaskExecutor = ToolExecutor<typeof schema>;

export function createRuntimeDelegateTaskTool(executor: RuntimeDelegateTaskExecutor): {
  definition: ToolDefinition<typeof schema>;
  executor: RuntimeDelegateTaskExecutor;
} {
  return {
    definition: {
      name: 'delegate_task',
      description: 'Run a bounded one-shot child agent inside the current Run.',
      parameters: schema,
      sideEffect: 'none',
      supportsIdempotencyKey: true,
      readOnly: true,
    },
    executor,
  };
}
