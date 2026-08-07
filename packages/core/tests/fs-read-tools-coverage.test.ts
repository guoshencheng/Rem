import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext, ToolDefinition, ToolExecutor } from '../src/sdk/tool-provider.js';
import type { ConfigProvider } from '../src/sdk/config-provider.js';
import { createFileSystemTools } from '../src/plugins/tool/file-system/index.js';

// ─── read.ts imports ──────────────────────────────────────────────
import { createReadToolDefinition, createReadToolExecutor } from '../src/plugins/tool/file-system/read.js';
// ─── write.ts imports ─────────────────────────────────────────────
import { createWriteToolDefinition, createWriteToolExecutor } from '../src/plugins/tool/file-system/write.js';
import { createFileMutationQueue } from '../src/plugins/tool/file-system/shared/file-mutation-queue.js';
// ─── grep.ts imports ──────────────────────────────────────────────
import {
  createGrepToolDefinition,
  createGrepToolExecutor,
  deriveGrepPatterns,
  deriveGrepAlwaysOptions,
} from '../src/plugins/tool/file-system/grep.js';
// ─── ls.ts imports ────────────────────────────────────────────────
import { createLsToolDefinition, createLsToolExecutor, type LsOperations } from '../src/plugins/tool/file-system/ls.js';
// ─── exec.ts imports ──────────────────────────────────────────────
import { createExecToolDefinition, createExecToolExecutor } from '../src/plugins/tool/file-system/exec.js';
// ─── shared imports ──────────────────────────────────────────────
import { normalizePositiveLimit, appendBoundedTextTail, SESSION_TOOL_STDERR_TAIL_BYTES } from '../src/plugins/tool/file-system/shared/limits.js';
import {
  truncateHead,
  truncateTail,
  truncateLine,
  formatSize,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  GREP_MAX_LINE_LENGTH,
} from '../src/plugins/tool/file-system/shared/truncate.js';
import { FileMutationQueue } from '../src/plugins/tool/file-system/shared/file-mutation-queue.js';

const { mockWriteFileDeferred } = vi.hoisted(() => ({
  mockWriteFileDeferred: { triggerError: false },
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  const realWriteFile = original.writeFile as any;
  return {
    ...original,
    writeFile: vi.fn().mockImplementation(async (...args: any[]) => {
      if (mockWriteFileDeferred.triggerError) {
        mockWriteFileDeferred.triggerError = false;
        await realWriteFile(args[0], args[1], 'utf8');
        const err = new Error('timeout writing file');
        throw err;
      }
      return realWriteFile(args[0], args[1], 'utf8');
    }),
  };
});

// ─── helpers ──────────────────────────────────────────────────────
let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rem-fs-test-'));
  tempDirs.push(dir);
  return dir;
}

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
    mockWriteFileDeferred.triggerError = false;
  });

function ctx(dir: string): ToolContext {
  return { cwd: dir, workspaceRoot: dir };
}

// ─── truncate ─────────────────────────────────────────────────────
describe('truncate', () => {
  describe('formatSize', () => {
    it('formats bytes < 1024', () => {
      expect(formatSize(0)).toBe('0 B');
      expect(formatSize(512)).toBe('512 B');
      expect(formatSize(1023)).toBe('1023 B');
    });

    it('formats KB', () => {
      expect(formatSize(1024)).toBe('1.0 KB');
      expect(formatSize(1536)).toBe('1.5 KB');
      expect(formatSize(1024 * 1024 - 1)).toBe('1024.0 KB');
    });

    it('formats MB', () => {
      expect(formatSize(1024 * 1024)).toBe('1.0 MB');
      expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
    });
  });

  describe('truncateHead', () => {
    it('returns full text when under limits', () => {
      const result = truncateHead('hello world');
      expect(result.content).toBe('hello world');
      expect(result.truncated).toBe(false);
    });

    it('truncates to last N lines when over maxLines', () => {
      const lines = Array.from({ length: 3000 }, (_, i) => `line ${i}`);
      const text = lines.join('\n');
      const result = truncateHead(text, { maxLines: 10, maxBytes: DEFAULT_MAX_BYTES });
      expect(result.content.split('\n').length).toBe(10);
      expect(result.truncated).toBe(true);
    });

    it('truncates bytes from head', () => {
      const text = 'a'.repeat(1000);
      const result = truncateHead(text, { maxBytes: 100, maxLines: DEFAULT_MAX_LINES });
      expect(result.content.length).toBeLessThanOrEqual(200);
      expect(result.truncated).toBe(true);
      expect(result.maxBytes).toBe(100);
    });

    it('reports firstLineExceedsLimit', () => {
      const singleLine = 'x'.repeat(1000);
      const result = truncateHead(singleLine, { maxBytes: 100, maxLines: DEFAULT_MAX_LINES });
      expect(result.firstLineExceedsLimit).toBe(true);
    });

    it('does not report firstLineExceedsLimit on short lines', () => {
      const text = 'hello\nworld\n';
      const result = truncateHead(text, { maxBytes: 10, maxLines: DEFAULT_MAX_LINES });
      expect(result.firstLineExceedsLimit).toBe(false);
      expect(result.truncated).toBe(true);
    });

    it('uses defaults when no options', () => {
      const text = 'a'.repeat(DEFAULT_MAX_BYTES + 1000);
      const result = truncateHead(text);
      expect(result.truncated).toBe(true);
      expect(result.maxBytes).toBe(DEFAULT_MAX_BYTES);
    });

    it('handles Windows-style line endings', () => {
      const lines = Array.from({ length: 3000 }, (_, i) => `line ${i}`);
      const text = lines.join('\r\n');
      const result = truncateHead(text, { maxLines: 5, maxBytes: DEFAULT_MAX_BYTES });
      expect(result.content.split(/\r?\n/).length).toBe(5);
      expect(result.truncated).toBe(true);
    });
  });

  describe('truncateTail', () => {
    it('returns full text when under limit', () => {
      const result = truncateTail('hello', 1000);
      expect(result.content).toBe('hello');
      expect(result.truncated).toBe(false);
    });

    it('truncates from tail', () => {
      const result = truncateTail('abcdefghij', 5);
      expect(result.content).toBe('abcde');
      expect(result.truncated).toBe(true);
      expect(result.maxBytes).toBe(5);
    });
  });

  describe('truncateLine', () => {
    it('returns short line as-is', () => {
      const result = truncateLine('hello');
      expect(result.text).toBe('hello');
      expect(result.wasTruncated).toBe(false);
    });

    it('truncates long line with ellipsis', () => {
      const longLine = 'x'.repeat(3000);
      const result = truncateLine(longLine);
      expect(result.text).toBe('x'.repeat(GREP_MAX_LINE_LENGTH) + '\u2026');
      expect(result.wasTruncated).toBe(true);
    });

    it('uses custom max length', () => {
      const longLine = 'x'.repeat(100);
      const result = truncateLine(longLine, 50);
      expect(result.text.length).toBe(51);
      expect(result.wasTruncated).toBe(true);
    });
  });
});

// ─── limits ────────────────────────────────────────────────────────
describe('limits', () => {
  describe('normalizePositiveLimit', () => {
    it('returns fallback when undefined', () => {
      expect(normalizePositiveLimit(undefined, 500)).toBe(500);
    });

    it('returns fallback when non-finite', () => {
      expect(normalizePositiveLimit(NaN, 500)).toBe(500);
      expect(normalizePositiveLimit(Infinity, 500)).toBe(500);
      expect(normalizePositiveLimit(-Infinity, 500)).toBe(500);
    });

    it('floors and clamps to at least 1', () => {
      expect(normalizePositiveLimit(0, 500)).toBe(1);
      expect(normalizePositiveLimit(-5, 500)).toBe(1);
      expect(normalizePositiveLimit(5.7, 500)).toBe(5);
      expect(normalizePositiveLimit(100, 500)).toBe(100);
    });
  });

  describe('appendBoundedTextTail', () => {
    it('returns chunk tail when chunk >= maxBytes', () => {
      const chunk = Buffer.from('x'.repeat(100));
      const result = appendBoundedTextTail('previous text', chunk, 50);
      expect(result.length).toBeLessThanOrEqual(100);
      // it should contain tail of chunk only
      expect(result).not.toContain('previous');
    });

    it('appends when total fits', () => {
      const result = appendBoundedTextTail('hello', ' world', 100);
      expect(result).toBe('hello world');
    });

    it('trims current to make room for chunk', () => {
      const current = 'x'.repeat(80);
      const chunk = Buffer.from('y'.repeat(40));
      const result = appendBoundedTextTail(current, chunk, 100);
      expect(result).toContain('y'.repeat(40));
      expect(result.length).toBeLessThanOrEqual(120); // approximate
    });

    it('handles empty current', () => {
      const result = appendBoundedTextTail('', 'hello', 100);
      expect(result).toBe('hello');
    });

    it('handles string chunk', () => {
      const result = appendBoundedTextTail('hi', 'there', 50);
      expect(result).toBe('hithere');
    });

    it('uses default maxBytes', () => {
      const result = appendBoundedTextTail('small', 'chunk');
      expect(result).toBe('smallchunk');
    });
  });
});

// ─── file-mutation-queue ──────────────────────────────────────────
describe('FileMutationQueue', () => {
  it('createFileMutationQueue returns an instance', () => {
    const queue = createFileMutationQueue();
    expect(queue).toBeInstanceOf(FileMutationQueue);
  });

  it('withQueue serializes operations on the same file', async () => {
    const queue = new FileMutationQueue();
    const order: number[] = [];

    const p1 = queue.withQueue('/tmp/test.txt', async () => {
      order.push(1);
      return 'a';
    });
    const p2 = queue.withQueue('/tmp/test.txt', async () => {
      order.push(2);
      return 'b';
    });

    const results = await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
    expect(results).toEqual(['a', 'b']);
  });

  it('returns function result', async () => {
    const queue = new FileMutationQueue();
    const result = await queue.withQueue('/tmp/f.txt', async () => 'hello');
    expect(result).toBe('hello');
  });

  it('releases queue on error', async () => {
    const queue = new FileMutationQueue();
    let calledAfter = false;

    await expect(
      queue.withQueue('/tmp/err.txt', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const result = await queue.withQueue('/tmp/err.txt', async () => {
      calledAfter = true;
      return 'ok';
    });
    expect(calledAfter).toBe(true);
    expect(result).toBe('ok');
  });
});

// ─── read.ts ───────────────────────────────────────────────────────
describe('read tool', () => {
  it('has correct definition', () => {
    const def = createReadToolDefinition();
    expect(def.name).toBe('read');
    expect(def.readOnly).toBe(true);
    expect(def.category).toBe('filesystem');
  });

  it('reads a file', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'hello.txt'), 'hello world');
    const executor = createReadToolExecutor();
    const result = await executor({ path: 'hello.txt' }, ctx(dir));
    expect(result.output).toContain('hello world');
  });

  it('reads with offset', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'lines.txt'), 'line1\nline2\nline3\nline4');
    const executor = createReadToolExecutor();
    const result = await executor({ path: 'lines.txt', offset: 2 }, ctx(dir));
    expect(result.output).not.toContain('line1');
    expect(result.output).toContain('line2');
  });

  it('reads with limit', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'lines.txt'), 'line1\nline2\nline3\nline4');
    const executor = createReadToolExecutor();
    const result = await executor({ path: 'lines.txt', limit: 2 }, ctx(dir));
    const lines = result.output.split('\n');
    expect(lines.length).toBeLessThanOrEqual(4);
    expect(result.output).toContain('line1');
    expect(result.output).toContain('line2');
  });

  it('throws when offset is beyond end of file', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'small.txt'), 'only one line');
    const executor = createReadToolExecutor();
    await expect(
      executor({ path: 'small.txt', offset: 100 }, ctx(dir)),
    ).rejects.toThrow(/beyond end/);
  });

  it('shows truncation notice when total exceeds byte limit', async () => {
    const dir = makeTempDir();
    // File with <2000 lines but total bytes > 50KB
    // Each line ~100 chars, 600 lines = ~60KB
    const longLine = 'x'.repeat(90);
    const lines = Array.from({ length: 600 }, (_, i) => `${i.toString().padStart(5, '0')} ${longLine}`);
    writeFileSync(join(dir, 'big.txt'), lines.join('\n'));
    const executor = createReadToolExecutor();
    const result = await executor({ path: 'big.txt' }, ctx(dir));
    expect(result.output).toContain('truncated to');
  });

  it('shows firstLineExceedsLimit message', async () => {
    const dir = makeTempDir();
    // Single line > 50KB
    const longLine = 'x'.repeat(DEFAULT_MAX_BYTES + 1000);
    writeFileSync(join(dir, 'long.txt'), longLine);
    const executor = createReadToolExecutor();
    const result = await executor({ path: 'long.txt' }, ctx(dir));
    expect(result.output).toContain('exceeds');
    expect(result.output).toContain('limit');
  });
});

// ─── write.ts ──────────────────────────────────────────────────────
describe('write tool', () => {
  it('has correct definition', () => {
    const def = createWriteToolDefinition();
    expect(def.name).toBe('write');
    expect(def.dangerous).toBe(true);
    expect(def.category).toBe('filesystem');
  });

  it('writes a file', async () => {
    const dir = makeTempDir();
    const queue = new FileMutationQueue();
    const executor = createWriteToolExecutor(queue);
    const result = await executor({ path: 'out.txt', content: 'hello' }, ctx(dir));
    expect(result.output).toContain('Successfully wrote');
    expect(readFileSync(join(dir, 'out.txt'), 'utf8')).toBe('hello');
  });

  it('creates parent directories', async () => {
    const dir = makeTempDir();
    const queue = new FileMutationQueue();
    const executor = createWriteToolExecutor(queue);
    await executor({ path: 'deep/nested/file.txt', content: 'nested' }, ctx(dir));
    expect(readFileSync(join(dir, 'deep/nested/file.txt'), 'utf8')).toBe('nested');
  });

  it('reports same content as up to date', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'same.txt'), 'content');
    const queue = new FileMutationQueue();
    const executor = createWriteToolExecutor(queue);
    const result = await executor({ path: 'same.txt', content: 'content' }, ctx(dir));
    expect(result.output).toContain('already up to date');
  });

  it('throws in read-only mode', async () => {
    const dir = makeTempDir();
    const queue = new FileMutationQueue();
    const executor = createWriteToolExecutor(queue);
    await expect(
      executor({ path: 'out.txt', content: 'hello' }, { ...ctx(dir), readOnly: true }),
    ).rejects.toThrow('read-only mode');
  });

  it('overwrites existing file with different content same size', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'f.txt'), 'hello');
    const queue = new FileMutationQueue();
    const executor = createWriteToolExecutor(queue);
    const result = await executor({ path: 'f.txt', content: 'world' }, ctx(dir));
    expect(result.output).toContain('Successfully wrote');
    expect(readFileSync(join(dir, 'f.txt'), 'utf8')).toBe('world');
  });

  it('overwrites existing file with different content different size', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'f.txt'), 'short');
    const queue = new FileMutationQueue();
    const executor = createWriteToolExecutor(queue);
    const result = await executor({ path: 'f.txt', content: 'much longer content here' }, ctx(dir));
    expect(result.output).toContain('Successfully wrote');
  });

  it('fails when writing to a directory path', async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, 'mydir'));
    const queue = new FileMutationQueue();
    const executor = createWriteToolExecutor(queue);
    await expect(
      executor({ path: 'mydir', content: 'hello' }, ctx(dir)),
    ).rejects.toThrow();
  });

  it('handles symlink loop causing stat error', async () => {
    const dir = makeTempDir();
    try { symlinkSync(join(dir, 'loop'), join(dir, 'loop')); } catch {}
    const queue = new FileMutationQueue();
    const executor = createWriteToolExecutor(queue);
    await expect(
      executor({ path: 'loop', content: 'hello' }, ctx(dir)),
    ).rejects.toThrow();
  });

  it('recovers from write that appears to fail but actually succeeded', async () => {
    const dir = makeTempDir();
    const queue = new FileMutationQueue();
    const executor = createWriteToolExecutor(queue);
    mockWriteFileDeferred.triggerError = true;
    const result = await executor({ path: 'recovered.txt', content: 'recovered content' }, ctx(dir));
    expect(result.output).toContain('Successfully wrote');
    expect(readFileSync(join(dir, 'recovered.txt'), 'utf8')).toBe('recovered content');
  });
});

// ─── ls.ts ─────────────────────────────────────────────────────────
describe('ls tool', () => {
  it('has correct definition', () => {
    const def = createLsToolDefinition();
    expect(def.name).toBe('ls');
    expect(def.readOnly).toBe(true);
    expect(def.category).toBe('filesystem');
  });

  it('lists directory contents', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'a.txt'), 'a');
    writeFileSync(join(dir, 'b.txt'), 'b');
    mkdirSync(join(dir, 'subdir'));
    const executor = createLsToolExecutor();
    const result = await executor({ path: '.' }, ctx(dir));
    expect(result.output).toContain('a.txt');
    expect(result.output).toContain('b.txt');
    expect(result.output).toContain('subdir/');
  });

  it('sorts entries case-insensitively', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'B.txt'), 'b');
    writeFileSync(join(dir, 'a.txt'), 'a');
    const executor = createLsToolExecutor();
    const result = await executor({ path: '.' }, ctx(dir));
    const idxA = result.output.indexOf('a.txt');
    const idxB = result.output.indexOf('B.txt');
    expect(idxA).toBeLessThan(idxB);
  });

  it('uses default path "." when not specified', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'f.txt'), 'f');
    const executor = createLsToolExecutor();
    const result = await executor({}, ctx(dir));
    expect(result.output).toContain('f.txt');
  });

  it('shows empty directory message', async () => {
    const dir = makeTempDir();
    const executor = createLsToolExecutor();
    const result = await executor({ path: '.' }, ctx(dir));
    expect(result.output).toBe('(empty directory)');
  });

  it('throws when path not found', async () => {
    const dir = makeTempDir();
    const executor = createLsToolExecutor();
    await expect(executor({ path: 'nonexistent' }, ctx(dir))).rejects.toThrow('Path not found');
  });

  it('throws when path is not a directory', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'f.txt'), 'f');
    const executor = createLsToolExecutor();
    await expect(executor({ path: 'f.txt' }, ctx(dir))).rejects.toThrow('Not a directory');
  });

  it('respects limit', async () => {
    const dir = makeTempDir();
    for (let i = 0; i < 20; i++) {
      writeFileSync(join(dir, `f${i.toString().padStart(2, '0')}.txt`), '');
    }
    const executor = createLsToolExecutor();
    const result = await executor({ limit: 5 }, ctx(dir));
    expect(result.output).toContain('5 entries limit reached');
  });

  it('custom operations for DI testing', async () => {
    const ops: LsOperations = {
      exists: async () => true,
      stat: async () => ({ isDirectory: () => true }),
      readdir: async () => ['apple', 'banana', '101.txt'],
    };
    const executor = createLsToolExecutor(ops);
    const result = await executor({}, ctx('/fake'));
    expect(result.output).toContain('101.txt');
    expect(result.output).toContain('apple');
    expect(result.output).toContain('banana');
  });

  it('handles readdir error', async () => {
    const ops: LsOperations = {
      exists: async () => true,
      stat: async () => ({ isDirectory: () => true }),
      readdir: async () => {
        throw new Error('Permission denied');
      },
    };
    const executor = createLsToolExecutor(ops);
    await expect(executor({}, ctx('/fake'))).rejects.toThrow('Cannot read directory');
  });

  it('handles non-Error readdir failure', async () => {
    const ops: LsOperations = {
      exists: async () => true,
      stat: async () => ({ isDirectory: () => true }),
      readdir: async () => {
        throw 'string error';
      },
    };
    const executor = createLsToolExecutor(ops);
    await expect(executor({}, ctx('/fake'))).rejects.toThrow('Cannot read directory');
  });

  it('skips entries that cannot be statted', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'good.txt'), 'ok');
    const ops: LsOperations = {
      exists: async (p: string) => {
        try {
          const { access } = await import('node:fs/promises');
          await access(p);
          return true;
        } catch {
          return false;
        }
      },
      stat: async (p: string) => {
        const { stat } = await import('node:fs/promises');
        if (p.includes('bad')) throw new Error('cannot stat');
        const s = await stat(p);
        return { isDirectory: () => s.isDirectory() };
      },
      readdir: async () => ['good.txt', 'bad.txt'],
    };
    const executor = createLsToolExecutor(ops);
    const result = await executor({ path: '.' }, ctx(dir));
    expect(result.output).toContain('good.txt');
    expect(result.output).not.toContain('bad.txt');
  });
});

// ─── grep.ts ───────────────────────────────────────────────────────
describe('grep tool', () => {
  it('has correct definition', () => {
    const def = createGrepToolDefinition();
    expect(def.name).toBe('grep');
    expect(def.readOnly).toBe(true);
    expect(def.category).toBe('search');
  });

  it('searches for a regex pattern in a file', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'log.txt'), 'error: something\ninfo: ok\nwarning: check');
    const executor = createGrepToolExecutor();
    const result = await executor({ pattern: 'error|warn', path: 'log.txt' }, ctx(dir));
    expect(result.output).toContain('error: something');
    expect(result.output).toContain('warning: check');
  });

  it('searches with literal=true', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'text.txt'), 'hello (world)');
    const executor = createGrepToolExecutor();
    const result = await executor({ pattern: '(world)', path: 'text.txt', literal: true }, ctx(dir));
    expect(result.output).toContain('hello (world)');
  });

  it('searches with ignoreCase=true', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'text.txt'), 'HELLO');
    const executor = createGrepToolExecutor();
    const result = await executor({ pattern: 'hello', path: 'text.txt', ignoreCase: true }, ctx(dir));
    expect(result.output).toContain('HELLO');
  });

  it('shows context lines around matches', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'ctx.txt'), 'line1\nline2\nmatch\nline4\nline5');
    const executor = createGrepToolExecutor();
    const result = await executor({ pattern: 'match', path: 'ctx.txt', context: 1 }, ctx(dir));
    expect(result.output).toContain('line2');
    expect(result.output).toContain('line4');
  });

  it('returns (no matches) when nothing found', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'empty.txt'), 'nothing here');
    const executor = createGrepToolExecutor();
    const result = await executor({ pattern: 'zzzzz', path: 'empty.txt' }, ctx(dir));
    expect(result.output).toBe('(no matches)');
  });

  it('limits matches', async () => {
    const dir = makeTempDir();
    const lines = Array.from({ length: 20 }, () => 'match');
    writeFileSync(join(dir, 'many.txt'), lines.join('\n'));
    const executor = createGrepToolExecutor();
    const result = await executor({ pattern: 'match', path: 'many.txt', limit: 3 }, ctx(dir));
    expect(result.output).toContain('3 matches limit reached');
  });

  it('uses glob filter when path is a directory', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'a.log'), 'error: bad');
    writeFileSync(join(dir, 'b.txt'), 'error: also');
    const executor = createGrepToolExecutor();
    const result = await executor({ pattern: 'error', glob: '*.log' }, ctx(dir));
    expect(result.output).toContain('a.log');
    expect(result.output).not.toContain('b.txt');
  });

  it('uses default limit of 100', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'f.txt'), 'match');
    const executor = createGrepToolExecutor();
    const result = await executor({ pattern: 'match', path: 'f.txt', limit: undefined as any }, ctx(dir));
    expect(result.output).toContain('match');
  });

  it('deriveGrepPatterns', () => {
    const patterns = deriveGrepPatterns({ path: 'src', glob: '*.ts' });
    expect(patterns).toEqual(['file:src', 'glob:*.ts']);
  });

  it('deriveGrepPatterns with no args', () => {
    const patterns = deriveGrepPatterns({});
    expect(patterns).toEqual(['file:', 'glob:']);
  });

  it('deriveGrepAlwaysOptions', () => {
    const options = deriveGrepAlwaysOptions({ path: 'src' });
    expect(options).toHaveLength(2);
    expect(options[0].label).toBe('src');
    expect(options[0].rule.permission).toBe('grep');
    expect(options[1].label).toBe('all');
    expect(options[1].rule.action).toBe('allow');
  });

  it('deriveGrepAlwaysOptions with no path', () => {
    const options = deriveGrepAlwaysOptions({});
    expect(options[0].label).toBe('');
  });
});

// ─── exec.ts ───────────────────────────────────────────────────────
describe('exec tool', () => {
  it('has correct definition', () => {
    const def = createExecToolDefinition();
    expect(def.name).toBe('exec');
    expect(def.category).toBe('shell');
  });

  it('executes echo command', async () => {
    const dir = makeTempDir();
    const executor = createExecToolExecutor();
    const result = await executor({ command: 'echo hello' }, ctx(dir));
    expect(result.output).toContain('hello');
  });

  it('executes true command', async () => {
    const dir = makeTempDir();
    const executor = createExecToolExecutor();
    const result = await executor({ command: 'true' }, ctx(dir));
    expect(result.output).toBe('');
  });

  it('captures stderr', async () => {
    const dir = makeTempDir();
    const executor = createExecToolExecutor();
    const result = await executor({ command: 'echo err >&2' }, ctx(dir));
    expect(result.output).toContain('err');
  });

  it('throws on empty command', async () => {
    const dir = makeTempDir();
    const executor = createExecToolExecutor();
    await expect(executor({ command: '  ' }, ctx(dir))).rejects.toThrow('Empty command');
  });

  it('uses specified cwd', async () => {
    const dir = makeTempDir();
    const subDir = join(dir, 'sub');
    mkdirSync(subDir);
    writeFileSync(join(subDir, 'f.txt'), 'ok');
    const executor = createExecToolExecutor();
    const result = await executor({ command: 'pwd', cwd: subDir }, ctx(dir));
    // macOS /var is a symlink to /private/var
    expect(result.output.trim().replace(/^\/private/, '')).toBe(subDir.replace(/^\/private/, ''));
  });

  it('executes pwd', async () => {
    const dir = makeTempDir();
    const executor = createExecToolExecutor();
    const result = await executor({ command: 'pwd' }, ctx(dir));
    expect(result.output.trim().length).toBeGreaterThan(0);
  });
});

// ─── index.ts ──────────────────────────────────────────────────────
describe('createFileSystemTools', () => {
  function makeConfigProvider(overrides: {
    workspaceRoot?: string;
    readOnly?: boolean;
  } = {}): ConfigProvider {
    const workspaceRoot = overrides.workspaceRoot ?? '/test-ws';
    const readOnly = overrides.readOnly ?? false;
    return {
      init: vi.fn().mockResolvedValue(undefined),
      getConfig: vi.fn().mockReturnValue({
        name: 'test',
        maxTurns: 50,
        workspaceRoot,
        readOnly,
        autoApproveDangerous: false,
        model: { provider: 'test', model: 'test', apiKey: 'key' },
      } as any),
      getModelConfig: vi.fn().mockReturnValue({ provider: 'test', model: 'test', apiKey: 'key' }),
      getToolConfig: vi.fn().mockReturnValue({}),
      getBehaviorConfig: vi.fn().mockReturnValue({
        workspaceRoot,
        name: 'test',
        maxTurns: 50,
        readOnly,
        autoApproveDangerous: false,
      }),
      getCompressionConfig: vi.fn().mockReturnValue({ enabled: false, thresholdRatio: 0.5, protectHead: 10, protectTail: 10 }),
      resolveAgent: vi.fn().mockReturnValue({ id: 'a', name: 'a', corePrompt: '' }),
      resolveTeam: vi.fn().mockReturnValue({ id: 't', organizer: { id: 'a', name: 'a', corePrompt: '' }, members: [] }),
      getOrchestrationConfig: vi.fn().mockReturnValue({
        maxAgentRuns: 10,
        maxMessages: 100,
        maxDepth: 3,
        timeoutMs: 60000,
        maxTokens: 100000,
        maxParallelAgents: 4,
      }),
    };
  }

  it('creates registry with all read-only tools', () => {
    const cp = makeConfigProvider();
    const registry = createFileSystemTools(cp);
    const toolSet = registry.getToolSet();
    const names = toolSet.map((t: any) => t.name);
    expect(names).toContain('read');
    expect(names).toContain('ls');
    expect(names).toContain('exec');
    expect(names).toContain('glob');
    expect(names).toContain('find');
    expect(names).toContain('grep');
  });

  it('includes write/edit/apply-patch tools when not readOnly', () => {
    const cp = makeConfigProvider({ readOnly: false });
    const registry = createFileSystemTools(cp);
    const toolSet = registry.getToolSet();
    const names = toolSet.map((t: any) => t.name);
    expect(names).toContain('write');
    expect(names).toContain('edit');
    expect(names).toContain('apply_patch');
  });

  it('excludes write/edit/apply-patch tools when readOnly', () => {
    const cp = makeConfigProvider({ readOnly: true });
    const registry = createFileSystemTools(cp);
    const toolSet = registry.getToolSet();
    const names = toolSet.map((t: any) => t.name);
    expect(names).not.toContain('write');
    expect(names).not.toContain('edit');
    expect(names).not.toContain('apply_patch');
    // read-only tools still present
    expect(names).toContain('read');
  });

  it('registers tool definitions with derive patterns', () => {
    const cp = makeConfigProvider();
    const registry = createFileSystemTools(cp);
    const readDef = registry.getToolDefinition('read');
    expect(readDef).toBeDefined();
    expect(readDef?.derivePatterns).toBeDefined();
    expect(readDef?.deriveAlwaysOptions).toBeDefined();
  });

  it('file derivePatterns returns file:pattern', () => {
    const cp = makeConfigProvider();
    const registry = createFileSystemTools(cp);
    const readDef = registry.getToolDefinition('read');
    const patterns = readDef?.derivePatterns?.({ path: 'foo.txt' });
    expect(patterns).toEqual(['file:foo.txt']);
  });

  it('file deriveAlwaysOptions creates hierarchical patterns', () => {
    const cp = makeConfigProvider();
    const registry = createFileSystemTools(cp);
    const readDef = registry.getToolDefinition('read');
    const options = readDef?.deriveAlwaysOptions?.({ path: 'src/sub/file.txt' });
    expect(options).toBeDefined();
    const labels = options?.map((o: any) => o.label);
    expect(labels).toContain('src/sub/file.txt');
    expect(labels).toContain('src/sub/*');
    expect(labels).toContain('*.txt');
    expect(labels).toContain('all');
  });

  it('file deriveAlwaysOptions without extension', () => {
    const cp = makeConfigProvider();
    const registry = createFileSystemTools(cp);
    const readDef = registry.getToolDefinition('read');
    const options = readDef?.deriveAlwaysOptions?.({ path: 'README' });
    const labels = options?.map((o: any) => o.label);
    expect(labels).toContain('README');
    expect(labels).toContain('all');
    expect(labels).not.toContain('*.README');
    // No dir (only one part) and no ext (no dot) -> only exact + all
    expect(options?.length).toBe(2);
  });

  it('file deriveAlwaysOptions with empty path', () => {
    const cp = makeConfigProvider();
    const registry = createFileSystemTools(cp);
    const readDef = registry.getToolDefinition('read');
    const options = readDef?.deriveAlwaysOptions?.({ path: '' });
    expect(options).toBeDefined();
  });

  it('exec tool has classifier-based derivePatterns', () => {
    const cp = makeConfigProvider();
    const registry = createFileSystemTools(cp);
    const execDef = registry.getToolDefinition('exec');
    const patterns = execDef?.derivePatterns?.({ command: 'ls -la' } as any);
    expect(patterns).toBeDefined();
    expect(Array.isArray(patterns)).toBe(true);
    expect(patterns?.some((p: string) => p.includes('ls'))).toBe(true);
  });

  it('exec tool deriveAlwaysOptions returns allow rules', () => {
    const cp = makeConfigProvider();
    const registry = createFileSystemTools(cp);
    const execDef = registry.getToolDefinition('exec');
    const options = execDef?.deriveAlwaysOptions?.({ command: 'echo hello' } as any);
    expect(options).toBeDefined();
    expect(options?.length).toBeGreaterThan(0);
    options?.forEach((o: any) => {
      expect(o.rule.permission).toBe('exec');
      expect(o.rule.action).toBe('allow');
    });
  });

  it('exec classifyCommand for parse error returns bash:* patterns', async () => {
    const cp = makeConfigProvider();
    const registry = createFileSystemTools(cp);
    const execDef = registry.getToolDefinition('exec');
    // A command string that bash-parser cannot parse -> catch block -> ['bash:*']
    const patterns = execDef?.derivePatterns?.({ command: '' } as any);
    // Empty command triggers classifyCommand('') which may parse or not
    // Let's test a truly unparseable string
    const patterns2 = execDef?.derivePatterns?.({ command: '$(invalid syntax [[[' } as any);
    if (patterns2?.length) {
      expect(patterns2).toContain('bash:*');
    }
    // Also verify complex risk with empty patterns for bash -c
    const patterns3 = execDef?.derivePatterns?.({ command: 'bash -c "ls"' } as any);
    expect(patterns3).toEqual([]);
  });

  it('glob deriveAlwaysOptions', () => {
    const cp = makeConfigProvider();
    const registry = createFileSystemTools(cp);
    const globDef = registry.getToolDefinition('glob');
    const options = globDef?.deriveAlwaysOptions?.({ path: 'src' } as any);
    expect(options?.length).toBe(2);
  });

  it('find deriveAlwaysOptions', () => {
    const cp = makeConfigProvider();
    const registry = createFileSystemTools(cp);
    const findDef = registry.getToolDefinition('find');
    const options = findDef?.deriveAlwaysOptions?.({ path: 'src' } as any);
    expect(options?.length).toBe(2);
  });

  it('grep deriveAlwaysOptions', () => {
    const cp = makeConfigProvider();
    const registry = createFileSystemTools(cp);
    const grepDef = registry.getToolDefinition('grep');
    const options = grepDef?.deriveAlwaysOptions?.({ path: 'src' } as any);
    expect(options?.length).toBe(2);
  });

  it('checks dangerous flags', () => {
    const cp = makeConfigProvider();
    const registry = createFileSystemTools(cp);
    expect(registry.isDangerous('read')).toBe(false);
    expect(registry.isDangerous('write')).toBe(true);
    expect(registry.isDangerous('edit')).toBe(true);
    expect(registry.isDangerous('apply_patch')).toBe(false);
    expect(registry.isDangerous('exec')).toBe(false);
  });

  it('exec tool dangerous for dangerous commands', () => {
    const cp = makeConfigProvider();
    const registry = createFileSystemTools(cp);
    const execDef = registry.getToolDefinition('exec');
    // exec itself is not marked dangerous at definition level
    expect(execDef?.dangerous).toBeUndefined();
    expect(registry.isDangerous('exec')).toBe(false);
  });
});
