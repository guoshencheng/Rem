import { Type, type Static } from '@sinclair/typebox';
import type { ToolContext, ToolDefinition, ToolExecutor } from '../../sdk/tool-provider.js';
import { formatTaskResult } from './format-task-result.js';
import type { REMAgent } from '../../rem-agent.js';

const delegateTaskSchema = Type.Object(
  {
    task: Type.String({ description: 'Task description to delegate to the sub-agent.' }),
    systemPrompt: Type.Optional(Type.String({ description: 'Optional system prompt override for the sub-agent.' })),
    maxTurns: Type.Optional(Type.Number({ description: 'Optional max turns for the sub-agent.' })),
  },
  { additionalProperties: false },
);

export type DelegateTaskInput = Static<typeof delegateTaskSchema>;

/** bridge 注入：创建 child session + 装配 child REMAgent */
export type SpawnChild = (input: DelegateTaskInput, toolCtx: ToolContext) => Promise<REMAgent>;

export function createDelegateTaskToolDefinition(): ToolDefinition<typeof delegateTaskSchema> {
  return {
    name: 'delegate_task',
    description: 'Delegate an independent task to a sub-agent. The sub-agent runs in its own session, inherits the current model and tools, and returns the result when completed.',
    parameters: delegateTaskSchema,
    readOnly: false,
  };
}

export interface DelegateTaskExecutorParams {
  /** 对象或延迟取值函数（装配期 parent 尚未构造时用后者） */
  parentAgent: REMAgent | (() => REMAgent);
  spawnChild: SpawnChild;
}

/** delegate_task executor：spawnChild 拿 child REMAgent 挂树（触发 child-spawned），drain 子事件流，等待 output 组装工具结果。子 Agent 出错不传染父 Agent。 */
export function createDelegateTaskExecutor(
  params: DelegateTaskExecutorParams,
): ToolExecutor<typeof delegateTaskSchema> {
  const resolveParent = (): REMAgent =>
    typeof params.parentAgent === 'function' ? params.parentAgent() : params.parentAgent;

  return async (input: DelegateTaskInput, toolCtx: ToolContext) => {
    const toolCallId = toolCtx.toolCallId ?? 'unknown';
    try {
      const child = await params.spawnChild(input, toolCtx);
      resolveParent().attachChild(child, toolCallId);

      const drain = (async () => {
        for await (const _event of child.run({ content: input.task, timestamp: new Date() })) {
          // 仅消费（AgentService 作为第二消费者同步 listen）
        }
      })();
      await drain;

      const output = (await child.output) ?? { content: '', completed: true };
      const failed = output.content.startsWith('Error: ');
      const displayContent = failed ? output.content.slice('Error: '.length) : output.content;
      return {
        output: formatTaskResult({
          childSessionId: child.sessionId ?? '',
          task: input.task,
          content: displayContent,
          failed,
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
