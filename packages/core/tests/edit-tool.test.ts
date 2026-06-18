import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEditToolExecutor } from '../src/plugins/tools/edit.js';

const ctx = (workspaceRoot: string, readOnly = false) => ({
  cwd: workspaceRoot,
  workspaceRoot,
  readOnly,
});

describe('edit tool', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'rem-edit-'));
  });

  it('applies a single replacement', async () => {
    await writeFile(join(workspaceRoot, 'foo.txt'), 'hello world', 'utf8');
    const executor = createEditToolExecutor();
    const result = await executor(
      { path: 'foo.txt', edits: [{ oldText: 'world', newText: 'there' }] },
      ctx(workspaceRoot),
    );
    expect(result.output).toContain('Successfully edited');
    const content = await readFile(join(workspaceRoot, 'foo.txt'), 'utf8');
    expect(content).toBe('hello there');
  });

  it('applies multiple replacements', async () => {
    await writeFile(join(workspaceRoot, 'foo.txt'), 'a b c', 'utf8');
    const executor = createEditToolExecutor();
    await executor(
      {
        path: 'foo.txt',
        edits: [
          { oldText: 'a', newText: 'x' },
          { oldText: 'b', newText: 'y' },
        ],
      },
      ctx(workspaceRoot),
    );
    const content = await readFile(join(workspaceRoot, 'foo.txt'), 'utf8');
    expect(content).toBe('x y c');
  });

  it('preserves CRLF line endings', async () => {
    await writeFile(join(workspaceRoot, 'foo.txt'), 'line1\r\nline2\r\n', 'utf8');
    const executor = createEditToolExecutor();
    await executor(
      { path: 'foo.txt', edits: [{ oldText: 'line1', newText: 'first' }] },
      ctx(workspaceRoot),
    );
    const content = await readFile(join(workspaceRoot, 'foo.txt'), 'utf8');
    expect(content).toBe('first\r\nline2\r\n');
  });

  it('reports mismatch with file snippet', async () => {
    await writeFile(join(workspaceRoot, 'foo.txt'), 'hello world', 'utf8');
    const executor = createEditToolExecutor();
    await expect(
      executor(
        { path: 'foo.txt', edits: [{ oldText: 'missing', newText: 'x' }] },
        ctx(workspaceRoot),
      ),
    ).rejects.toThrow('Current file contents:');
  });

  it('rejects edit in read-only mode', async () => {
    await writeFile(join(workspaceRoot, 'foo.txt'), 'x', 'utf8');
    const executor = createEditToolExecutor();
    await expect(
      executor(
        { path: 'foo.txt', edits: [{ oldText: 'x', newText: 'y' }] },
        ctx(workspaceRoot, true),
      ),
    ).rejects.toThrow('read-only');
  });
});
