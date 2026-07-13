import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition, ToolExecutor, ToolContext } from '../../../sdk/tool-provider.js';
import type { LanguageModelUsage } from '../../../types.js';
import type { AgentContext } from '../../../agent-context.js';
import type { AgentState } from '../../../agent-state.js';
import type { BusEvent } from '../../../bus-events.js';
import { runAgent } from '../../../run-agent.js';
import { buildChildContext } from '../../../sub-agent/build-child-context.js';
import { formatTaskResult } from '../../../sub-agent/format-task-result.js';

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

export function createDelegateTaskToolExecutor(
  parentCtx: AgentContext,
  agentState: AgentState,
  workspace: string,
): ToolExecutor<typeof delegateTaskSchema> {
  return async (input: DelegateTaskInput, toolCtx: ToolContext) => {
    const parentSessionId = toolCtx.sessionId;
    if (!parentSessionId) {
      throw new Error('delegate_task requires a sessionId in tool context');
    }

    const childSession = await parentCtx.sessionProvider.create();
    const childSessionId = childSession.sessionId;
    childSession.metadata.parentSessionId = parentSessionId;
    childSession.metadata.workspace = workspace;
    childSession.metadata.title = input.task.slice(0, 50);
    await parentCtx.sessionProvider.save(childSession);

    const childCtx = buildChildContext(parentCtx, {
      maxTurns: input.maxTurns,
      systemPrompt: input.systemPrompt,
    });

    const run = runAgent({
      input: { content: input.task, timestamp: new Date() },
      sessionId: childSessionId,
      ctx: childCtx,
      agentState,
      workspace,
      workspaceRoot: toolCtx.workspaceRoot,
      signal: toolCtx.signal,
    });

    let failed = false;
    let lastTokenUsage: LanguageModelUsage | undefined;

    const handleChildEvent = (event: BusEvent) => {
      if (event.sessionId !== childSessionId) return;
      if (event.type === 'usage-change') {
        lastTokenUsage = event.usage;
      } else if (event.type === 'session-error') {
        failed = true;
      }
      if (event.type === 'usage-change' || event.type === 'activity-change') {
        agentState.publish({
          workspace,
          sessionId: parentSessionId,
          type: 'child-agent-update',
          childSessionId,
          summary: input.task,
          status: failed ? 'failed' : 'running',
          tokenUsage: lastTokenUsage,
        });
      }
    };

    const unsubscribe = agentState.subscribe(handleChildEvent);

    try {
      const output = await run.output;
      const childState = agentState.get(childSessionId);
      lastTokenUsage = childState?.tokenUsage ?? lastTokenUsage;

      const displayContent = output.content.startsWith('Error: ') ? output.content.slice('Error: '.length) : output.content;

      agentState.publish({
        workspace,
        sessionId: parentSessionId,
        type: 'child-agent-update',
        childSessionId,
        summary: input.task,
        status: failed ? 'failed' : 'completed',
        tokenUsage: lastTokenUsage,
      });
      return {
        output: formatTaskResult({
          childSessionId,
          task: input.task,
          content: displayContent,
          failed,
        }),
      };
    } catch (error) {
      failed = true;
      const message = error instanceof Error ? error.message : String(error);
      agentState.publish({
        workspace,
        sessionId: parentSessionId,
        type: 'child-agent-update',
        childSessionId,
        summary: input.task,
        status: 'failed',
        tokenUsage: lastTokenUsage,
      });
      return {
        output: formatTaskResult({
          childSessionId,
          task: input.task,
          content: message,
          failed: true,
        }),
      };
    } finally {
      unsubscribe();
    }
  };
}
