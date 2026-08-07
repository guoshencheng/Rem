import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir, access } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import type { ToolContext } from '../src/sdk/tool-provider.js';
import { createFileMutationQueue } from '../src/plugins/tool/file-system/shared/file-mutation-queue.js';
import {
  Edit,
  stripBom,
  detectLineEnding,
  normalizeToLF,
  restoreLineEndings,
  applyEditsToNormalizedContent,
  generateDiffString,
  generateUnifiedPatch,
  computeEditsDiff,
} from '../src/plugins/tool/file-system/edit-diff.js';
import {
  EDIT_MISMATCH_MESSAGE,
  EDIT_MISMATCH_HINT_LIMIT,
  removeExactOccurrences,
  didEditLikelyApply,
  appendMismatchHint,
} from '../src/plugins/tool/file-system/edit-recovery.js';
import { createEditToolDefinition, createEditToolExecutor } from '../src/plugins/tool/file-system/edit.js';
import {
  createApplyPatchToolDefinition,
  createApplyPatchToolExecutor,
  deriveApplyPatchPatterns,
  deriveApplyPatchAlwaysOptions,
} from '../src/plugins/tool/file-system/apply-patch.js';
import {
  parsePatchText,
  PatchHunk,
  PatchOperation,
} from '../src/plugins/tool/file-system/apply-patch-parser.js';
import {
  executePatchOperations,
} from '../src/plugins/tool/file-system/apply-patch-executor.js';

let tmpDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rem-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const d of tmpDirs) {
    await rm(d, { recursive: true, force: true });
  }
  tmpDirs = [];
});

function makeToolContext(workspaceRoot: string, overrides: Partial<ToolContext> = {}): ToolContext {
  return { cwd: workspaceRoot, workspaceRoot, ...overrides };
}

async function writeTestFile(dir: string, name: string, content: string): Promise<string> {
  const filePath = join(dir, name);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
  return filePath;
}

// ─── edit-diff.ts ────────────────────────────────────────────────

describe('stripBom', () => {
  it('removes BOM from text starting with BOM', () => {
    expect(stripBom('\uFEFFhello')).toBe('hello');
  });

  it('returns unchanged text without BOM', () => {
    expect(stripBom('hello')).toBe('hello');
  });

  it('handles empty string', () => {
    expect(stripBom('')).toBe('');
  });

  it('removes only the BOM, not other Unicode', () => {
    expect(stripBom('\uFEFFhi')).toBe('hi');
  });
});

describe('detectLineEnding', () => {
  it('detects CRLF', () => {
    expect(detectLineEnding('line1\r\nline2')).toBe('\r\n');
  });

  it('returns LF by default', () => {
    expect(detectLineEnding('line1\nline2')).toBe('\n');
  });

  it('handles empty string', () => {
    expect(detectLineEnding('')).toBe('\n');
  });

  it('prefers CRLF over LF', () => {
    expect(detectLineEnding('a\r\nb\nc')).toBe('\r\n');
  });
});

describe('normalizeToLF', () => {
  it('converts CRLF to LF', () => {
    expect(normalizeToLF('line1\r\nline2')).toBe('line1\nline2');
  });

  it('keeps LF unchanged', () => {
    expect(normalizeToLF('line1\nline2')).toBe('line1\nline2');
  });

  it('handles mixed line endings', () => {
    expect(normalizeToLF('a\r\nb\nc\r\nd')).toBe('a\nb\nc\nd');
  });

  it('handles empty string', () => {
    expect(normalizeToLF('')).toBe('');
  });
});

describe('restoreLineEndings', () => {
  it('converts LF to CRLF when lineEnding is CRLF', () => {
    expect(restoreLineEndings('line1\nline2', '\r\n')).toBe('line1\r\nline2');
  });

  it('keeps LF when lineEnding is LF', () => {
    expect(restoreLineEndings('line1\nline2', '\n')).toBe('line1\nline2');
  });

  it('handles empty string', () => {
    expect(restoreLineEndings('', '\r\n')).toBe('');
  });
});

describe('applyEditsToNormalizedContent', () => {
  it('applies a single edit', () => {
    expect(applyEditsToNormalizedContent('hello world', [
      { oldText: 'hello', newText: 'hi' },
    ])).toBe('hi world');
  });

  it('applies multiple edits sequentially', () => {
    expect(applyEditsToNormalizedContent('a b c', [
      { oldText: 'a', newText: 'x' },
      { oldText: 'c', newText: 'z' },
    ])).toBe('x b z');
  });

  it('throws when oldText is not found (0 matches)', () => {
    expect(() => applyEditsToNormalizedContent('hello', [
      { oldText: 'goodbye', newText: 'hi' },
    ])).toThrow(/found 0 matches/);
  });

  it('throws when oldText appears multiple times', () => {
    expect(() => applyEditsToNormalizedContent('a a a', [
      { oldText: 'a', newText: 'x' },
    ])).toThrow(/found 3 matches/);
  });

  it('works with CRLF in edits (normalizes oldText)', () => {
    expect(applyEditsToNormalizedContent('hello\nworld', [
      { oldText: 'hello\r\nworld', newText: 'hi there' },
    ])).toBe('hi there');
  });

  it('handles empty edits array', () => {
    expect(applyEditsToNormalizedContent('hello', [])).toBe('hello');
  });
});

describe('generateDiffString', () => {
  it('generates diff for one added line', () => {
    const result = generateDiffString('line1', 'line1\nline2');
    expect(result).toBe(' line1\n+line2');
  });

  it('generates diff for one removed line', () => {
    const result = generateDiffString('line1\nline2', 'line1');
    expect(result).toBe(' line1\n-line2');
  });

  it('generates diff for one modified line', () => {
    const result = generateDiffString('old', 'new');
    expect(result).toBe('-old\n+new');
  });

  it('handles identical content', () => {
    const result = generateDiffString('same', 'same');
    expect(result).toBe(' same');
  });

  it('handles empty original', () => {
    const result = generateDiffString('', 'new');
    expect(result).toContain('-');
    expect(result).toContain('+new');
  });

  it('handles empty modified', () => {
    const result = generateDiffString('old', '');
    expect(result).toContain('-old');
    expect(result).toContain('+');
  });

  it('handles multiple adds at end', () => {
    const result = generateDiffString('a', 'a\nb\nc');
    expect(result).toBe(' a\n+b\n+c');
  });

  it('handles multiple removes at end', () => {
    const result = generateDiffString('a\nb\nc', 'a');
    expect(result).toBe(' a\n-b\n-c');
  });

  it('mixes add, remove, and preserve', () => {
    const result = generateDiffString('a\nb\nc', 'a\nd\nc');
    expect(result).toBe(' a\n-b\n+d\n c');
  });
});

describe('generateUnifiedPatch', () => {
  it('generates unified patch', () => {
    const result = generateUnifiedPatch('test.txt', 'old', 'new');
    expect(result).toBe('--- test.txt\n+++ test.txt\n-old\n+new');
  });

  it('includes path in header', () => {
    const result = generateUnifiedPatch('/dir/file.ts', 'a', 'b');
    expect(result).toBe('--- /dir/file.ts\n+++ /dir/file.ts\n-a\n+b');
  });
});

describe('computeEditsDiff', () => {
  it('returns diff result for successful edits', () => {
    const result = computeEditsDiff('test.txt', 'hello world', [
      { oldText: 'hello', newText: 'hi' },
    ]);
    expect('diff' in result).toBe(true);
    if ('diff' in result) {
      expect(result.diff).toContain('-hello world');
      expect(result.diff).toContain('+hi world');
      expect(result.patch).toContain('--- test.txt');
      expect(result.patch).toContain('+++ test.txt');
      expect(result.firstChangedLine).toBe(1);
    }
  });

  it('returns diff error for failed edits', () => {
    const result = computeEditsDiff('test.txt', 'hello', [
      { oldText: 'goodbye', newText: 'hi' },
    ]);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toBeInstanceOf(Error);
    }
  });

  it('handles BOM in original content', () => {
    const result = computeEditsDiff('test.txt', '\uFEFFhello world', [
      { oldText: 'hello', newText: 'hi' },
    ]);
    expect('diff' in result).toBe(true);
    if ('diff' in result) {
      expect(result.patch).toContain('--- test.txt');
    }
  });

  it('handles CRLF in original content', () => {
    const result = computeEditsDiff('test.txt', 'hello\r\nworld', [
      { oldText: 'hello', newText: 'hi' },
    ]);
    expect('diff' in result).toBe(true);
    if ('diff' in result) {
      expect(result.patch).toContain('--- test.txt');
    }
  });

  it('detects firstChangedLine', () => {
    const result = computeEditsDiff('test.txt', 'line1\nline2\nline3', [
      { oldText: 'line2', newText: 'newLine2' },
    ]);
    expect('diff' in result).toBe(true);
    if ('diff' in result) {
      expect(result.firstChangedLine).toBe(2);
    }
  });

  it('returns undefined firstChangedLine when no diff', () => {
    const result = computeEditsDiff('test.txt', 'same', [
      { oldText: 'same', newText: 'same' },
    ]);
    expect('diff' in result).toBe(true);
    if ('diff' in result) {
      expect(result.firstChangedLine).toBeUndefined();
    }
  });
});

// ─── edit-recovery.ts ────────────────────────────────────────────

describe('edit-recovery constants', () => {
  it('EDIT_MISMATCH_MESSAGE is exported', () => {
    expect(EDIT_MISMATCH_MESSAGE).toBe('Could not find the exact text in');
  });

  it('EDIT_MISMATCH_HINT_LIMIT is 800', () => {
    expect(EDIT_MISMATCH_HINT_LIMIT).toBe(800);
  });
});

describe('removeExactOccurrences', () => {
  it('removes all occurrences of needle', () => {
    expect(removeExactOccurrences('ababa', 'a')).toBe('bb');
  });

  it('handles empty needle', () => {
    expect(removeExactOccurrences('hello', '')).toBe('hello');
  });

  it('handles needle not found', () => {
    expect(removeExactOccurrences('hello', 'x')).toBe('hello');
  });

  it('handles empty content', () => {
    expect(removeExactOccurrences('', 'a')).toBe('');
  });

  it('handles empty content and empty needle', () => {
    expect(removeExactOccurrences('', '')).toBe('');
  });

  it('removes multi-char needle', () => {
    expect(removeExactOccurrences('foobarbarfoo', 'bar')).toBe('foofoo');
  });
});

describe('didEditLikelyApply', () => {
  it('returns false when edits are empty', () => {
    expect(didEditLikelyApply({
      originalContent: 'hello',
      currentContent: 'hello',
      edits: [],
    })).toBe(false);
  });

  it('returns false when original equals current (no change)', () => {
    expect(didEditLikelyApply({
      originalContent: 'hello',
      currentContent: 'hello',
      edits: [{ oldText: 'hello', newText: 'hi' }],
    })).toBe(false);
  });

  it('returns true when edits likely applied', () => {
    expect(didEditLikelyApply({
      originalContent: 'hello world',
      currentContent: 'hi world',
      edits: [{ oldText: 'hello', newText: 'hi' }],
    })).toBe(true);
  });

  it('returns false when newText is not found in current content', () => {
    expect(didEditLikelyApply({
      originalContent: 'hello world',
      currentContent: 'goodbye world',
      edits: [{ oldText: 'hello', newText: 'hi' }],
    })).toBe(false);
  });

  it('returns false when oldText still appears in current content', () => {
    expect(didEditLikelyApply({
      originalContent: 'hello hello',
      currentContent: 'hi hello',
      edits: [{ oldText: 'hello', newText: 'hi' }],
    })).toBe(false);
  });

  it('handles CRLF line endings', () => {
    expect(didEditLikelyApply({
      originalContent: 'hello\r\nworld',
      currentContent: 'hi\r\nworld',
      edits: [{ oldText: 'hello', newText: 'hi' }],
    })).toBe(true);
  });

  it('handles multiple edits', () => {
    expect(didEditLikelyApply({
      originalContent: 'a b c',
      currentContent: 'x y c',
      edits: [
        { oldText: 'a', newText: 'x' },
        { oldText: 'b', newText: 'y' },
      ],
    })).toBe(true);
  });

  it('returns false when one of multiple edits not applied', () => {
    expect(didEditLikelyApply({
      originalContent: 'a b c',
      currentContent: 'x z c',
      edits: [
        { oldText: 'a', newText: 'x' },
        { oldText: 'b', newText: 'y' },
      ],
    })).toBe(false);
  });
});

describe('appendMismatchHint', () => {
  it('appends full content when within limit', () => {
    const original = new Error(EDIT_MISMATCH_MESSAGE);
    const enhanced = appendMismatchHint(original, 'hello');
    expect(enhanced.message).toContain(EDIT_MISMATCH_MESSAGE);
    expect(enhanced.message).toContain('Current file contents:');
    expect(enhanced.message).toContain('hello');
  });

  it('truncates long content', () => {
    const longContent = 'x'.repeat(1000);
    const original = new Error(EDIT_MISMATCH_MESSAGE);
    const enhanced = appendMismatchHint(original, longContent);
    expect(enhanced.message).toContain('(truncated)');
    expect(enhanced.message.length).toBeLessThan(longContent.length + 200);
  });

  it('content exactly at limit is not truncated', () => {
    const exactContent = 'x'.repeat(EDIT_MISMATCH_HINT_LIMIT);
    const original = new Error(EDIT_MISMATCH_MESSAGE);
    const enhanced = appendMismatchHint(original, exactContent);
    expect(enhanced.message).not.toContain('(truncated)');
  });

  it('content at limit + 1 is truncated', () => {
    const overContent = 'x'.repeat(EDIT_MISMATCH_HINT_LIMIT + 1);
    const original = new Error(EDIT_MISMATCH_MESSAGE);
    const enhanced = appendMismatchHint(original, overContent);
    expect(enhanced.message).toContain('(truncated)');
  });

  it('preserves error stack', () => {
    const original = new Error(EDIT_MISMATCH_MESSAGE);
    original.stack = 'test stack';
    const enhanced = appendMismatchHint(original, 'hello');
    expect(enhanced.stack).toBe('test stack');
  });
});

// ─── edit.ts ─────────────────────────────────────────────────────

describe('createEditToolDefinition', () => {
  it('returns a valid tool definition', () => {
    const def = createEditToolDefinition();
    expect(def.name).toBe('edit');
    expect(def.category).toBe('filesystem');
    expect(def.dangerous).toBe(true);
  });
});

describe('createEditToolExecutor', () => {
  it('throws in read-only mode', async () => {
    const queue = createFileMutationQueue();
    const executor = createEditToolExecutor(queue);
    const dir = await createTempDir();
    const ctx = makeToolContext(dir, { readOnly: true });
    await expect(executor({ path: 'test.txt', edits: [{ oldText: 'a', newText: 'b' }] }, ctx))
      .rejects.toThrow('read-only mode');
  });

  it('throws on empty edits array', async () => {
    const queue = createFileMutationQueue();
    const executor = createEditToolExecutor(queue);
    const dir = await createTempDir();
    const ctx = makeToolContext(dir);
    await expect(executor({ path: 'test.txt', edits: [] } as any, ctx))
      .rejects.toThrow('at least one replacement');
  });

  it('throws when file does not exist', async () => {
    const queue = createFileMutationQueue();
    const executor = createEditToolExecutor(queue);
    const dir = await createTempDir();
    const ctx = makeToolContext(dir);
    await expect(executor({ path: 'nonexistent.txt', edits: [{ oldText: 'a', newText: 'b' }] }, ctx))
      .rejects.toThrow();
  });

  it('successfully edits a file', async () => {
    const queue = createFileMutationQueue();
    const executor = createEditToolExecutor(queue);
    const dir = await createTempDir();
    const file = await writeTestFile(dir, 'test.txt', 'hello world');
    const ctx = makeToolContext(dir);
    const result = await executor({ path: 'test.txt', edits: [{ oldText: 'hello', newText: 'hi' }] }, ctx);
    expect(result.output).toBe('Successfully edited test.txt');
    expect(result.details).toBeDefined();
    const { readFile } = await import('fs/promises');
    const content = await readFile(file, 'utf8');
    expect(content).toBe('hi world');
  });

  it('throws with mismatch hint when edit not found', async () => {
    const queue = createFileMutationQueue();
    const executor = createEditToolExecutor(queue);
    const dir = await createTempDir();
    await writeTestFile(dir, 'test.txt', 'hello world');
    const ctx = makeToolContext(dir);
    await expect(executor({ path: 'test.txt', edits: [{ oldText: 'goodbye', newText: 'bye' }] }, ctx))
      .rejects.toThrow(EDIT_MISMATCH_MESSAGE);
  });

  it('rethrows non-mismatch errors unchanged', async () => {
    const queue = createFileMutationQueue();
    const executor = createEditToolExecutor(queue);
    const dir = await createTempDir();
    await writeTestFile(dir, 'test.txt', 'hello hello');
    const ctx = makeToolContext(dir);
    try {
      await executor({ path: 'test.txt', edits: [{ oldText: 'hello', newText: 'hi' }] }, ctx);
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e.message).toContain('found 2 matches');
    }
  });

  it('handles oldText+newText shorthand input', async () => {
    const queue = createFileMutationQueue();
    const executor = createEditToolExecutor(queue);
    const dir = await createTempDir();
    const file = await writeTestFile(dir, 'test.txt', 'before after');
    const ctx = makeToolContext(dir);
    const result = await executor({
      path: 'test.txt',
      oldText: 'before',
      newText: 'after',
    } as any, ctx);
    expect(result.output).toBe('Successfully edited test.txt');
    const { readFile } = await import('fs/promises');
    const content = await readFile(file, 'utf8');
    expect(content).toBe('after after');
  });

  it('handles oldText+newText with existing edits array', async () => {
    const queue = createFileMutationQueue();
    const executor = createEditToolExecutor(queue);
    const dir = await createTempDir();
    const file = await writeTestFile(dir, 'test.txt', 'a b c');
    const ctx = makeToolContext(dir);
    const result = await executor({
      path: 'test.txt',
      edits: [{ oldText: 'b', newText: 'x' }],
      oldText: 'c',
      newText: 'z',
    } as any, ctx);
    expect(result.output).toBe('Successfully edited test.txt');
    const { readFile } = await import('fs/promises');
    const content = await readFile(file, 'utf8');
    expect(content).toBe('a x z');
  });

  it('handles edits as JSON string', async () => {
    const queue = createFileMutationQueue();
    const executor = createEditToolExecutor(queue);
    const dir = await createTempDir();
    const file = await writeTestFile(dir, 'test.txt', 'hello world');
    const ctx = makeToolContext(dir);
    const result = await executor({
      path: 'test.txt',
      edits: '[{"oldText":"hello","newText":"hi"}]',
    } as any, ctx);
    expect(result.output).toBe('Successfully edited test.txt');
    const { readFile } = await import('fs/promises');
    const content = await readFile(file, 'utf8');
    expect(content).toBe('hi world');
  });

  it('handles null/undefined input gracefully', async () => {
    const queue = createFileMutationQueue();
    const executor = createEditToolExecutor(queue);
    const dir = await createTempDir();
    const ctx = makeToolContext(dir);
    await expect(executor(null as any, ctx)).rejects.toThrow('Invalid edit tool input');
    await expect(executor(undefined as any, ctx)).rejects.toThrow('Invalid edit tool input');
  });

  it('handles invalid JSON in edits string', async () => {
    const queue = createFileMutationQueue();
    const executor = createEditToolExecutor(queue);
    const dir = await createTempDir();
    const ctx = makeToolContext(dir);
    await expect(executor({ path: 'test.txt', edits: 'not json' } as any, ctx))
      .rejects.toThrow('at least one replacement');
  });

  it('handles file with BOM', async () => {
    const queue = createFileMutationQueue();
    const executor = createEditToolExecutor(queue);
    const dir = await createTempDir();
    const file = await writeTestFile(dir, 'test.txt', '\uFEFFhello world');
    const ctx = makeToolContext(dir);
    const result = await executor({ path: 'test.txt', edits: [{ oldText: 'hello', newText: 'hi' }] }, ctx);
    expect(result.output).toBe('Successfully edited test.txt');
    const { readFile } = await import('fs/promises');
    const content = await readFile(file, 'utf8');
    expect(content).toBe('\uFEFFhi world');
  });

  it('handles file with CRLF line endings', async () => {
    const queue = createFileMutationQueue();
    const executor = createEditToolExecutor(queue);
    const dir = await createTempDir();
    const file = await writeTestFile(dir, 'test.txt', 'line1\r\nline2\r\n');
    const ctx = makeToolContext(dir);
    const result = await executor({ path: 'test.txt', edits: [{ oldText: 'line1', newText: 'replaced' }] }, ctx);
    expect(result.output).toBe('Successfully edited test.txt');
    const { readFile } = await import('fs/promises');
    const content = await readFile(file, 'utf8');
    expect(content).toBe('replaced\r\nline2\r\n');
  });
});

// ─── apply-patch-parser.ts ───────────────────────────────────────

describe('parsePatchText', () => {
  it('parses Add File operation', () => {
    const result = parsePatchText(`*** Begin Patch
*** Add File: src/test.ts
@@ context
 content
+added
*** End File`);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('add');
    expect(result[0].path).toBe('src/test.ts');
    expect(result[0].hunks).toHaveLength(1);
    expect(result[0].hunks[0].context).toBe('context');
    expect(result[0].hunks[0].oldLines).toEqual(['content']);
    expect(result[0].hunks[0].newLines).toEqual(['added']);
  });

  it('parses Update File operation', () => {
    const result = parsePatchText(`*** Begin Patch
*** Update File: src/test.ts
@@ context
 old
+new
*** End File`);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('update');
    expect(result[0].path).toBe('src/test.ts');
    expect(result[0].hunks[0].context).toBe('context');
    expect(result[0].hunks[0].oldLines).toEqual(['old']);
    expect(result[0].hunks[0].newLines).toEqual(['new']);
  });

  it('parses Delete File operation', () => {
    const result = parsePatchText(`*** Begin Patch
*** Delete File: src/test.ts
*** End Patch`);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('delete');
    expect(result[0].path).toBe('src/test.ts');
    expect(result[0].hunks).toHaveLength(0);
  });

  it('parses Move to after Update', () => {
    const result = parsePatchText(`*** Begin Patch
*** Update File: src/old.ts
*** Move to: src/new.ts
@@ context
+line
*** End File`);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('update');
    expect(result[0].path).toBe('src/old.ts');
    expect(result[0].newPath).toBe('src/new.ts');
  });

  it('throws when Move to is not preceded by Update', () => {
    expect(() => parsePatchText(`*** Begin Patch
*** Add File: src/test.ts
*** Move to: src/new.ts
*** End File`)).toThrow(/"Move to" must follow an Update/);
  });

  it('throws on unrecognized *** directive', () => {
    expect(() => parsePatchText(`*** Begin Patch
*** Unknown: src/test.ts
*** End File`)).toThrow(/unrecognized patch directive/);
  });

  it('throws on invalid hunk line', () => {
    expect(() => parsePatchText(`*** Begin Patch
*** Update File: src/test.ts
@@ context
*invalid
*** End File`)).toThrow(/invalid hunk line/);
  });

  it('parses multiple operations', () => {
    const result = parsePatchText(`*** Begin Patch
*** Add File: src/a.ts
@@ context
+newA
*** End File
*** Update File: src/b.ts
@@ context2
 old
+new
*** End File`);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('add');
    expect(result[1].type).toBe('update');
  });

  it('flushes hunks on End File / End of File / End Patch markers', () => {
    const result = parsePatchText(`*** Begin Patch
*** Update File: src/test.ts
@@ ctx
 old
+new
*** End File`);
    expect(result).toHaveLength(1);
    expect(result[0].hunks).toHaveLength(1);
  });

  it('handles empty hunk lines (flushes unmodified)', () => {
    const result = parsePatchText(`*** Begin Patch
*** Update File: src/test.ts
@@ context
*** End Patch`);
    expect(result).toHaveLength(1);
    expect(result[0].hunks).toHaveLength(0);
  });

  it('strips marker from hunk lines', () => {
    const result = parsePatchText(`*** Begin Patch
*** Update File: src/test.ts
@@ ctx
  line
+added
-removed
*** End Patch`);
    expect(result[0].hunks[0].oldLines).toContain('line');
    expect(result[0].hunks[0].oldLines).toContain('removed');
    expect(result[0].hunks[0].newLines).toContain('added');
  });

  it('handles space marker with extra leading space', () => {
    const result = parsePatchText(`*** Begin Patch
*** Update File: src/test.ts
@@ ctx
+abc
*** End Patch`);
    expect(result[0].hunks[0].newLines[0]).toBe('abc');
  });

  it('handles minus-only hunk lines', () => {
    const result = parsePatchText(`*** Begin Patch
*** Update File: src/test.ts
@@ ctx
-removed
*** End Patch`);
    expect(result[0].hunks[0].oldLines).toContain('removed');
    expect(result[0].hunks[0].newLines).toHaveLength(0);
  });

  it('handles empty content after stripMarker (single char line)', () => {
    const result = parsePatchText(`*** Begin Patch
*** Update File: src/test.ts
@@ ctx
+ 
*** End File`);
    expect(result[0].hunks[0].newLines[0]).toBe('');
  });

  it('handles Begin Patch marker', () => {
    const result = parsePatchText(`*** Begin Patch
*** Delete File: src/test.ts`);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('delete');
  });

  it('handles End of File marker', () => {
    const result = parsePatchText(`*** Begin Patch
*** Delete File: src/test.ts
*** End of File`);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('delete');
  });

  it('handles empty lines between operations', () => {
    const result = parsePatchText(`*** Begin Patch

*** Delete File: src/test.ts

*** End Patch`);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('delete');
  });

  it('skips hunk lines when no current hunk', () => {
    const result = parsePatchText(`*** Begin Patch
*** Update File: src/test.ts
 orphan line
@@ ctx
 old
+new
*** End File`);
    expect(result).toHaveLength(1);
    expect(result[0].hunks).toHaveLength(1);
  });

  it('@@ without space prefix', () => {
    const result = parsePatchText(`*** Begin Patch
*** Update File: src/test.ts
@@ctx
 old
+new
*** End File`);
    expect(result[0].hunks[0].context).toBe('ctx');
  });
});

// ─── apply-patch-executor.ts ─────────────────────────────────────

describe('executePatchOperations', () => {
  it('executes delete operation', async () => {
    const dir = await createTempDir();
    await writeTestFile(dir, 'test.txt', 'content');
    const queue = createFileMutationQueue();
    const ctx = makeToolContext(dir);
    const result = await executePatchOperations(
      [{ type: 'delete', path: 'test.txt', hunks: [] }],
      ctx, queue,
    );
    expect(result).toEqual(['Deleted: test.txt']);
    await expect(access(join(dir, 'test.txt'))).rejects.toThrow();
  });

  it('executes add operation', async () => {
    const dir = await createTempDir();
    const queue = createFileMutationQueue();
    const ctx = makeToolContext(dir);
    const result = await executePatchOperations(
      [{
        type: 'add', path: 'test.txt', hunks: [
          { context: '', oldLines: [], newLines: ['line1', 'line2'] },
        ],
      }],
      ctx, queue,
    );
    expect(result).toEqual(['Added: test.txt']);
    const { readFile } = await import('fs/promises');
    const content = await readFile(join(dir, 'test.txt'), 'utf8');
    expect(content).toBe('line1\nline2');
  });

  it('throws when adding a file that already exists', async () => {
    const dir = await createTempDir();
    await writeTestFile(dir, 'test.txt', 'existing');
    const queue = createFileMutationQueue();
    const ctx = makeToolContext(dir);
    await expect(executePatchOperations(
      [{ type: 'add', path: 'test.txt', hunks: [{ context: '', oldLines: [], newLines: ['new'] }] }],
      ctx, queue,
    )).rejects.toThrow(/File already exists/);
  });

  it('adds file in subdirectory (creates dirs)', async () => {
    const dir = await createTempDir();
    const queue = createFileMutationQueue();
    const ctx = makeToolContext(dir);
    await executePatchOperations(
      [{
        type: 'add', path: 'sub/dir/test.txt', hunks: [
          { context: '', oldLines: [], newLines: ['content'] },
        ],
      }],
      ctx, queue,
    );
    const { readFile } = await import('fs/promises');
    const content = await readFile(join(dir, 'sub/dir/test.txt'), 'utf8');
    expect(content).toBe('content');
  });

  it('executes update operation', async () => {
    const dir = await createTempDir();
    await writeTestFile(dir, 'test.txt', 'context\nold1\nold2\nafter');
    const queue = createFileMutationQueue();
    const ctx = makeToolContext(dir);
    const result = await executePatchOperations(
      [{
        type: 'update', path: 'test.txt', hunks: [
          { context: 'context', oldLines: ['old1', 'old2'], newLines: ['new1', 'new2'] },
        ],
      }],
      ctx, queue,
    );
    expect(result).toEqual(['Updated: test.txt']);
    const { readFile } = await import('fs/promises');
    const content = await readFile(join(dir, 'test.txt'), 'utf8');
    expect(content).toBe('context\nnew1\nnew2\nafter');
  });

  it('executes update with move (rename)', async () => {
    const dir = await createTempDir();
    await writeTestFile(dir, 'old.ts', 'context\nold\nend');
    const queue = createFileMutationQueue();
    const ctx = makeToolContext(dir);
    const result = await executePatchOperations(
      [{
        type: 'update', path: 'old.ts', newPath: 'new.ts', hunks: [
          { context: 'context', oldLines: ['old'], newLines: ['new'] },
        ],
      }],
      ctx, queue,
    );
    expect(result).toEqual(['Moved: old.ts -> new.ts']);
    const { readFile } = await import('fs/promises');
    const newContent = await readFile(join(dir, 'new.ts'), 'utf8');
    expect(newContent).toBe('context\nnew\nend');
    await expect(access(join(dir, 'old.ts'))).rejects.toThrow();
  });

  it('throws when update context not found', async () => {
    const dir = await createTempDir();
    await writeTestFile(dir, 'test.txt', 'content');
    const queue = createFileMutationQueue();
    const ctx = makeToolContext(dir);
    await expect(executePatchOperations(
      [{
        type: 'update', path: 'test.txt', hunks: [
          { context: 'nonexistent', oldLines: ['a'], newLines: ['b'] },
        ],
      }],
      ctx, queue,
    )).rejects.toThrow(/Could not locate context/);
  });

  it('throws when update context mismatch (wrong oldLines)', async () => {
    const dir = await createTempDir();
    await writeTestFile(dir, 'test.txt', 'ctx\nwrong\nafter');
    const queue = createFileMutationQueue();
    const ctx = makeToolContext(dir);
    await expect(executePatchOperations(
      [{
        type: 'update', path: 'test.txt', hunks: [
          { context: 'ctx', oldLines: ['expected'], newLines: ['new'] },
        ],
      }],
      ctx, queue,
    )).rejects.toThrow(/Context mismatch/);
  });

  it('executes multiple operations', async () => {
    const dir = await createTempDir();
    await writeTestFile(dir, 'update.ts', 'ctx\nold\nend');
    const queue = createFileMutationQueue();
    const ctx = makeToolContext(dir);
    const result = await executePatchOperations(
      [
        { type: 'delete', path: 'update.ts', hunks: [] },
        { type: 'add', path: 'new.ts', hunks: [{ context: '', oldLines: [], newLines: ['replaced'] }] },
      ],
      ctx, queue,
    );
    expect(result).toEqual(['Deleted: update.ts', 'Added: new.ts']);
  });

  it('returns empty result for no operations', async () => {
    const dir = await createTempDir();
    const queue = createFileMutationQueue();
    const ctx = makeToolContext(dir);
    const result = await executePatchOperations([], ctx, queue);
    expect(result).toEqual([]);
  });

  it('handles multiple hunks in one operation', async () => {
    const dir = await createTempDir();
    await writeTestFile(dir, 'test.txt', 'ctx1\nold1\nmid\nctx2\nold2\nend');
    const queue = createFileMutationQueue();
    const ctx = makeToolContext(dir);
    await executePatchOperations(
      [{
        type: 'update', path: 'test.txt', hunks: [
          { context: 'ctx1', oldLines: ['old1'], newLines: ['new1'] },
          { context: 'ctx2', oldLines: ['old2'], newLines: ['new2'] },
        ],
      }],
      ctx, queue,
    );
    const { readFile } = await import('fs/promises');
    const content = await readFile(join(dir, 'test.txt'), 'utf8');
    expect(content).toBe('ctx1\nnew1\nmid\nctx2\nnew2\nend');
  });

  it('applies hunks in reverse order', async () => {
    const dir = await createTempDir();
    await writeTestFile(dir, 'test.txt', 'ctxA\noldA\nmid\nctxB\noldB\nend');
    const queue = createFileMutationQueue();
    const ctx = makeToolContext(dir);
    await executePatchOperations(
      [{
        type: 'update', path: 'test.txt', hunks: [
          { context: 'ctxA', oldLines: ['oldA'], newLines: ['newA'] },
          { context: 'ctxB', oldLines: ['oldB'], newLines: ['newB'] },
        ],
      }],
      ctx, queue,
    );
    const { readFile } = await import('fs/promises');
    const content = await readFile(join(dir, 'test.txt'), 'utf8');
    expect(content).toBe('ctxA\nnewA\nmid\nctxB\nnewB\nend');
  });
});

// ─── apply-patch.ts ──────────────────────────────────────────────

describe('createApplyPatchToolDefinition', () => {
  it('returns a valid tool definition', () => {
    const def = createApplyPatchToolDefinition();
    expect(def.name).toBe('apply_patch');
    expect(def.category).toBe('filesystem');
    expect(def.readOnly).toBe(false);
  });
});

describe('createApplyPatchToolExecutor', () => {
  it('throws in read-only mode', async () => {
    const executor = createApplyPatchToolExecutor();
    const dir = await createTempDir();
    const ctx = makeToolContext(dir, { readOnly: true });
    await expect(executor({ patchText: '' }, ctx)).rejects.toThrow('read-only mode');
  });

  it('returns (no changes applied) for empty operations', async () => {
    const executor = createApplyPatchToolExecutor();
    const dir = await createTempDir();
    const ctx = makeToolContext(dir);
    const result = await executor({ patchText: '' }, ctx);
    expect(result.output).toBe('(no changes applied)');
  });

  it('applies Add File patch', async () => {
    const executor = createApplyPatchToolExecutor();
    const dir = await createTempDir();
    const ctx = makeToolContext(dir);
    const patchText = `*** Add File: hello.ts
@@
+console.log('hello');
*** End Patch`;
    const result = await executor({ patchText }, ctx);
    expect(result.output).toBe('Added: hello.ts');
    const { readFile } = await import('fs/promises');
    const content = await readFile(join(dir, 'hello.ts'), 'utf8');
    expect(content).toContain("console.log('hello')");
  });

  it('applies Delete File patch', async () => {
    const executor = createApplyPatchToolExecutor();
    const dir = await createTempDir();
    await writeTestFile(dir, 'remove.ts', 'to delete');
    const ctx = makeToolContext(dir);
    const patchText = `*** Delete File: remove.ts`;
    const result = await executor({ patchText }, ctx);
    expect(result.output).toBe('Deleted: remove.ts');
    await expect(access(join(dir, 'remove.ts'))).rejects.toThrow();
  });

  it('applies Update File patch', async () => {
    const executor = createApplyPatchToolExecutor();
    const dir = await createTempDir();
    await writeTestFile(dir, 'update.ts', 'before\nold\nafter');
    const ctx = makeToolContext(dir);
    const patchText = `*** Update File: update.ts
@@ before
 old
+new
*** End File`;
    const result = await executor({ patchText }, ctx);
    expect(result.output).toBe('Updated: update.ts');
    const { readFile } = await import('fs/promises');
    const content = await readFile(join(dir, 'update.ts'), 'utf8');
    expect(content).toBe('before\nnew\nafter');
  });

  it('applies Update With Move patch', async () => {
    const executor = createApplyPatchToolExecutor();
    const dir = await createTempDir();
    await writeTestFile(dir, 'old.ts', 'ctx\nold\nend');
    const ctx = makeToolContext(dir);
    const patchText = `*** Update File: old.ts
*** Move to: new.ts
@@ ctx
 old
+new
*** End File`;
    const result = await executor({ patchText }, ctx);
    expect(result.output).toBe('Moved: old.ts -> new.ts');
  });

  it('applies multiple operations in one patch', async () => {
    const executor = createApplyPatchToolExecutor();
    const dir = await createTempDir();
    await writeTestFile(dir, 'remove.ts', 'x');
    const ctx = makeToolContext(dir);
    const patchText = `*** Delete File: remove.ts
*** Add File: create.ts
@@
+new stuff
*** End File`;
    const result = await executor({ patchText }, ctx);
    expect(result.output).toContain('Deleted: remove.ts');
    expect(result.output).toContain('Added: create.ts');
  });
});

describe('deriveApplyPatchPatterns', () => {
  it('returns file:* pattern', () => {
    expect(deriveApplyPatchPatterns()).toEqual(['file:*']);
  });
});

describe('deriveApplyPatchAlwaysOptions', () => {
  it('returns files permission option', () => {
    const options = deriveApplyPatchAlwaysOptions();
    expect(options).toHaveLength(1);
    expect(options[0].label).toBe('files');
    expect(options[0].rule.permission).toBe('apply_patch');
    expect(options[0].rule.pattern).toBe('*');
    expect(options[0].rule.action).toBe('allow');
  });
});
