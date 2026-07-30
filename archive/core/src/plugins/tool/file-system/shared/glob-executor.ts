import { glob } from 'glob';
import { relative } from 'node:path';
import { realpath } from 'node:fs/promises';
import { resolveWorkspacePath } from '../../../../security/workspace-root-guard.js';

export interface GlobExecutorOptions {
  pattern: string;
  path?: string;
  exclude?: string | string[];
  limit?: number;
}

const DEFAULT_LIMIT = 1000;
const DEFAULT_IGNORE = ['node_modules/**', '.git/**'];

export async function executeGlob(
  options: GlobExecutorOptions,
  ctx: { cwd: string; workspaceRoot: string },
): Promise<string[]> {
  const targetPath = resolveWorkspacePath(options.path ?? '.', ctx);
  const exclude = Array.isArray(options.exclude)
    ? options.exclude
    : options.exclude
      ? [options.exclude]
      : [];

  const matches = await glob(options.pattern, {
    cwd: targetPath,
    absolute: true,
    nodir: true,
    ignore: [...DEFAULT_IGNORE, ...exclude],
  });

  const limit = Number.isFinite(options.limit) && options.limit != null ? Math.max(1, options.limit) : DEFAULT_LIMIT;
  const limited = matches.slice(0, limit);

  const resolvedRoot = await realpath(ctx.workspaceRoot);
  return limited.map((absolutePath) => relative(resolvedRoot, absolutePath));
}
