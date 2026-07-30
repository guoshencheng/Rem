import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGlobToolDefinition, createGlobToolExecutor } from '../src/plugins/tool/file-system/glob.js';

const ctx = (workspaceRoot: string) => ({ cwd: workspaceRoot, workspaceRoot });

describe('glob tool', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'rem-glob-tool-'));
    await writeFile(join(workspaceRoot, 'foo.ts'), '', 'utf8');
    await mkdir(join(workspaceRoot, 'src'));
    await writeFile(join(workspaceRoot, 'src/bar.ts'), '', 'utf8');
  });

  it('lists matching files', async () => {
    const executor = createGlobToolExecutor();
    const result = await executor({ pattern: '**/*.ts' }, ctx(workspaceRoot));
    expect(result.output).toContain('foo.ts');
    expect(result.output).toContain('src/bar.ts');
  });

  it('respects limit', async () => {
    const executor = createGlobToolExecutor();
    const result = await executor({ pattern: '**/*.ts', limit: 1 }, ctx(workspaceRoot));
    expect(result.output).toContain('entries limit reached');
  });

  it('reports no matches', async () => {
    const executor = createGlobToolExecutor();
    const result = await executor({ pattern: '**/*.js' }, ctx(workspaceRoot));
    expect(result.output).toContain('no matches');
  });
});
