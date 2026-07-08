import { constants } from 'node:fs';
import { access as fsAccess, readFile as fsReadFile, writeFile as fsWriteFile } from 'node:fs/promises';
import {
  applyEditsToNormalizedContent,
  computeEditsDiff,
  detectLineEnding,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
} from './edit-diff.js';
import type { FileMutationQueue } from './shared/file-mutation-queue.js';
import { resolveWorkspacePath } from '../../../security/workspace-root-guard.js';
import type { ToolDefinition, ToolExecutor, ToolContext } from '../../../sdk/tool-provider.js';
import { type EditToolInput, editSchema } from './edit-schemas.js';
import {
  EDIT_MISMATCH_MESSAGE,
  didEditLikelyApply,
  appendMismatchHint,
} from './edit-recovery.js';

function prepareEditArguments(input: unknown): EditToolInput {
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid edit tool input');
  }

  const args = input as Record<string, unknown>;

  if (typeof args.edits === 'string') {
    try {
      const parsed = JSON.parse(args.edits);
      if (Array.isArray(parsed)) args.edits = parsed;
    } catch {}
  }

  if (
    typeof args.oldText === 'string' &&
    typeof args.newText === 'string'
  ) {
    const edits = Array.isArray(args.edits) ? [...args.edits] : [];
    edits.push({ oldText: args.oldText, newText: args.newText });
    return { ...(args as Omit<EditToolInput, 'edits'>), edits };
  }

  return args as EditToolInput;
}

export function createEditToolDefinition(): ToolDefinition<typeof editSchema> {
  return {
    name: 'edit',
    description:
      'Apply targeted text replacements to a file. Each oldText must be unique and non-overlapping.',
    parameters: editSchema,
    category: 'filesystem',
    dangerous: true,
  };
}

export function createEditToolExecutor(queue: FileMutationQueue): ToolExecutor<typeof editSchema> {
  return async (rawInput: EditToolInput, ctx: ToolContext) => {
    if (ctx.readOnly) {
      throw new Error('edit is disabled in read-only mode');
    }

    const input = prepareEditArguments(rawInput);
    if (!Array.isArray(input.edits) || input.edits.length === 0) {
      throw new Error('edit tool input is invalid. edits must contain at least one replacement.');
    }

    const absolutePath = resolveWorkspacePath(input.path, ctx);
    await fsAccess(absolutePath, constants.R_OK | constants.W_OK);

    return queue.withQueue(absolutePath, async () => {
      const originalBuffer = await fsReadFile(absolutePath);
      const originalContent = originalBuffer.toString('utf8');
      const bom = originalContent.startsWith('\uFEFF') ? '\uFEFF' : '';
      const withoutBom = stripBom(originalContent);
      const lineEnding = detectLineEnding(withoutBom);
      const normalized = normalizeToLF(withoutBom);

      let modifiedNormalized: string;
      try {
        modifiedNormalized = applyEditsToNormalizedContent(normalized, input.edits);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes(EDIT_MISMATCH_MESSAGE)
        ) {
          throw appendMismatchHint(error, originalContent);
        }
        throw error;
      }

      const modified = restoreLineEndings(modifiedNormalized, lineEnding);
      const finalContent = bom + modified;

      try {
        await fsWriteFile(absolutePath, finalContent, 'utf8');
      } catch (error) {
        const currentContent = await fsReadFile(absolutePath, 'utf8').catch(() => originalContent);
        if (didEditLikelyApply({ originalContent, currentContent, edits: input.edits })) {
          return { output: `Successfully edited ${input.path}` };
        }
        throw error;
      }

      const diffResult = computeEditsDiff(input.path, originalContent, input.edits);
      const details = 'diff' in diffResult ? diffResult : undefined;
      return {
        output: `Successfully edited ${input.path}`,
        details,
      };
    });
  };
}
