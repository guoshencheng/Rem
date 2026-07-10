import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGrepToolDefinition, createGrepToolExecutor } from '../src/plugins/tool/file-system/grep.js';

const ctx = (workspaceRoot: string) => ({ cwd: workspaceRoot, workspaceRoot });

describe('grep tool', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'rem-grep-tool-'));
    await writeFile(join(workspaceRoot, 'a.ts'), 'hello world\nfoo bar\n', 'utf8');
    await writeFile(join(workspaceRoot, 'b.js'), 'hello js\n', 'utf8');
  });

  it('matches regex by default', async () => {
    const executor = createGrepToolExecutor();
    const result = await executor({ pattern: 'hello' }, ctx(workspaceRoot));
    expect(result.output).toContain('a.ts:1: hello world');
    expect(result.output).toContain('b.js:1: hello js');
  });

  it('supports literal mode', async () => {
    await writeFile(join(workspaceRoot, 'c.ts'), 'a.b\n', 'utf8');
    const executor = createGrepToolExecutor();
    const result = await executor({ pattern: 'a.b', literal: true }, ctx(workspaceRoot));
    expect(result.output).toContain('c.ts:1: a.b');
  });

  it('supports glob file filter', async () => {
    const executor = createGrepToolExecutor();
    const result = await executor({ pattern: 'hello', glob: '*.ts' }, ctx(workspaceRoot));
    expect(result.output).toContain('a.ts:1: hello world');
    expect(result.output).not.toContain('b.js');
  });

  it('supports context lines', async () => {
    const executor = createGrepToolExecutor();
    const result = await executor({ pattern: 'foo', context: 1 }, ctx(workspaceRoot));
    expect(result.output).toContain('a.ts-1-: hello world');
    expect(result.output).toContain('a.ts:2: foo bar');
  });

  it('respects limit', async () => {
    const executor = createGrepToolExecutor();
    const result = await executor({ pattern: 'hello', limit: 1 }, ctx(workspaceRoot));
    expect(result.output).toContain('matches limit reached');
  });

  it('rejects paths outside workspace root', async () => {
    const executor = createGrepToolExecutor();
    await expect(executor({ pattern: 'x', path: '/etc' }, ctx(workspaceRoot))).rejects.toThrow(
      'resolves outside workspace root',
    );
  });

  it('supports a single file path', async () => {
    const executor = createGrepToolExecutor();
    const result = await executor({ pattern: 'hello', path: 'a.ts' }, ctx(workspaceRoot));
    expect(result.output).toContain('a.ts:1: hello world');
    expect(result.output).not.toContain('b.js');
  });
});
