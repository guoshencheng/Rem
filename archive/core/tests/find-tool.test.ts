import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFindToolDefinition, createFindToolExecutor } from '../src/plugins/tool/file-system/find.js';

const ctx = (workspaceRoot: string) => ({ cwd: workspaceRoot, workspaceRoot });

describe('find tool', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'rem-find-tool-'));
    await writeFile(join(workspaceRoot, 'foo.ts'), '', 'utf8');
    await mkdir(join(workspaceRoot, 'src'));
    await writeFile(join(workspaceRoot, 'src/bar.ts'), '', 'utf8');
  });

  it('finds matching files recursively', async () => {
    const executor = createFindToolExecutor();
    const result = await executor({ pattern: '**/*.ts' }, ctx(workspaceRoot));
    expect(result.output).toContain('foo.ts');
    expect(result.output).toContain('src/bar.ts');
  });

  it('reports no matches', async () => {
    const executor = createFindToolExecutor();
    const result = await executor({ pattern: '**/*.js' }, ctx(workspaceRoot));
    expect(result.output).toContain('no matches');
  });

  it('excludes files matching exclude pattern', async () => {
    await writeFile(join(workspaceRoot, 'foo.js'), '', 'utf8');
    const executor = createFindToolExecutor();
    const result = await executor({ pattern: '**/*', exclude: '*.js' }, ctx(workspaceRoot));
    expect(result.output).not.toContain('foo.js');
    expect(result.output).toContain('foo.ts');
  });

  it('excludes files matching exclude array', async () => {
    await writeFile(join(workspaceRoot, 'foo.js'), '', 'utf8');
    await writeFile(join(workspaceRoot, 'foo.css'), '', 'utf8');
    const executor = createFindToolExecutor();
    const result = await executor({ pattern: '**/*', exclude: ['*.js', '*.css'] }, ctx(workspaceRoot));
    expect(result.output).not.toContain('foo.js');
    expect(result.output).not.toContain('foo.css');
    expect(result.output).toContain('foo.ts');
  });
});
