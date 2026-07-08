import { Type, type Static } from '@sinclair/typebox';
import {
  access as fsAccess,
  readdir as fsReaddir,
  stat as fsStat,
} from 'node:fs/promises';
import nodePath from 'node:path';
import { normalizePositiveLimit } from './shared/limits.js';
import { DEFAULT_MAX_BYTES, formatSize, truncateHead } from './shared/truncate.js';
import { resolveWorkspacePath } from '../../../security/workspace-root-guard.js';
import type { ToolDefinition, ToolExecutor, ToolContext } from '../../../sdk/tool-provider.js';

const lsSchema = Type.Object(
  {
    path: Type.Optional(Type.String({ description: 'Directory to list (default: current directory)' })),
    limit: Type.Optional(Type.Number({ description: 'Maximum number of entries to return (default: 500)' })),
  },
  { additionalProperties: false },
);

export type LsToolInput = Static<typeof lsSchema>;

const DEFAULT_LIMIT = 500;

export interface LsOperations {
  exists: (absolutePath: string) => Promise<boolean>;
  stat: (absolutePath: string) => Promise<{ isDirectory: () => boolean }>;
  readdir: (absolutePath: string) => Promise<string[]>;
}

const defaultLsOperations: LsOperations = {
  exists: async (absolutePath: string) => {
    try {
      await fsAccess(absolutePath);
      return true;
    } catch {
      return false;
    }
  },
  stat: async (absolutePath: string) => {
    const stat = await fsStat(absolutePath);
    return { isDirectory: () => stat.isDirectory() };
  },
  readdir: fsReaddir,
};

export function createLsToolDefinition(): ToolDefinition<typeof lsSchema> {
  return {
    name: 'ls',
    description: `List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Output is truncated to ${DEFAULT_LIMIT} entries or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    parameters: lsSchema,
    category: 'filesystem',
    readOnly: true,
  };
}

export function createLsToolExecutor(
  operations: LsOperations = defaultLsOperations,
): ToolExecutor<typeof lsSchema> {
  return async (input: LsToolInput, ctx: ToolContext) => {
    const dirPath = resolveWorkspacePath(input.path || '.', ctx);
    const effectiveLimit = normalizePositiveLimit(input.limit, DEFAULT_LIMIT);

    if (!(await operations.exists(dirPath))) {
      throw new Error(`Path not found: ${dirPath}`);
    }
    if (!(await operations.stat(dirPath)).isDirectory()) {
      throw new Error(`Not a directory: ${dirPath}`);
    }

    let entries: string[];
    try {
      entries = await operations.readdir(dirPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot read directory: ${message}`);
    }

    entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    const results: string[] = [];
    let entryLimitReached = false;
    for (const entry of entries) {
      if (results.length >= effectiveLimit) {
        entryLimitReached = true;
        break;
      }

      const fullPath = nodePath.join(dirPath, entry);
      let suffix = '';
      try {
        if ((await operations.stat(fullPath)).isDirectory()) suffix = '/';
      } catch {
        continue;
      }
      results.push(entry + suffix);
    }

    if (results.length === 0) {
      return { output: '(empty directory)' };
    }

    const rawOutput = results.join('\n');
    const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER, maxBytes: DEFAULT_MAX_BYTES });
    let output = truncation.content;

    const notices: string[] = [];
    if (entryLimitReached) {
      notices.push(`${effectiveLimit} entries limit reached. Use limit=${effectiveLimit * 2} for more`);
    }
    if (truncation.truncated) {
      notices.push(`${formatSize(DEFAULT_MAX_BYTES)} size limit reached`);
    }
    if (notices.length > 0) {
      output += `\n\n[${notices.join('. ')}]`;
    }

    return { output };
  };
}
