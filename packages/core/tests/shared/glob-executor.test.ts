import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeGlob } from '../../src/plugins/tool/file-system/shared/glob-executor.js';

const ctx = (workspaceRoot: string) => ({ cwd: workspaceRoot, workspaceRoot });

describe('glob-executor', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'rem-glob-'));
    await writeFile(join(workspaceRoot, 'a.txt'), '', 'utf8');
    await writeFile(join(workspaceRoot, 'b.ts'), '', 'utf8');
    await mkdir(join(workspaceRoot, 'node_modules'));
    await writeFile(join(workspaceRoot, 'node_modules/c.js'), '', 'utf8');
    await mkdir(join(workspaceRoot, '.git'));
    await writeFile(join(workspaceRoot, '.git/d'), '', 'utf8');
  });

  it('returns matching files relative to workspace root', async () => {
    const result = await executeGlob({ pattern: '*.*' }, ctx(workspaceRoot));
    expect(result).toContain('a.txt');
    expect(result).toContain('b.ts');
    expect(result).not.toContain('node_modules/c.js');
    expect(result).not.toContain('.git/d');
  });

  it('respects limit', async () => {
    const result = await executeGlob({ pattern: '*.*', limit: 1 }, ctx(workspaceRoot));
    expect(result.length).toBe(1);
  });

  it('respects exclude', async () => {
    const result = await executeGlob({ pattern: '*.*', exclude: '*.ts' }, ctx(workspaceRoot));
    expect(result).toContain('a.txt');
    expect(result).not.toContain('b.ts');
  });

  it('rejects paths outside workspace root', async () => {
    await expect(executeGlob({ pattern: '*', path: '/etc' }, ctx(workspaceRoot))).rejects.toThrow(
      'resolves outside workspace root',
    );
  });
});
