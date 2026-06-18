import { Type, type Static } from '@sinclair/typebox';
import { readFile as fsReadFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { access as fsAccess } from 'node:fs/promises';
import { resolveReadPath } from '../../security/workspace-root-guard.js';
import { normalizePositiveLimit } from './shared/limits.js';
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from './shared/truncate.js';
import { resolveWorkspacePath } from '../../security/workspace-root-guard.js';
import type { ToolDefinition, ToolExecutor, ToolContext } from '../../sdk/tool-provider.js';

const readSchema = Type.Object(
  {
    path: Type.String({ description: 'Path to the file to read (relative or absolute)' }),
    offset: Type.Optional(Type.Number({ description: 'Line number to start reading from (1-indexed)' })),
    limit: Type.Optional(Type.Number({ description: 'Maximum number of lines to read' })),
  },
  { additionalProperties: false },
);

export type ReadToolInput = Static<typeof readSchema>;

function quotePosixShellArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function readTextContent(
  absolutePath: string,
  offset: number | undefined,
  limit: number | undefined,
): Promise<string> {
  const text = await fsReadFile(absolutePath, 'utf8');
  const lines = text.split(/\r?\n/);
  const effectiveLimit = normalizePositiveLimit(limit, DEFAULT_MAX_LINES);

  if (offset !== undefined) {
    const startLine = Math.max(1, Math.floor(offset));
    if (startLine > lines.length) {
      throw new Error(`Offset ${startLine} is beyond end of file (${lines.length} lines total)`);
    }
    const startIndex = startLine - 1;
    const sliced = lines.slice(startIndex, startIndex + effectiveLimit);
    return sliced.join('\n');
  }

  if (lines.length > effectiveLimit) {
    return lines.slice(0, effectiveLimit).join('\n');
  }
  return text;
}

function isImageFile(_absolutePath: string): boolean {
  return false;
}

export function createReadToolDefinition(): ToolDefinition<typeof readSchema> {
  return {
    name: 'read',
    description: `Read a text file. Supports offset (1-indexed) and limit. Output is truncated to ${DEFAULT_MAX_LINES} lines and ${formatSize(DEFAULT_MAX_BYTES)}.`,
    parameters: readSchema,
    category: 'filesystem',
    readOnly: true,
  };
}

export function createReadToolExecutor(): ToolExecutor<typeof readSchema> {
  return async (input: ReadToolInput, ctx: ToolContext) => {
    const rawResolved = resolveReadPath(input.path, ctx.cwd);
    const absolutePath = resolveWorkspacePath(rawResolved, ctx);

    await fsAccess(absolutePath, constants.R_OK);

    if (isImageFile(absolutePath)) {
      const buffer = await fsReadFile(absolutePath);
      return {
        output: `[Image ${absolutePath}: ${buffer.byteLength} bytes]`,
      };
    }

    const text = await readTextContent(absolutePath, input.offset, input.limit);
    const truncation = truncateHead(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });

    let output = truncation.content;
    if (truncation.firstLineExceedsLimit) {
      const startLine = input.offset ?? 1;
      output = `[Line ${startLine} exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLine}p' ${quotePosixShellArg(absolutePath)} | head -c ${DEFAULT_MAX_BYTES}]`;
    }

    const notices: string[] = [];
    if (truncation.truncated && !truncation.firstLineExceedsLimit) {
      notices.push(`truncated to ${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)}`);
    }
    if (notices.length > 0) {
      output += `\n\n[${notices.join('. ')}]`;
    }

    return { output };
  };
}
