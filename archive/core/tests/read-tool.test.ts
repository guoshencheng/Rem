import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReadToolExecutor } from '../src/plugins/tool/file-system/read.js';

const ctx = (workspaceRoot: string) => ({
  cwd: workspaceRoot,
  workspaceRoot,
});

describe('read tool', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'rem-read-'));
  });

  it('reads a file', async () => {
    await writeFile(join(workspaceRoot, 'foo.txt'), 'hello world', 'utf8');
    const executor = createReadToolExecutor();
    const result = await executor({ path: 'foo.txt' }, ctx(workspaceRoot));
    expect(result.output).toContain('hello world');
  });

  it('respects offset and limit', async () => {
    await writeFile(join(workspaceRoot, 'foo.txt'), 'line1\nline2\nline3\nline4', 'utf8');
    const executor = createReadToolExecutor();
    const result = await executor({ path: 'foo.txt', offset: 2, limit: 2 }, ctx(workspaceRoot));
    expect(result.output).toBe('line2\nline3');
  });

  it('rejects paths outside workspace root', async () => {
    const executor = createReadToolExecutor();
    await expect(executor({ path: '/etc/passwd' }, ctx(workspaceRoot))).rejects.toThrow(
      'resolves outside workspace root',
    );
  });

  it('reports missing file', async () => {
    const executor = createReadToolExecutor();
    await expect(executor({ path: 'missing.txt' }, ctx(workspaceRoot))).rejects.toThrow();
  });
});
