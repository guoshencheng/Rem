import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplyPatchToolDefinition, createApplyPatchToolExecutor } from '../src/plugins/tool/file-system/apply-patch.js';
import { createFileMutationQueue } from '../src/plugins/tool/file-system/shared/file-mutation-queue.js';

const ctx = (workspaceRoot: string, readOnly = false) => ({ cwd: workspaceRoot, workspaceRoot, readOnly });

describe('apply_patch tool', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'rem-apply-patch-'));
  });

  it('adds a file', async () => {
    const executor = createApplyPatchToolExecutor(createFileMutationQueue());
    const result = await executor(
      { patchText: '*** Begin Patch\n*** Add File: src/foo.ts\n@@\n+ hello\n*** End File\n*** End Patch' },
      ctx(workspaceRoot),
    );
    expect(result.output).toContain('Added: src/foo.ts');
    const content = await readFile(join(workspaceRoot, 'src/foo.ts'), 'utf8');
    expect(content).toBe('hello');
  });

  it('updates a file', async () => {
    await writeFile(join(workspaceRoot, 'foo.ts'), 'hello\nworld\n', 'utf8');
    const executor = createApplyPatchToolExecutor(createFileMutationQueue());
    const result = await executor(
      { patchText: '*** Begin Patch\n*** Update File: foo.ts\n@@ hello\n- world\n+ there\n*** End File\n*** End Patch' },
      ctx(workspaceRoot),
    );
    expect(result.output).toContain('Updated: foo.ts');
    const content = await readFile(join(workspaceRoot, 'foo.ts'), 'utf8');
    expect(content).toBe('hello\nthere\n');
  });

  it('deletes a file', async () => {
    await writeFile(join(workspaceRoot, 'foo.ts'), 'x', 'utf8');
    const executor = createApplyPatchToolExecutor(createFileMutationQueue());
    const result = await executor(
      { patchText: '*** Begin Patch\n*** Delete File: foo.ts\n*** End File\n*** End Patch' },
      ctx(workspaceRoot),
    );
    expect(result.output).toContain('Deleted: foo.ts');
  });

  it('rejects paths outside workspace root', async () => {
    const executor = createApplyPatchToolExecutor(createFileMutationQueue());
    await expect(
      executor(
        { patchText: '*** Begin Patch\n*** Add File: /etc/foo.ts\n@@\n+ x\n*** End File\n*** End Patch' },
        ctx(workspaceRoot),
      ),
    ).rejects.toThrow('resolves outside workspace root');
  });

  it('rejects read-only mode', async () => {
    const executor = createApplyPatchToolExecutor(createFileMutationQueue());
    await expect(
      executor(
        { patchText: '*** Begin Patch\n*** Add File: foo.ts\n@@\n+ x\n*** End File\n*** End Patch' },
        ctx(workspaceRoot, true),
      ),
    ).rejects.toThrow('read-only');
  });

  it('rejects add when file already exists', async () => {
    await writeFile(join(workspaceRoot, 'foo.ts'), 'x', 'utf8');
    const executor = createApplyPatchToolExecutor(createFileMutationQueue());
    await expect(
      executor(
        { patchText: '*** Begin Patch\n*** Add File: foo.ts\n@@\n+ y\n*** End File\n*** End Patch' },
        ctx(workspaceRoot),
      ),
    ).rejects.toThrow('File already exists');
  });
});
