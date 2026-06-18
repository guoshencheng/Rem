import { Type, type Static } from '@sinclair/typebox';
import { constants } from 'node:fs';
import { access as fsAccess, readFile as fsReadFile, writeFile as fsWriteFile } from 'node:fs/promises';
import {
  applyEditsToNormalizedContent,
  computeEditsDiff,
  detectLineEnding,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
  type Edit,
} from './edit-diff.js';
import { withFileMutationQueue } from './shared/file-mutation-queue.js';
import { resolveWorkspacePath } from '../../security/workspace-root-guard.js';
import type { ToolDefinition, ToolExecutor, ToolContext } from '../../sdk/tool-provider.js';

const replaceEditSchema = Type.Object(
  {
    oldText: Type.String({
      description:
        'Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.',
    }),
    newText: Type.String({ description: 'Replacement text for this targeted edit.' }),
  },
  { additionalProperties: false },
);

const editSchema = Type.Object(
  {
    path: Type.String({ description: 'Path to the file to edit (relative or absolute)' }),
    edits: Type.Array(replaceEditSchema, {
      description:
        'One or more targeted replacements. Each edit is matched against the original file, not incrementally.',
    }),
  },
  { additionalProperties: false },
);

export type EditToolInput = Static<typeof editSchema>;

const EDIT_MISMATCH_MESSAGE = 'Could not find the exact text in';
const EDIT_MISMATCH_HINT_LIMIT = 800;

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

function removeExactOccurrences(content: string, needle: string): string {
  return needle.length > 0 ? content.split(needle).join('') : content;
}

function didEditLikelyApply(params: {
  originalContent: string;
  currentContent: string;
  edits: Edit[];
}): boolean {
  if (params.edits.length === 0) return false;
  const normalizedOriginal = normalizeToLF(params.originalContent);
  const normalizedCurrent = normalizeToLF(params.currentContent);
  if (normalizedOriginal === normalizedCurrent) return false;

  let withoutInsertedNewText = normalizedCurrent;
  for (const edit of params.edits) {
    const normalizedNew = normalizeToLF(edit.newText);
    if (normalizedNew.length > 0 && !normalizedCurrent.includes(normalizedNew)) return false;
    withoutInsertedNewText = removeExactOccurrences(withoutInsertedNewText, normalizedNew);
  }

  return params.edits.every((edit) => !withoutInsertedNewText.includes(normalizeToLF(edit.oldText)));
}

function appendMismatchHint(error: Error, currentContent: string): Error {
  const snippet =
    currentContent.length <= EDIT_MISMATCH_HINT_LIMIT
      ? currentContent
      : `${currentContent.slice(0, EDIT_MISMATCH_HINT_LIMIT)}\n... (truncated)`;
  const enhanced = new Error(`${error.message}\nCurrent file contents:\n${snippet}`, {
    cause: error,
  });
  enhanced.stack = error.stack;
  return enhanced;
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

export function createEditToolExecutor(): ToolExecutor<typeof editSchema> {
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

    return withFileMutationQueue(absolutePath, async () => {
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
