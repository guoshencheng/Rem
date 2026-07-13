import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition, ToolExecutor, ToolContext } from '../../../sdk/tool-provider.js';
import type { TodoService } from '../../../todo/service.js';
import type { BusEvent } from '../../../bus-events.js';

const TodoStatusSchema = Type.Union(
  [
    Type.Literal('pending'),
    Type.Literal('in_progress'),
    Type.Literal('completed'),
    Type.Literal('cancelled'),
  ],
  { description: 'Current status of the task' },
);

const TodoPrioritySchema = Type.Union(
  [
    Type.Literal('high'),
    Type.Literal('medium'),
    Type.Literal('low'),
  ],
  { description: 'Priority level of the task' },
);

const TodoItemSchema = Type.Object({
  content: Type.String({ description: 'Brief description of the task' }),
  status: TodoStatusSchema,
  priority: TodoPrioritySchema,
});

const TodoWriteSchema = Type.Object({
  todos: Type.Array(TodoItemSchema, { description: 'Full ordered list of todos for this session' }),
}, { additionalProperties: false });

export type TodoWriteInput = Static<typeof TodoWriteSchema>;

export function createTodoWriteToolDefinition(): ToolDefinition<typeof TodoWriteSchema> {
  return {
    name: 'todowrite',
    description: `Update the session's complete ordered todo list.

Use proactively when:
- The user asks for a multi-step task.
- You are starting work that has 3+ non-trivial steps.
- A new instruction arrives that changes the plan.
- You need to mark a task as completed, in_progress, or cancelled.

Skip when:
- The request is a single trivial step or a pure Q&A.

Status semantics:
- pending: waiting to be worked on.
- in_progress: the one task you are currently doing. Keep exactly one in_progress at a time.
- completed: only after verification, never based on intent.
- cancelled: no longer needed.

Priority semantics:
- high: do next / blocking.
- medium: normal priority.
- low: can be deferred.

The list is ordered: position 0 is the current/next task. Always send the full updated list.`,
    parameters: TodoWriteSchema,
    readOnly: false,
  };
}

export function createTodoWriteToolExecutor(
  todoService: TodoService,
  publish: (event: BusEvent) => void,
  workspace: string,
): ToolExecutor<typeof TodoWriteSchema> {
  return async (input, ctx) => {
    if (!ctx.sessionId) {
      throw new Error('todowrite requires a sessionId in tool context');
    }

    await todoService.update(ctx.sessionId, input.todos);

    publish({
      workspace,
      sessionId: ctx.sessionId,
      type: 'todo-updated',
      todos: input.todos,
    });

    return {
      output: JSON.stringify(input.todos, null, 2),
      details: { todos: input.todos },
    };
  };
}
