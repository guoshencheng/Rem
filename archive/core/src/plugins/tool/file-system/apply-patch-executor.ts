import { readFile, writeFile, unlink, rename, stat, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveWorkspacePath } from '../../../security/workspace-root-guard.js';
import type { ToolContext } from '../../../sdk/tool-provider.js';
import type { FileMutationQueue } from './shared/file-mutation-queue.js';
import type { PatchHunk, PatchOperation } from './apply-patch-parser.js';

export async function executePatchOperations(
  operations: PatchOperation[],
  ctx: ToolContext,
  queue: FileMutationQueue,
): Promise<string[]> {
  const changed: string[] = [];

  for (const op of operations) {
    const absolutePath = resolveWorkspacePath(op.path, ctx);

    if (op.type === 'delete') {
      await queue.withQueue(absolutePath, () => unlink(absolutePath));
      changed.push(`Deleted: ${op.path}`);
      continue;
    }

    if (op.type === 'add') {
      const exists = await stat(absolutePath).then(() => true, () => false);
      if (exists) {
        throw new Error(`File already exists: ${op.path} (Add conflict)`);
      }
      const content = op.hunks.map((h) => h.newLines.join('\n')).join('\n');
      await queue.withQueue(absolutePath, async () => {
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, content, 'utf8');
      });
      changed.push(`Added: ${op.path}`);
      continue;
    }

    if (op.type === 'update') {
      await queue.withQueue(absolutePath, async () => {
        const original = await readFile(absolutePath, 'utf8');
        const modified = applyUpdate(original, op.hunks);
        await writeFile(absolutePath, modified, 'utf8');
      });

      const newPath = op.newPath ? resolveWorkspacePath(op.newPath, ctx) : null;
      if (newPath) {
        await queue.withQueue(newPath, async () => {
          await mkdir(dirname(newPath), { recursive: true });
          await rename(absolutePath, newPath);
        });
        changed.push(`Moved: ${op.path} -> ${op.newPath}`);
      } else {
        changed.push(`Updated: ${op.path}`);
      }
      continue;
    }
  }

  return changed;
}

function applyUpdate(content: string, hunks: PatchHunk[]): string {
  let lines = content.split(/\r?\n/);

  for (const hunk of [...hunks].reverse()) {
    const contextIndex = lines.findIndex((l) => l === hunk.context);
    if (contextIndex === -1) {
      throw new Error(`Could not locate context "${hunk.context}"`);
    }

    const oldStart = contextIndex + 1;
    const oldEnd = oldStart + hunk.oldLines.length;
    const actualOld = lines.slice(oldStart, oldEnd);

    if (actualOld.length !== hunk.oldLines.length || !actualOld.every((l, i) => l === hunk.oldLines[i])) {
      throw new Error(`Context mismatch after "${hunk.context}"`);
    }

    const before = lines.slice(0, oldStart);
    const after = lines.slice(oldEnd);
    lines = [...before, ...hunk.newLines, ...after];
  }

  return lines.join('\n');
}
