import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition, ToolExecutor } from '../sdk/tool-provider.js';
import type { AgentOrchestrationActions } from './orchestration-actions.js';

const FinishDiscussionSchema = Type.Object({
  answer: Type.String({ minLength: 1 }),
}, { additionalProperties: false });

export type FinishDiscussionInput = Static<typeof FinishDiscussionSchema>;

export function createFinishDiscussionToolDefinition(): ToolDefinition<typeof FinishDiscussionSchema> {
  return { name: 'finish_discussion', description: 'Finish the team discussion with the final user-facing answer.',
    parameters: FinishDiscussionSchema, readOnly: false };
}

export function createFinishDiscussionToolExecutor(
  actions: AgentOrchestrationActions,
): ToolExecutor<typeof FinishDiscussionSchema> {
  return async (input) => {
    const answer = input.answer.trim();
    if (!answer) throw new Error('finish_discussion answer cannot be empty');
    if (!actions.finishDiscussion) throw new Error('finish_discussion is only available to the Organizer');
    await actions.finishDiscussion(answer);
    return { output: JSON.stringify({ finishing: true }) };
  };
}
