import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWriteToolExecutor } from '../src/plugins/tool/file-system/write.js';
import { createFileMutationQueue } from '../src/plugins/tool/file-system/shared/file-mutation-queue.js';

const ctx = (workspaceRoot: string, readOnly = false) => ({
  cwd: workspaceRoot,
  workspaceRoot,
  readOnly,
});

describe('write tool', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'rem-write-'));
  });

  it('writes a new file', async () => {
    const executor = createWriteToolExecutor(createFileMutationQueue());
    const result = await executor(
      { path: 'nested/foo.txt', content: 'hello' },
      ctx(workspaceRoot),
    );
    expect(result.output).toContain('Successfully wrote');
    const content = await readFile(join(workspaceRoot, 'nested/foo.txt'), 'utf8');
    expect(content).toBe('hello');
  });

  it('rejects write in read-only mode', async () => {
    const executor = createWriteToolExecutor(createFileMutationQueue());
    await expect(
      executor({ path: 'foo.txt', content: 'x' }, ctx(workspaceRoot, true)),
    ).rejects.toThrow('read-only');
  });

  it('rejects paths outside workspace root', async () => {
    const executor = createWriteToolExecutor(createFileMutationQueue());
    await expect(
      executor({ path: '/outside/foo.txt', content: 'x' }, ctx(workspaceRoot)),
    ).rejects.toThrow('resolves outside workspace root');
  });

  it('reports already up to date for identical content', async () => {
    const executor = createWriteToolExecutor(createFileMutationQueue());
    await executor({ path: 'foo.txt', content: 'same' }, ctx(workspaceRoot));
    const result = await executor({ path: 'foo.txt', content: 'same' }, ctx(workspaceRoot));
    expect(result.output).toContain('already up to date');
  });
});
