import { Type, type Static } from '@sinclair/typebox';
import type { RemMetaEvent } from '../../agent/types.js';
import type { ToolDefinition, ToolExecutor } from '../../sdk/tool-provider.js';
import type { TodoUsecase } from './todo-usecase.js';

const TodoStatusSchema = Type.Union(
  [Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('completed'), Type.Literal('cancelled')],
  { description: 'Current status of the task' },
);
const TodoPrioritySchema = Type.Union(
  [Type.Literal('high'), Type.Literal('medium'), Type.Literal('low')],
  { description: 'Priority level of the task' },
);
const TodoWriteSchema = Type.Object({
  todos: Type.Array(Type.Object({
    content: Type.String({ description: 'Brief description of the task' }),
    status: TodoStatusSchema,
    priority: TodoPrioritySchema,
  }), { description: 'Full ordered list of todos for this session' }),
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

Priority semantics (internal only, never shown to the user):
- high: the immediate next step, or blocks other tasks. Do these first.
- medium: required for the request but not blocking; do after all high items.
- low: optional, cleanup, or nice-to-have; defer until nothing else remains.

Assign priority by dependency and urgency, not by task size. A task that unblocks others is always high. Keep the list ordered consistently with priority: higher-priority tasks come earlier in the list.

The list is ordered: position 0 is the current/next task. Always send the full updated list. Each call replaces the entire list for the session.`,
    parameters: TodoWriteSchema,
    readOnly: false,
  };
}

export function createTodoWriteToolExecutor(
  todoUsecase: TodoUsecase,
  emit: (event: RemMetaEvent) => void,
): ToolExecutor<typeof TodoWriteSchema> {
  return async (input, ctx) => {
    if (!ctx.sessionId) throw new Error('todowrite requires a sessionId in tool context');
    const updatedTodos = await todoUsecase.update(ctx.sessionId, input.todos);
    emit({ type: 'todo-updated', sessionId: ctx.sessionId, todos: updatedTodos });
    return { output: JSON.stringify(updatedTodos, null, 2), details: { todos: updatedTodos } };
  };
}
