import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition, ToolExecutor, ToolContext } from '../../../sdk/tool-provider.js';
import type { Rule } from '../../../security/rules/rule.js';
import { createFileMutationQueue, type FileMutationQueue } from './shared/file-mutation-queue.js';
import { parsePatchText } from './apply-patch-parser.js';
import { executePatchOperations } from './apply-patch-executor.js';

const applyPatchSchema = Type.Object(
  {
    patchText: Type.String({ description: 'Patch in OpenAI envelope format' }),
  },
  { additionalProperties: false },
);

export type ApplyPatchToolInput = Static<typeof applyPatchSchema>;

export function createApplyPatchToolDefinition(): ToolDefinition<typeof applyPatchSchema> {
  return {
    name: 'apply_patch',
    description: 'Apply a file patch to add, update, move, or delete files in the workspace.',
    parameters: applyPatchSchema,
    category: 'filesystem',
    readOnly: false,
  };
}

export function createApplyPatchToolExecutor(queue: FileMutationQueue = createFileMutationQueue()): ToolExecutor<typeof applyPatchSchema> {
  return async (input: ApplyPatchToolInput, ctx: ToolContext) => {
    if (ctx.readOnly) {
      throw new Error('apply_patch is not allowed in read-only mode');
    }

    const operations = parsePatchText(input.patchText);
    const changed = await executePatchOperations(operations, ctx, queue);

    if (changed.length === 0) {
      return { output: '(no changes applied)' };
    }
    return { output: changed.join('\n') };
  };
}

export function deriveApplyPatchPatterns(): string[] {
  return ['file:*'];
}

export function deriveApplyPatchAlwaysOptions(): Array<{ label: string; rule: Omit<Rule, 'source'> }> {
  return [
    { label: 'files', rule: { permission: 'apply_patch', pattern: '*', action: 'allow' } },
  ];
}
