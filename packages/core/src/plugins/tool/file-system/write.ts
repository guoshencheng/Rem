import { Type, type Static } from '@sinclair/typebox';
import {
  mkdir as fsMkdir,
  readFile as fsReadFile,
  stat as fsStat,
  writeFile as fsWriteFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import type { FileMutationQueue } from './shared/file-mutation-queue.js';
import { resolveWorkspacePath } from '../../../security/workspace-root-guard.js';
import type { ToolDefinition, ToolExecutor, ToolContext } from '../../../sdk/tool-provider.js';

const writeSchema = Type.Object(
  {
    path: Type.String({ description: 'Path to the file to write (relative or absolute)' }),
    content: Type.String({ description: 'Content to write to the file' }),
  },
  { additionalProperties: false },
);

export type WriteToolInput = Static<typeof writeSchema>;

interface WriteToolFileStat {
  type: 'file' | 'directory' | 'other';
  size: number;
  mtimeMs?: number;
}

type WriteToolPrecheck = {
  state: 'different' | 'same' | 'unknown';
  beforeStat?: WriteToolFileStat | null;
};

const WRITE_PRECHECK_READ_LIMIT_BYTES = 1024 * 1024;

async function statFile(absolutePath: string): Promise<WriteToolFileStat | null> {
  try {
    const stat = await fsStat(absolutePath);
    return {
      type: stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other',
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function readOriginalWriteState(
  absolutePath: string,
  content: string,
): Promise<WriteToolPrecheck> {
  const stat = await statFile(absolutePath);
  if (!stat) return { state: 'different' };

  if (stat.size === Buffer.byteLength(content) && stat.size <= WRITE_PRECHECK_READ_LIMIT_BYTES) {
    const originalText = await fsReadFile(absolutePath, 'utf8');
    return { state: originalText === content ? 'same' : 'different', beforeStat: stat };
  }

  return { state: stat.size === Buffer.byteLength(content) ? 'same' : 'different', beforeStat: stat };
}

function didWriteMetadataChange(before: WriteToolFileStat | null | undefined, after: WriteToolFileStat | null): boolean {
  if (!before || !after) return true;
  return before.size !== after.size || before.mtimeMs !== after.mtimeMs;
}

function isWriteRecoveryCandidate(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  if (error instanceof Error && /timeout/i.test(error.message)) return true;
  return false;
}

async function recoverSuccessfulWrite(params: {
  absolutePath: string;
  content: string;
  error: unknown;
  precheck: WriteToolPrecheck;
  signal: AbortSignal | undefined;
}): Promise<string | null> {
  if (!isWriteRecoveryCandidate(params.error, params.signal)) return null;
  const readback = await fsReadFile(params.absolutePath, 'utf8').catch(() => undefined);
  if (readback !== params.content) return null;
  const changed =
    params.precheck.state === 'different' ||
    (params.precheck.state === 'unknown' &&
      didWriteMetadataChange(params.precheck.beforeStat, await statFile(params.absolutePath)));
  if (!changed) return null;
  return `Successfully wrote ${params.content.length} bytes to ${params.absolutePath}`;
}

export function createWriteToolDefinition(): ToolDefinition<typeof writeSchema> {
  return {
    name: 'write',
    description: 'Write content to a file. Creates parent directories as needed.',
    parameters: writeSchema,
    category: 'filesystem',
    dangerous: true,
  };
}

export function createWriteToolExecutor(queue: FileMutationQueue): ToolExecutor<typeof writeSchema> {
  return async (input: WriteToolInput, ctx: ToolContext) => {
    if (ctx.readOnly) {
      throw new Error('write is disabled in read-only mode');
    }

    const absolutePath = resolveWorkspacePath(input.path, ctx);
    const dir = dirname(absolutePath);

    return queue.withQueue(absolutePath, async () => {
      const precheck = await readOriginalWriteState(absolutePath, input.content);
      if (precheck.state === 'same') {
        return { output: `File ${input.path} already up to date` };
      }

      try {
        await fsMkdir(dir, { recursive: true });
        await fsWriteFile(absolutePath, input.content, 'utf8');
        return { output: `Successfully wrote ${input.content.length} bytes to ${input.path}` };
      } catch (error) {
        const recovered = await recoverSuccessfulWrite({
          absolutePath,
          content: input.content,
          error,
          precheck,
          signal: ctx.signal,
        });
        if (recovered) return { output: recovered };
        throw error;
      }
    });
  };
}
