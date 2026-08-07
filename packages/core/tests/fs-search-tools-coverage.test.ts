import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/sdk/tool-provider.js';
import { executeGlob } from '../src/plugins/tool/file-system/shared/glob-executor.js';
import {
  createFindToolDefinition,
  createFindToolExecutor,
  deriveFindPatterns,
  deriveFindAlwaysOptions,
} from '../src/plugins/tool/file-system/find.js';
import {
  createGlobToolDefinition,
  createGlobToolExecutor,
  deriveGlobPatterns,
  deriveGlobAlwaysOptions,
} from '../src/plugins/tool/file-system/glob.js';

// ─── helpers ──────────────────────────────────────────────────────
let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rem-fs-search-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

function ctx(dir: string): ToolContext {
  return { cwd: dir, workspaceRoot: dir };
}

// ─── glob-executor ────────────────────────────────────────────────
describe('glob-executor', () => {
  it('finds files matching a pattern', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'a.ts'), '');
    writeFileSync(join(dir, 'b.ts'), '');
    writeFileSync(join(dir, 'c.md'), '');
    const result = await executeGlob({ pattern: '*.ts' }, ctx(dir));
    expect(result).toContain('a.ts');
    expect(result).toContain('b.ts');
    expect(result).not.toContain('c.md');
  });

  it('finds files in subdirectories with recursive glob', async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'x.ts'), '');
    const result = await executeGlob({ pattern: '**/*.ts' }, ctx(dir));
    expect(result).toContain('sub/x.ts');
  });

  it('respects exclude as string', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'a.ts'), '');
    writeFileSync(join(dir, 'b.test.ts'), '');
    const result = await executeGlob({ pattern: '**/*.ts', exclude: '**/*.test.ts' }, ctx(dir));
    expect(result).toContain('a.ts');
    expect(result).not.toContain('b.test.ts');
  });

  it('respects exclude as array', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'keep.ts'), '');
    writeFileSync(join(dir, 'a.test.ts'), '');
    writeFileSync(join(dir, 'b.spec.ts'), '');
    const result = await executeGlob(
      { pattern: '**/*.ts', exclude: ['**/*.test.ts', '**/*.spec.ts'] },
      ctx(dir),
    );
    expect(result).toContain('keep.ts');
    expect(result).not.toContain('a.test.ts');
    expect(result).not.toContain('b.spec.ts');
  });

  it('ignores node_modules and .git by default', async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'node_modules', 'pkg.ts'), '');
    writeFileSync(join(dir, 'src.ts'), '');
    const result = await executeGlob({ pattern: '**/*.ts' }, ctx(dir));
    expect(result).not.toContain('node_modules/pkg.ts');
    expect(result).toContain('src.ts');
  });

  it('returns empty array when no matches', async () => {
    const dir = makeTempDir();
    const result = await executeGlob({ pattern: '*.zzz' }, ctx(dir));
    expect(result).toEqual([]);
  });

  it('respects limit', async () => {
    const dir = makeTempDir();
    for (let i = 0; i < 20; i++) {
      writeFileSync(join(dir, `f${i.toString().padStart(2, '0')}.ts`), '');
    }
    const result = await executeGlob({ pattern: '*.ts', limit: 5 }, ctx(dir));
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('uses custom path option', async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'a.ts'), '');
    writeFileSync(join(dir, 'b.ts'), '');
    const result = await executeGlob({ pattern: '*.ts', path: 'sub' }, ctx(dir));
    expect(result).toContain('sub/a.ts');
    expect(result).not.toContain('b.ts');
  });

  it('uses default limit of 1000', async () => {
    const dir = makeTempDir();
    for (let i = 0; i < 10; i++) {
      writeFileSync(join(dir, `f${i}.ts`), '');
    }
    const result = await executeGlob({ pattern: '*.ts', limit: NaN as any }, ctx(dir));
    expect(result.length).toBe(10);
  });

  it('clamps limit to at least 1', async () => {
    const dir = makeTempDir();
    for (let i = 0; i < 10; i++) {
      writeFileSync(join(dir, `f${i}.ts`), '');
    }
    const result = await executeGlob({ pattern: '*.ts', limit: 0 }, ctx(dir));
    expect(result.length).toBeLessThanOrEqual(10);
    expect(result.length).toBeGreaterThan(0);
    // limit=0 is treated as "clamped to 1" since Math.max(1, 0) = 1
    expect(result.length).toBeLessThanOrEqual(1);
  });
});

// ─── find tool ────────────────────────────────────────────────────
describe('find tool', () => {
  it('has correct definition', () => {
    const def = createFindToolDefinition();
    expect(def.name).toBe('find');
    expect(def.readOnly).toBe(true);
    expect(def.category).toBe('filesystem');
  });

  it('finds files matching pattern', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'hello.ts'), '');
    writeFileSync(join(dir, 'world.ts'), '');
    writeFileSync(join(dir, 'other.md'), '');
    const executor = createFindToolExecutor();
    const result = await executor({ pattern: '*.ts' }, ctx(dir));
    expect(result.output).toContain('hello.ts');
    expect(result.output).toContain('world.ts');
    expect(result.output).not.toContain('other.md');
  });

  it('returns (no matches) when nothing found', async () => {
    const dir = makeTempDir();
    const executor = createFindToolExecutor();
    const result = await executor({ pattern: '*.zzz' }, ctx(dir));
    expect(result.output).toBe('(no matches)');
  });

  it('shows limit reached message', async () => {
    const dir = makeTempDir();
    for (let i = 0; i < 20; i++) {
      writeFileSync(join(dir, `f${i}.ts`), '');
    }
    const executor = createFindToolExecutor();
    const result = await executor({ pattern: '*.ts', limit: 5 }, ctx(dir));
    expect(result.output).toContain('5 entries limit reached');
  });

  it('does not show limit message when count < limit', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'a.ts'), '');
    writeFileSync(join(dir, 'b.ts'), '');
    const executor = createFindToolExecutor();
    const result = await executor({ pattern: '*.ts', limit: 10 }, ctx(dir));
    expect(result.output).not.toContain('limit reached');
  });

  it('uses path option', async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'a.ts'), '');
    writeFileSync(join(dir, 'b.ts'), '');
    const executor = createFindToolExecutor();
    const result = await executor({ pattern: '*.ts', path: 'sub' }, ctx(dir));
    expect(result.output).toContain('a.ts');
    expect(result.output).not.toContain('b.ts');
  });

  it('deriveFindPatterns', () => {
    const patterns = deriveFindPatterns({ path: 'src' });
    expect(patterns).toEqual(['file:src']);
  });

  it('deriveFindPatterns with no args', () => {
    const patterns = deriveFindPatterns({});
    expect(patterns).toEqual(['file:']);
  });

  it('deriveFindAlwaysOptions', () => {
    const options = deriveFindAlwaysOptions({ path: 'src' });
    expect(options).toHaveLength(2);
    expect(options[0].label).toBe('src');
    expect(options[0].rule.permission).toBe('find');
    expect(options[1].label).toBe('all');
    expect(options[1].rule.action).toBe('allow');
  });

  it('deriveFindAlwaysOptions with no path', () => {
    const options = deriveFindAlwaysOptions({});
    expect(options[0].label).toBe('');
  });
});

// ─── glob tool ────────────────────────────────────────────────────
describe('glob tool', () => {
  it('has correct definition', () => {
    const def = createGlobToolDefinition();
    expect(def.name).toBe('glob');
    expect(def.readOnly).toBe(true);
    expect(def.category).toBe('filesystem');
  });

  it('finds files matching pattern', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'hello.ts'), '');
    writeFileSync(join(dir, 'world.ts'), '');
    writeFileSync(join(dir, 'other.md'), '');
    const executor = createGlobToolExecutor();
    const result = await executor({ pattern: '*.ts' }, ctx(dir));
    expect(result.output).toContain('hello.ts');
    expect(result.output).toContain('world.ts');
    expect(result.output).not.toContain('other.md');
  });

  it('returns (no matches) when nothing found', async () => {
    const dir = makeTempDir();
    const executor = createGlobToolExecutor();
    const result = await executor({ pattern: '*.zzz' }, ctx(dir));
    expect(result.output).toBe('(no matches)');
  });

  it('shows limit reached message', async () => {
    const dir = makeTempDir();
    for (let i = 0; i < 20; i++) {
      writeFileSync(join(dir, `f${i}.ts`), '');
    }
    const executor = createGlobToolExecutor();
    const result = await executor({ pattern: '*.ts', limit: 5 }, ctx(dir));
    expect(result.output).toContain('5 entries limit reached');
  });

  it('does not show limit message when count < limit', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'a.ts'), '');
    const executor = createGlobToolExecutor();
    const result = await executor({ pattern: '*.ts', limit: 10 }, ctx(dir));
    expect(result.output).not.toContain('limit reached');
  });

  it('uses path option', async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'a.ts'), '');
    writeFileSync(join(dir, 'b.ts'), '');
    const executor = createGlobToolExecutor();
    const result = await executor({ pattern: '*.ts', path: 'sub' }, ctx(dir));
    expect(result.output).toContain('a.ts');
    expect(result.output).not.toContain('b.ts');
  });

  it('deriveGlobPatterns', () => {
    const patterns = deriveGlobPatterns({ path: 'src' });
    expect(patterns).toEqual(['file:src']);
  });

  it('deriveGlobPatterns with no args', () => {
    const patterns = deriveGlobPatterns({});
    expect(patterns).toEqual(['file:']);
  });

  it('deriveGlobAlwaysOptions', () => {
    const options = deriveGlobAlwaysOptions({ path: 'src' });
    expect(options).toHaveLength(2);
    expect(options[0].label).toBe('src');
    expect(options[0].rule.permission).toBe('glob');
    expect(options[1].label).toBe('all');
    expect(options[1].rule.action).toBe('allow');
  });

  it('deriveGlobAlwaysOptions with no path', () => {
    const options = deriveGlobAlwaysOptions({});
    expect(options[0].label).toBe('');
  });
});
