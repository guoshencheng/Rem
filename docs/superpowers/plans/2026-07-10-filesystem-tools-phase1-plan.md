# 文件系统工具第一期实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `rem-agent-core` 中实现 `glob` / `find` / `grep` / `apply_patch` 四个文件系统工具，与现有工具保持一致的接口、安全、测试风格。

**Architecture:** 纯 Node.js 实现；`glob` 与 `find` 共享基于 `glob` npm 包的目录遍历；`grep` 基于共享遍历 + 逐行读取；`apply_patch` 自研 OpenAI envelope 解析器 + 执行器；所有工具注册在 `plugins/tool/file-system/index.ts` 中，并通过 `security/rules/profiles.ts` 配置默认权限。

**Tech Stack:** TypeScript, Vitest, pnpm, `glob` npm 包。

## Global Constraints

- 所有新文件不超过 200 行（按 `module-separation-convention`）。
- 所有工具必须遵守 `workspaceRoot` 限制（`resolveWorkspacePath`）。
- `glob` / `find` / `grep` 为 `readOnly`，默认免审批；`apply_patch` 为 `dangerous`，必须审批。
- `glob` / `find` 默认排除 `node_modules/**` 和 `.git/**`。
- 测试覆盖每个工具的正常路径、limit 截断、工作区外拒绝、空结果。

## 文件结构

| 文件 | 职责 |
|---|---|
| `packages/core/src/plugins/tool/file-system/shared/glob-executor.ts` | `glob` / `find` / `grep` 共享的目录遍历实现 |
| `packages/core/src/plugins/tool/file-system/glob.ts` | `glob` 工具定义与执行器入口 |
| `packages/core/src/plugins/tool/file-system/find.ts` | `find` 工具定义与执行器入口 |
| `packages/core/src/plugins/tool/file-system/grep.ts` | `grep` 工具定义与执行器 |
| `packages/core/src/plugins/tool/file-system/apply-patch-parser.ts` | OpenAI envelope patch 解析器 |
| `packages/core/src/plugins/tool/file-system/apply-patch-executor.ts` | patch 操作执行器 |
| `packages/core/src/plugins/tool/file-system/apply-patch.ts` | `apply_patch` 工具定义与入口 |
| `packages/core/src/plugins/tool/file-system/index.ts` | 注册所有文件系统工具 |
| `packages/core/src/security/rules/profiles.ts` | 更新 `coding` profile 默认规则 |
| `packages/core/package.json` | 新增 `glob` 依赖 |
| `packages/core/tests/shared/glob-executor.test.ts` | `glob-executor` 单元测试 |
| `packages/core/tests/glob-tool.test.ts` | `glob` 工具测试 |
| `packages/core/tests/find-tool.test.ts` | `find` 工具测试 |
| `packages/core/tests/grep-tool.test.ts` | `grep` 工具测试 |
| `packages/core/tests/apply-patch-parser.test.ts` | patch 解析器测试 |
| `packages/core/tests/apply-patch-tool.test.ts` | `apply_patch` 工具测试 |

---

### Task 1: 安装 `glob` 依赖

**Files:**
- Modify: `packages/core/package.json`

- [ ] **Step 1: 在 `packages/core` 中添加 `glob` 依赖**

```bash
cd packages/core
pnpm add glob
```

- [ ] **Step 2: 验证 `package.json` 已更新**

`packages/core/package.json` 的 `dependencies` 中应出现：

```json
"glob": "^11.0.0"
```

- [ ] **Step 3: 在根目录执行 `pnpm install` 同步 lockfile**

```bash
cd /Users/guoshencheng/Documents/work/rem
pnpm install
```

Expected: 无报错，lockfile 更新。

---

### Task 2: 创建共享的 `glob-executor.ts`

**Files:**
- Create: `packages/core/src/plugins/tool/file-system/shared/glob-executor.ts`
- Test: `packages/core/tests/shared/glob-executor.test.ts`

- [ ] **Step 1: 编写测试（先失败）**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeGlob } from '../../../src/plugins/tool/file-system/shared/glob-executor.js';

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
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd packages/core
pnpm test tests/shared/glob-executor.test.ts
```

Expected: 失败，提示模块找不到。

- [ ] **Step 3: 实现 `glob-executor.ts`**

```typescript
import { glob } from 'glob';
import { relative } from 'node:path';
import { resolveWorkspacePath } from '../../../security/workspace-root-guard.js';

export interface GlobExecutorOptions {
  pattern: string;
  path?: string;
  exclude?: string | string[];
  limit?: number;
}

const DEFAULT_LIMIT = 1000;
const DEFAULT_IGNORE = ['node_modules/**', '.git/**'];

export async function executeGlob(
  options: GlobExecutorOptions,
  ctx: { cwd: string; workspaceRoot: string },
): Promise<string[]> {
  const targetPath = resolveWorkspacePath(options.path ?? '.', ctx);
  const exclude = Array.isArray(options.exclude)
    ? options.exclude
    : options.exclude
      ? [options.exclude]
      : [];

  const matches = await glob(options.pattern, {
    cwd: targetPath,
    absolute: true,
    nodir: true,
    ignore: [...DEFAULT_IGNORE, ...exclude],
  });

  const limit = Number.isFinite(options.limit) && options.limit != null ? Math.max(1, options.limit) : DEFAULT_LIMIT;
  const limited = matches.slice(0, limit);

  return limited.map((absolutePath) => relative(ctx.workspaceRoot, absolutePath));
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm test tests/shared/glob-executor.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/tool/file-system/shared/glob-executor.ts packages/core/tests/shared/glob-executor.test.ts packages/core/package.json pnpm-lock.yaml
git commit -m "feat(core): add shared glob executor and tests"
```

---

### Task 3: 创建 `glob` 工具

**Files:**
- Create: `packages/core/src/plugins/tool/file-system/glob.ts`
- Test: `packages/core/tests/glob-tool.test.ts`

- [ ] **Step 1: 编写测试（先失败）**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGlobToolDefinition, createGlobToolExecutor } from '../../../src/plugins/tool/file-system/glob.js';

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
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm test tests/glob-tool.test.ts
```

Expected: 失败。

- [ ] **Step 3: 实现 `glob.ts`**

```typescript
import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition, ToolExecutor, ToolContext } from '../../../sdk/tool-provider.js';
import type { Rule } from '../../../security/rules/rule.js';
import { executeGlob } from './shared/glob-executor.js';

const globSchema = Type.Object(
  {
    pattern: Type.String({ description: 'Glob pattern for matching files' }),
    path: Type.Optional(Type.String({ description: 'Directory or file to search (default: cwd)' })),
    exclude: Type.Optional(
      Type.Union([Type.String(), Type.Array(Type.String())], {
        description: 'Glob patterns to exclude',
      }),
    ),
    limit: Type.Optional(Type.Number({ description: 'Maximum number of results to return' })),
  },
  { additionalProperties: false },
);

export type GlobToolInput = Static<typeof globSchema>;

export function createGlobToolDefinition(): ToolDefinition<typeof globSchema> {
  return {
    name: 'glob',
    description: 'Find files matching a glob pattern within the workspace.',
    parameters: globSchema,
    category: 'filesystem',
    readOnly: true,
  };
}

export function createGlobToolExecutor(): ToolExecutor<typeof globSchema> {
  return async (input: GlobToolInput, ctx: ToolContext) => {
    const matches = await executeGlob(
      { pattern: input.pattern, path: input.path, exclude: input.exclude, limit: input.limit },
      ctx,
    );

    if (matches.length === 0) {
      return { output: '(no matches)' };
    }

    let output = matches.join('\n');
    if (input.limit != null && matches.length >= input.limit) {
      output += `\n\n[${input.limit} entries limit reached]`;
    }
    return { output };
  };
}

export function deriveGlobPatterns(input: { path?: string }): string[] {
  return [`file:${input.path ?? ''}`];
}

export function deriveGlobAlwaysOptions(input: { path?: string }): Array<{ label: string; rule: Omit<Rule, 'source'> }> {
  const p = input.path ?? '';
  return [
    { label: p, rule: { permission: 'glob', pattern: p, action: 'allow' } },
    { label: 'all', rule: { permission: 'glob', pattern: '*', action: 'allow' } },
  ];
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm test tests/glob-tool.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/tool/file-system/glob.ts packages/core/tests/glob-tool.test.ts
git commit -m "feat(core): add glob tool"
```

---

### Task 4: 创建 `find` 工具

**Files:**
- Create: `packages/core/src/plugins/tool/file-system/find.ts`
- Test: `packages/core/tests/find-tool.test.ts`

- [ ] **Step 1: 编写测试（先失败）**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFindToolDefinition, createFindToolExecutor } from '../../../src/plugins/tool/file-system/find.js';

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
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm test tests/find-tool.test.ts
```

Expected: 失败。

- [ ] **Step 3: 实现 `find.ts`**

```typescript
import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition, ToolExecutor, ToolContext } from '../../../sdk/tool-provider.js';
import type { Rule } from '../../../security/rules/rule.js';
import { executeGlob } from './shared/glob-executor.js';

const findSchema = Type.Object(
  {
    pattern: Type.String({ description: 'Glob pattern for matching files' }),
    path: Type.Optional(Type.String({ description: 'Directory or file to search (default: cwd)' })),
    exclude: Type.Optional(
      Type.Union([Type.String(), Type.Array(Type.String())], {
        description: 'Glob patterns to exclude',
      }),
    ),
    limit: Type.Optional(Type.Number({ description: 'Maximum number of results to return' })),
  },
  { additionalProperties: false },
);

export type FindToolInput = Static<typeof findSchema>;

export function createFindToolDefinition(): ToolDefinition<typeof findSchema> {
  return {
    name: 'find',
    description: 'Recursively find files matching a glob pattern within the workspace.',
    parameters: findSchema,
    category: 'filesystem',
    readOnly: true,
  };
}

export function createFindToolExecutor(): ToolExecutor<typeof findSchema> {
  return async (input: FindToolInput, ctx: ToolContext) => {
    const matches = await executeGlob(
      { pattern: input.pattern, path: input.path, exclude: input.exclude, limit: input.limit },
      ctx,
    );

    if (matches.length === 0) {
      return { output: '(no matches)' };
    }

    let output = matches.join('\n');
    if (input.limit != null && matches.length >= input.limit) {
      output += `\n\n[${input.limit} entries limit reached]`;
    }
    return { output };
  };
}

export function deriveFindPatterns(input: { path?: string }): string[] {
  return [`file:${input.path ?? ''}`];
}

export function deriveFindAlwaysOptions(input: { path?: string }): Array<{ label: string; rule: Omit<Rule, 'source'> }> {
  const p = input.path ?? '';
  return [
    { label: p, rule: { permission: 'find', pattern: p, action: 'allow' } },
    { label: 'all', rule: { permission: 'find', pattern: '*', action: 'allow' } },
  ];
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm test tests/find-tool.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/tool/file-system/find.ts packages/core/tests/find-tool.test.ts
git commit -m "feat(core): add find tool"
```

---

### Task 5: 创建 `grep` 工具

**Files:**
- Create: `packages/core/src/plugins/tool/file-system/grep.ts`
- Test: `packages/core/tests/grep-tool.test.ts`

- [ ] **Step 1: 编写测试（先失败）**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGrepToolDefinition, createGrepToolExecutor } from '../../../src/plugins/tool/file-system/grep.js';

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
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm test tests/grep-tool.test.ts
```

Expected: 失败。

- [ ] **Step 3: 实现 `grep.ts`**

```typescript
import { Type, type Static } from '@sinclair/typebox';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { resolveWorkspacePath } from '../../../security/workspace-root-guard.js';
import type { ToolDefinition, ToolExecutor, ToolContext } from '../../../sdk/tool-provider.js';
import type { Rule } from '../../../security/rules/rule.js';
import { executeGlob } from './shared/glob-executor.js';
import { truncateLine } from './shared/truncate.js';

const grepSchema = Type.Object(
  {
    pattern: Type.String({ description: 'Regex pattern to search for (or literal if literal=true)' }),
    path: Type.Optional(Type.String({ description: 'File or directory to search (default: cwd)' })),
    glob: Type.Optional(Type.String({ description: 'Glob filter for files under path' })),
    literal: Type.Optional(Type.Boolean({ description: 'Treat pattern as literal text', default: false })),
    ignoreCase: Type.Optional(Type.Boolean({ description: 'Case-insensitive search', default: false })),
    context: Type.Optional(Type.Number({ description: 'Number of context lines around each match', default: 0 })),
    limit: Type.Optional(Type.Number({ description: 'Maximum number of matches to return', default: 100 })),
  },
  { additionalProperties: false },
);

export type GrepToolInput = Static<typeof grepSchema>;

const DEFAULT_LIMIT = 100;

interface GrepMatch {
  relativePath: string;
  lineNumber: number;
  text: string;
  isMatch: boolean;
}

export function createGrepToolDefinition(): ToolDefinition<typeof grepSchema> {
  return {
    name: 'grep',
    description: 'Search file contents for a regex or literal pattern.',
    parameters: grepSchema,
    category: 'search',
    readOnly: true,
  };
}

export function createGrepToolExecutor(): ToolExecutor<typeof grepSchema> {
  return async (input: GrepToolInput, ctx: ToolContext) => {
    const searchPath = resolveWorkspacePath(input.path ?? '.', ctx);
    const filePaths = await resolveFilePaths(searchPath, input.glob, ctx);

    const regex = buildRegex(input.pattern, { literal: input.literal, ignoreCase: input.ignoreCase });
    const contextLines = Math.max(0, Math.floor(input.context ?? 0));
    const limit = Number.isFinite(input.limit) && input.limit != null ? Math.max(1, input.limit) : DEFAULT_LIMIT;

    const allMatches: GrepMatch[] = [];
    let totalMatches = 0;

    for (const filePath of filePaths) {
      if (totalMatches >= limit) break;
      const fileMatches = await grepFile(filePath, ctx.workspaceRoot, regex, contextLines, limit - totalMatches);
      allMatches.push(...fileMatches);
      totalMatches += fileMatches.filter((m) => m.isMatch).length;
    }

    if (allMatches.length === 0) {
      return { output: '(no matches)' };
    }

    const output = formatMatches(allMatches);
    const truncated = totalMatches >= limit ? `\n\n[${limit} matches limit reached]` : '';
    return { output: output + truncated };
  };
}

async function resolveFilePaths(
  searchPath: string,
  globFilter: string | undefined,
  ctx: ToolContext,
): Promise<string[]> {
  const pathStat = await stat(searchPath).catch(() => null);
  if (pathStat?.isFile()) {
    return [searchPath];
  }

  const relativePaths = await executeGlob(
    { pattern: globFilter ?? '**/*', path: searchPath, limit: 10000 },
    { cwd: ctx.cwd, workspaceRoot: ctx.workspaceRoot },
  );
  return relativePaths.map((p) => resolve(ctx.workspaceRoot, p));
}

function buildRegex(
  pattern: string,
  options: { literal?: boolean; ignoreCase?: boolean },
): RegExp {
  if (options.literal) {
    return new RegExp(escapeRegExp(pattern), options.ignoreCase ? 'i' : '');
  }
  return new RegExp(pattern, options.ignoreCase ? 'i' : undefined);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function grepFile(
  absolutePath: string,
  workspaceRoot: string,
  regex: RegExp,
  contextLines: number,
  remainingLimit: number,
): Promise<GrepMatch[]> {
  const relativePath = relative(workspaceRoot, absolutePath);
  const lines: { text: string; lineNumber: number }[] = [];
  const stream = createReadStream(absolutePath, 'utf8');
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    lines.push({ text: line, lineNumber: lines.length + 1 });
  }

  const result: GrepMatch[] = [];
  const addedContext = new Set<number>();
  let matchCount = 0;

  for (let i = 0; i < lines.length; i++) {
    if (matchCount >= remainingLimit) break;
    const line = lines[i];
    if (!line) continue;

    if (regex.test(line.text)) {
      for (let j = Math.max(0, i - contextLines); j < i; j++) {
        if (!addedContext.has(j)) {
          result.push({ relativePath, lineNumber: lines[j].lineNumber, text: lines[j].text, isMatch: false });
          addedContext.add(j);
        }
      }

      result.push({ relativePath, lineNumber: line.lineNumber, text: line.text, isMatch: true });
      addedContext.add(i);
      matchCount++;

      for (let j = i + 1; j <= Math.min(lines.length - 1, i + contextLines); j++) {
        if (!addedContext.has(j)) {
          result.push({ relativePath, lineNumber: lines[j].lineNumber, text: lines[j].text, isMatch: false });
          addedContext.add(j);
        }
      }
    }
  }

  return result;
}

function formatMatches(matches: GrepMatch[]): string {
  return matches
    .map((m) => {
      const { text } = truncateLine(m.text);
      const marker = m.isMatch ? ':' : '-';
      return `${m.relativePath}${marker}${m.lineNumber}${marker} ${text}`;
    })
    .join('\n');
}

export function deriveGrepPatterns(input: { path?: string; glob?: string }): string[] {
  return [`file:${input.path ?? ''}`, `glob:${input.glob ?? ''}`];
}

export function deriveGrepAlwaysOptions(input: { path?: string }): Array<{ label: string; rule: Omit<Rule, 'source'> }> {
  const p = input.path ?? '';
  return [
    { label: p, rule: { permission: 'grep', pattern: p, action: 'allow' } },
    { label: 'all', rule: { permission: 'grep', pattern: '*', action: 'allow' } },
  ];
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm test tests/grep-tool.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/tool/file-system/grep.ts packages/core/tests/grep-tool.test.ts
git commit -m "feat(core): add grep tool"
```

---

### Task 6: 创建 `apply_patch` 解析器

**Files:**
- Create: `packages/core/src/plugins/tool/file-system/apply-patch-parser.ts`
- Test: `packages/core/tests/apply-patch-parser.test.ts`

- [ ] **Step 1: 编写测试（先失败）**

```typescript
import { describe, it, expect } from 'vitest';
import { parsePatchText } from '../../../src/plugins/tool/file-system/apply-patch-parser.js';

describe('apply-patch parser', () => {
  it('parses add file', () => {
    const ops = parsePatchText(`*** Begin Patch\n*** Add File: src/foo.ts\n@@\n+ hello\n*** End File\n*** End Patch`);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: 'add', path: 'src/foo.ts' });
    expect(ops[0]?.hunks[0]?.newLines).toEqual(['hello']);
  });

  it('parses update file', () => {
    const ops = parsePatchText(`*** Begin Patch\n*** Update File: src/foo.ts\n@@ old\n- old\n+ new\n*** End File\n*** End Patch`);
    expect(ops[0]).toMatchObject({ type: 'update', path: 'src/foo.ts' });
    expect(ops[0]?.hunks[0]?.oldLines).toEqual(['old']);
    expect(ops[0]?.hunks[0]?.newLines).toEqual(['new']);
  });

  it('parses delete file', () => {
    const ops = parsePatchText(`*** Begin Patch\n*** Delete File: src/foo.ts\n*** End File\n*** End Patch`);
    expect(ops[0]).toMatchObject({ type: 'delete', path: 'src/foo.ts' });
  });

  it('parses move', () => {
    const ops = parsePatchText(`*** Begin Patch\n*** Update File: src/foo.ts\n@@\n*** Move to: src/bar.ts\n*** End File\n*** End Patch`);
    expect(ops[0]).toMatchObject({ type: 'update', path: 'src/foo.ts', newPath: 'src/bar.ts' });
  });

  it('rejects unrecognized directives', () => {
    expect(() => parsePatchText('*** Weird\n')).toThrow('unrecognized patch directive');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm test tests/apply-patch-parser.test.ts
```

Expected: 失败。

- [ ] **Step 3: 实现 `apply-patch-parser.ts`**

```typescript
export interface PatchHunk {
  context: string;
  oldLines: string[];
  newLines: string[];
}

export interface PatchOperation {
  type: 'add' | 'update' | 'delete' | 'move';
  path: string;
  newPath?: string;
  hunks: PatchHunk[];
}

export function parsePatchText(patchText: string): PatchOperation[] {
  const lines = patchText.split(/\r?\n/);
  const operations: PatchOperation[] = [];
  let currentOperation: PatchOperation | null = null;
  let currentHunk: PatchHunk | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    if (line.startsWith('*** Add File:')) {
      flushHunk(currentOperation, currentHunk);
      currentHunk = null;
      currentOperation = { type: 'add', path: parsePath(line, '*** Add File:'), hunks: [] };
      operations.push(currentOperation);
      continue;
    }

    if (line.startsWith('*** Update File:')) {
      flushHunk(currentOperation, currentHunk);
      currentHunk = null;
      currentOperation = { type: 'update', path: parsePath(line, '*** Update File:'), hunks: [] };
      operations.push(currentOperation);
      continue;
    }

    if (line.startsWith('*** Delete File:')) {
      flushHunk(currentOperation, currentHunk);
      currentHunk = null;
      currentOperation = { type: 'delete', path: parsePath(line, '*** Delete File:'), hunks: [] };
      operations.push(currentOperation);
      continue;
    }

    if (line.startsWith('*** Move to:')) {
      if (!currentOperation || currentOperation.type !== 'update') {
        throw new Error(`Line ${i + 1}: "Move to" must follow an Update File`);
      }
      currentOperation.newPath = parsePath(line, '*** Move to:');
      continue;
    }

    if (line.startsWith('@@ ')) {
      flushHunk(currentOperation, currentHunk);
      currentHunk = { context: line.slice(3), oldLines: [], newLines: [] };
      continue;
    }

    if (line.startsWith('*** End of File') || line.startsWith('*** End Patch') || line.trim() === '') {
      flushHunk(currentOperation, currentHunk);
      currentHunk = null;
      continue;
    }

    if (line.startsWith('*** ')) {
      throw new Error(`Line ${i + 1}: unrecognized patch directive: ${line}`);
    }

    if (currentHunk) {
      const marker = line[0];
      if (marker === ' ') currentHunk.oldLines.push(line.slice(1));
      else if (marker === '+') currentHunk.newLines.push(line.slice(1));
      else if (marker === '-') currentHunk.oldLines.push(line.slice(1));
      else throw new Error(`Line ${i + 1}: invalid hunk line: ${line}`);
    }
  }

  flushHunk(currentOperation, currentHunk);
  return operations;
}

function parsePath(line: string, prefix: string): string {
  return line.slice(prefix.length).trim();
}

function flushHunk(operation: PatchOperation | null, hunk: PatchHunk | null) {
  if (operation && hunk && (hunk.oldLines.length > 0 || hunk.newLines.length > 0)) {
    operation.hunks.push(hunk);
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm test tests/apply-patch-parser.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/tool/file-system/apply-patch-parser.ts packages/core/tests/apply-patch-parser.test.ts
git commit -m "feat(core): add apply_patch parser"
```

---

### Task 7: 创建 `apply_patch` 执行器

**Files:**
- Create: `packages/core/src/plugins/tool/file-system/apply-patch-executor.ts`

- [ ] **Step 1: 实现 `apply-patch-executor.ts`**

```typescript
import { readFile, writeFile, unlink, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { resolveWorkspacePath } from '../../../security/workspace-root-guard.js';
import type { ToolContext } from '../../../sdk/tool-provider.js';
import type { FileMutationQueue } from './shared/file-mutation-queue.js';
import type { PatchHunk, PatchOperation } from './apply-patch-parser.js';

export async function executePatchOperations(
  operations: PatchOperation[],
  ctx: ToolContext,
  queue: FileMutationQueue,
): Promise<string[]> {
  const changed: string[] = [];

  for (const op of operations) {
    const absolutePath = resolveWorkspacePath(op.path, ctx);

    if (op.type === 'delete') {
      await queue.withQueue(absolutePath, () => unlink(absolutePath));
      changed.push(`Deleted: ${op.path}`);
      continue;
    }

    if (op.type === 'add') {
      const exists = await stat(absolutePath).then(() => true, () => false);
      if (exists) {
        throw new Error(`File already exists: ${op.path} (Add conflict)`);
      }
      const content = op.hunks.map((h) => h.newLines.join('\n')).join('\n');
      await queue.withQueue(absolutePath, async () => {
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, content, 'utf8');
      });
      changed.push(`Added: ${op.path}`);
      continue;
    }

    if (op.type === 'update') {
      await queue.withQueue(absolutePath, async () => {
        const original = await readFile(absolutePath, 'utf8');
        const modified = applyUpdate(original, op.hunks);
        await writeFile(absolutePath, modified, 'utf8');
      });

      const newPath = op.newPath ? resolveWorkspacePath(op.newPath, ctx) : null;
      if (newPath) {
        await queue.withQueue(newPath, async () => {
          await mkdir(dirname(newPath), { recursive: true });
          await rename(absolutePath, newPath);
        });
        changed.push(`Moved: ${op.path} -> ${op.newPath}`);
      } else {
        changed.push(`Updated: ${op.path}`);
      }
      continue;
    }
  }

  return changed;
}

function applyUpdate(content: string, hunks: PatchHunk[]): string {
  let lines = content.split(/\r?\n/);

  for (const hunk of [...hunks].reverse()) {
    const contextIndex = lines.findIndex((l) => l === hunk.context);
    if (contextIndex === -1) {
      throw new Error(`Could not locate context "${hunk.context}"`);
    }

    const oldStart = contextIndex + 1;
    const oldEnd = oldStart + hunk.oldLines.length;
    const actualOld = lines.slice(oldStart, oldEnd);

    if (actualOld.length !== hunk.oldLines.length || !actualOld.every((l, i) => l === hunk.oldLines[i])) {
      throw new Error(`Context mismatch after "${hunk.context}"`);
    }

    const before = lines.slice(0, oldStart);
    const after = lines.slice(oldEnd);
    lines = [...before, ...hunk.newLines, ...after];
  }

  return lines.join('\n');
}
```

- [ ] **Step 2: 运行 typecheck**

```bash
pnpm typecheck
```

Expected: 无新增类型错误（apply-patch-executor 单独可能无测试，但类型需通过）。

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/plugins/tool/file-system/apply-patch-executor.ts
git commit -m "feat(core): add apply_patch executor"
```

---

### Task 8: 创建 `apply_patch` 工具

**Files:**
- Create: `packages/core/src/plugins/tool/file-system/apply-patch.ts`
- Test: `packages/core/tests/apply-patch-tool.test.ts`

- [ ] **Step 1: 编写测试（先失败）**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplyPatchToolDefinition, createApplyPatchToolExecutor } from '../../../src/plugins/tool/file-system/apply-patch.js';
import { createFileMutationQueue } from '../../../src/plugins/tool/file-system/shared/file-mutation-queue.js';

const ctx = (workspaceRoot: string, readOnly = false) => ({ cwd: workspaceRoot, workspaceRoot, readOnly });

describe('apply_patch tool', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'rem-apply-patch-'));
  });

  it('adds a file', async () => {
    const executor = createApplyPatchToolExecutor(createFileMutationQueue());
    const result = await executor(
      { patchText: '*** Begin Patch\n*** Add File: src/foo.ts\n@@\n+ hello\n*** End File\n*** End Patch' },
      ctx(workspaceRoot),
    );
    expect(result.output).toContain('Added: src/foo.ts');
    const content = await readFile(join(workspaceRoot, 'src/foo.ts'), 'utf8');
    expect(content).toBe('hello');
  });

  it('updates a file', async () => {
    await writeFile(join(workspaceRoot, 'foo.ts'), 'hello\nworld\n', 'utf8');
    const executor = createApplyPatchToolExecutor(createFileMutationQueue());
    const result = await executor(
      { patchText: '*** Begin Patch\n*** Update File: foo.ts\n@@ hello\n- world\n+ there\n*** End File\n*** End Patch' },
      ctx(workspaceRoot),
    );
    expect(result.output).toContain('Updated: foo.ts');
    const content = await readFile(join(workspaceRoot, 'foo.ts'), 'utf8');
    expect(content).toBe('hello\nthere\n');
  });

  it('deletes a file', async () => {
    await writeFile(join(workspaceRoot, 'foo.ts'), 'x', 'utf8');
    const executor = createApplyPatchToolExecutor(createFileMutationQueue());
    const result = await executor(
      { patchText: '*** Begin Patch\n*** Delete File: foo.ts\n*** End File\n*** End Patch' },
      ctx(workspaceRoot),
    );
    expect(result.output).toContain('Deleted: foo.ts');
  });

  it('rejects paths outside workspace root', async () => {
    const executor = createApplyPatchToolExecutor(createFileMutationQueue());
    await expect(
      executor(
        { patchText: '*** Begin Patch\n*** Add File: /etc/foo.ts\n@@\n+ x\n*** End File\n*** End Patch' },
        ctx(workspaceRoot),
      ),
    ).rejects.toThrow('resolves outside workspace root');
  });

  it('rejects read-only mode', async () => {
    const executor = createApplyPatchToolExecutor(createFileMutationQueue());
    await expect(
      executor(
        { patchText: '*** Begin Patch\n*** Add File: foo.ts\n@@\n+ x\n*** End File\n*** End Patch' },
        ctx(workspaceRoot, true),
      ),
    ).rejects.toThrow('read-only');
  });

  it('rejects add when file already exists', async () => {
    await writeFile(join(workspaceRoot, 'foo.ts'), 'x', 'utf8');
    const executor = createApplyPatchToolExecutor(createFileMutationQueue());
    await expect(
      executor(
        { patchText: '*** Begin Patch\n*** Add File: foo.ts\n@@\n+ y\n*** End File\n*** End Patch' },
        ctx(workspaceRoot),
      ),
    ).rejects.toThrow('File already exists');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm test tests/apply-patch-tool.test.ts
```

Expected: 失败。

- [ ] **Step 3: 实现 `apply-patch.ts`**

```typescript
import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition, ToolExecutor, ToolContext } from '../../../sdk/tool-provider.js';
import type { Rule } from '../../../security/rules/rule.js';
import type { FileMutationQueue } from './shared/file-mutation-queue.js';
import { parsePatchText } from './apply-patch-parser.js';
import { executePatchOperations } from './apply-patch-executor.js';

const applyPatchSchema = Type.Object(
  {
    patchText: Type.String({ description: 'OpenAI envelope style patch text' }),
  },
  { additionalProperties: false },
);

export type ApplyPatchToolInput = Static<typeof applyPatchSchema>;

export function createApplyPatchToolDefinition(): ToolDefinition<typeof applyPatchSchema> {
  return {
    name: 'apply_patch',
    description: 'Apply an OpenAI envelope style multi-file patch.',
    parameters: applyPatchSchema,
    category: 'filesystem',
    dangerous: true,
  };
}

export function createApplyPatchToolExecutor(queue: FileMutationQueue): ToolExecutor<typeof applyPatchSchema> {
  return async (input: ApplyPatchToolInput, ctx: ToolContext) => {
    if (ctx.readOnly) {
      throw new Error('apply_patch is disabled in read-only mode');
    }

    const operations = parsePatchText(input.patchText);
    const changed = await executePatchOperations(operations, ctx, queue);

    if (changed.length === 0) {
      return { output: 'No changes applied' };
    }

    return { output: `Applied patch:\n- ${changed.join('\n- ')}` };
  };
}

export function deriveApplyPatchPatterns(input: ApplyPatchToolInput): string[] {
  const operations = parsePatchText(input.patchText);
  return operations.map((op) => `file:${op.path}`);
}

export function deriveApplyPatchAlwaysOptions(input: ApplyPatchToolInput): Array<{ label: string; rule: Omit<Rule, 'source'> }> {
  const operations = parsePatchText(input.patchText);
  const paths = operations.map((op) => op.path);
  const options: Array<{ label: string; rule: Omit<Rule, 'source'> }> = [];

  for (const p of paths) {
    options.push({ label: p, rule: { permission: 'write', pattern: p, action: 'allow' } });
    const parts = p.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const dir = parts.slice(0, -1).join('/') + '/*';
      options.push({ label: dir, rule: { permission: 'write', pattern: dir, action: 'allow' } });
    }
    if (p.includes('.')) {
      const ext = '*.' + p.split('.').pop();
      options.push({ label: ext, rule: { permission: 'write', pattern: ext, action: 'allow' } });
    }
  }

  options.push({ label: 'all', rule: { permission: 'write', pattern: '*', action: 'allow' } });
  return options;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm test tests/apply-patch-tool.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/tool/file-system/apply-patch.ts packages/core/tests/apply-patch-tool.test.ts
git commit -m "feat(core): add apply_patch tool"
```

---

### Task 9: 在 `file-system/index.ts` 注册新工具

**Files:**
- Modify: `packages/core/src/plugins/tool/file-system/index.ts`

- [ ] **Step 1: 修改 `index.ts` 注册 4 个新工具**

完整替换文件内容：

```typescript
import type { ConfigProvider } from '../../../sdk/config-provider.js';
import type { FileMutationQueue } from './shared/file-mutation-queue.js';
import type { Rule } from '../../../security/rules/rule.js';
import { AgentToolRegistry } from '../../../registry/tool-registry.js';
import { createReadToolDefinition, createReadToolExecutor } from './read.js';
import { createWriteToolDefinition, createWriteToolExecutor } from './write.js';
import { createEditToolDefinition, createEditToolExecutor } from './edit.js';
import { createLsToolDefinition, createLsToolExecutor } from './ls.js';
import { createExecToolDefinition, createExecToolExecutor } from './exec.js';
import { createGlobToolDefinition, createGlobToolExecutor, deriveGlobPatterns, deriveGlobAlwaysOptions } from './glob.js';
import { createFindToolDefinition, createFindToolExecutor, deriveFindPatterns, deriveFindAlwaysOptions } from './find.js';
import { createGrepToolDefinition, createGrepToolExecutor, deriveGrepPatterns, deriveGrepAlwaysOptions } from './grep.js';
import {
  createApplyPatchToolDefinition,
  createApplyPatchToolExecutor,
  deriveApplyPatchPatterns,
  deriveApplyPatchAlwaysOptions,
} from './apply-patch.js';
import { classifyCommand } from '../../../security/exec-classifier.js';

function deriveFilePatterns(input: { path?: string }): string[] {
  const p = input.path ?? '';
  return [`file:${p}`];
}

function deriveFileAlwaysOptions(input: { path?: string }): Array<{ label: string; rule: Omit<Rule, 'source'> }> {
  const p = input.path ?? '';
  const parts = p.split('/').filter(Boolean);
  const options: Array<{ label: string; rule: Omit<Rule, 'source'> }> = [];
  options.push({ label: p, rule: { permission: 'write', pattern: p, action: 'allow' } });
  if (parts.length >= 2) {
    const dir = parts.slice(0, -1).join('/') + '/*';
    options.push({ label: dir, rule: { permission: 'write', pattern: dir, action: 'allow' } });
  }
  if (p.includes('.')) {
    const ext = '*.' + p.split('.').pop();
    options.push({ label: ext, rule: { permission: 'write', pattern: ext, action: 'allow' } });
  }
  options.push({ label: 'all', rule: { permission: 'write', pattern: '*', action: 'allow' } });
  return options;
}

export function createFileSystemTools(
  configProvider: ConfigProvider,
  fileMutationQueue: FileMutationQueue,
): AgentToolRegistry {
  const behavior = configProvider.getBehaviorConfig();
  const toolCfg = configProvider.getToolConfig();
  const registry = new AgentToolRegistry({
    workspaceRoot: behavior.workspaceRoot,
    readOnly: behavior.readOnly,
    policy: toolCfg.policy,
  });

  const readDef = createReadToolDefinition();
  registry.register(
    {
      ...readDef,
      derivePatterns: deriveFilePatterns,
      deriveAlwaysOptions: deriveFileAlwaysOptions,
    },
    createReadToolExecutor(),
  );

  const lsDef = createLsToolDefinition();
  registry.register(
    {
      ...lsDef,
      derivePatterns: deriveFilePatterns,
      deriveAlwaysOptions: deriveFileAlwaysOptions,
    },
    createLsToolExecutor(),
  );

  const execDef = createExecToolDefinition();
  registry.register(
    {
      ...execDef,
      derivePatterns: (input) => {
        const c = classifyCommand(input.command);
        return c.patterns;
      },
      deriveAlwaysOptions: (input) => {
        const c = classifyCommand(input.command);
        return c.patterns.map((pattern) => ({
          label: pattern,
          rule: { permission: 'exec', pattern, action: 'allow' },
        }));
      },
    },
    createExecToolExecutor(),
  );

  const globDef = createGlobToolDefinition();
  registry.register(
    {
      ...globDef,
      derivePatterns: deriveGlobPatterns,
      deriveAlwaysOptions: deriveGlobAlwaysOptions,
    },
    createGlobToolExecutor(),
  );

  const findDef = createFindToolDefinition();
  registry.register(
    {
      ...findDef,
      derivePatterns: deriveFindPatterns,
      deriveAlwaysOptions: deriveFindAlwaysOptions,
    },
    createFindToolExecutor(),
  );

  const grepDef = createGrepToolDefinition();
  registry.register(
    {
      ...grepDef,
      derivePatterns: deriveGrepPatterns,
      deriveAlwaysOptions: deriveGrepAlwaysOptions,
    },
    createGrepToolExecutor(),
  );

  if (!behavior.readOnly) {
    const writeDef = createWriteToolDefinition();
    registry.register(
      {
        ...writeDef,
        derivePatterns: deriveFilePatterns,
        deriveAlwaysOptions: deriveFileAlwaysOptions,
      },
      createWriteToolExecutor(fileMutationQueue),
    );

    const editDef = createEditToolDefinition();
    registry.register(
      {
        ...editDef,
        derivePatterns: deriveFilePatterns,
        deriveAlwaysOptions: deriveFileAlwaysOptions,
      },
      createEditToolExecutor(fileMutationQueue),
    );

    const applyPatchDef = createApplyPatchToolDefinition();
    registry.register(
      {
        ...applyPatchDef,
        derivePatterns: deriveApplyPatchPatterns,
        deriveAlwaysOptions: deriveApplyPatchAlwaysOptions,
      },
      createApplyPatchToolExecutor(fileMutationQueue),
    );
  }

  return registry;
}
```

- [ ] **Step 2: 运行类型检查**

```bash
pnpm typecheck
```

Expected: 无新增类型错误。

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/plugins/tool/file-system/index.ts
git commit -m "feat(core): register glob, find, grep and apply_patch tools"
```

---

### Task 10: 更新 `coding` profile 默认规则

**Files:**
- Modify: `packages/core/src/security/rules/profiles.ts`

- [ ] **Step 1: 在 `coding` profile 中添加 glob/find/grep 的 allow 规则**

修改 `PROFILES` 中 `coding` 数组：

```typescript
coding: [
  rule('read', '*', 'allow'),
  rule('ls', '*', 'allow'),
  rule('glob', '*', 'allow'),
  rule('find', '*', 'allow'),
  rule('grep', '*', 'allow'),
  rule('exec', 'git *', 'allow'),
  rule('exec', 'ls *', 'allow'),
  rule('exec', 'cat *', 'allow'),
  rule('exec', 'grep *', 'allow'),
  rule('exec', 'find *', 'allow'),
  rule('exec', 'pwd', 'allow'),
  rule('exec', 'echo *', 'allow'),
],
```

- [ ] **Step 2: 运行测试**

```bash
pnpm test tests/security/rules/profiles.test.ts 2>/dev/null || pnpm test
```

Expected: 现有测试仍通过（如果没有 profiles.test.ts 则跑全仓测试）。

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/security/rules/profiles.ts
git commit -m "feat(core): allow glob, find, grep in coding profile"
```

---

### Task 11: 最终类型检查与全仓测试

- [ ] **Step 1: 类型检查**

```bash
cd packages/core
pnpm typecheck
```

Expected: PASS。

- [ ] **Step 2: 运行全仓测试**

```bash
pnpm test
```

Expected: 所有测试通过，包括新添加的 glob/find/grep/apply_patch 测试。

- [ ] **Step 3: 运行全仓类型检查（根目录）**

```bash
cd /Users/guoshencheng/Documents/work/rem
pnpm typecheck
```

Expected: PASS。

---

## Spec 覆盖检查

| Spec 要求 | 对应 Task |
|---|---|
| 新增 `glob` 工具 | Task 3 |
| 新增 `find` 工具 | Task 4 |
| 新增 `grep` 工具 | Task 5 |
| 新增 `apply_patch` 工具 | Task 6, 7, 8 |
| `glob`/`find`/`grep` readOnly | 工具定义中设置 `readOnly: true` |
| `apply_patch` dangerous | 工具定义中设置 `dangerous: true` |
| 工作区限制 | 所有工具使用 `resolveWorkspacePath` |
| 默认排除 `node_modules`/`git` | Task 2 `DEFAULT_IGNORE` |
| `coding` profile 默认 allow | Task 10 |
| 文件不超过 200 行 | 各实现文件均控制在 200 行以内 |

## 无占位符检查

- 无 TBD/TODO/"稍后实现"。
- 每个 code step 包含完整可执行代码。
- 每个测试 step 包含完整测试用例。
- 每个命令包含预期输出。

---

## 执行交接

**Plan 已保存到 `docs/superpowers/plans/2026-07-10-filesystem-tools-phase1-plan.md`。两种执行方式：**

**1. Subagent-Driven（推荐）** — 每个 Task 派一个独立 subagent，Task 之间 review，快速迭代。

**2. Inline Execution** — 在当前会话中按 Task 顺序执行，使用 executing-plans 批量推进。

请选择执行方式。