import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLsToolExecutor } from '../src/plugins/tools/ls.js';

const ctx = (workspaceRoot: string) => ({
  cwd: workspaceRoot,
  workspaceRoot,
});

describe('ls tool', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'rem-ls-'));
    await writeFile(join(workspaceRoot, 'apple.txt'), '', 'utf8');
    await writeFile(join(workspaceRoot, 'Banana.txt'), '', 'utf8');
    await mkdir(join(workspaceRoot, 'cherry'));
  });

  it('lists directory entries with directory suffix', async () => {
    const executor = createLsToolExecutor();
    const result = await executor({ path: '.' }, ctx(workspaceRoot));
    const lines = result.output.split('\n');
    expect(lines).toContain('apple.txt');
    expect(lines).toContain('Banana.txt');
    expect(lines).toContain('cherry/');
  });

  it('sorts entries case-insensitively', async () => {
    const executor = createLsToolExecutor();
    const result = await executor({ path: '.' }, ctx(workspaceRoot));
    const lines = result.output.split('\n').filter(Boolean);
    expect(lines[0]).toBe('apple.txt');
  });

  it('respects limit', async () => {
    const executor = createLsToolExecutor();
    const result = await executor({ path: '.', limit: 1 }, ctx(workspaceRoot));
    expect(result.output).toContain('entries limit reached');
  });

  it('rejects paths outside workspace root', async () => {
    const executor = createLsToolExecutor();
    await expect(executor({ path: '/etc' }, ctx(workspaceRoot))).rejects.toThrow(
      'resolves outside workspace root',
    );
  });
});
