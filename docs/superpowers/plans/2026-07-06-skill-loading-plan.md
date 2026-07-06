# Skill 加载与 read_skill 工具实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 rem-agent-core 增加按需读取技能详情的内置工具 `read_skill`，并在 system prompt 中引导 AI 主动使用它。

**Architecture:** 在 `SkillProvider` 接口新增 `readSkillRaw(name)` 方法，由 `FileSkillProvider` 实现；`ProviderManager` 初始化完成后向当前 `ToolProvider` 注册内置 `read_skill` 工具；`DefaultSkillCatalog` 在格式化技能目录时追加引导语。

**Tech Stack:** TypeScript, Vitest, @sinclair/typebox, Node.js fs/promises

---

## 文件结构

| 文件 | 操作 | 说明 |
|---|---|---|
| `packages/core/src/sdk/skill-provider.ts` | 修改 | `SkillProvider` 接口新增 `readSkillRaw` |
| `packages/core/src/plugins/skill/file/index.ts` | 修改 | `FileSkillProvider` 实现 `readSkillRaw` |
| `packages/core/src/plugins/skill/default-catalog.ts` | 修改 | 拼接引导语 + `<available_skills>` |
| `packages/core/src/plugins/tool/builtin/skill-read.ts` | 新建 | `read_skill` 工具定义与执行函数 |
| `packages/core/src/provider-manager.ts` | 修改 | 初始化后注册 `read_skill` 工具 |
| `packages/core/tests/file-skill-provider.test.ts` | 修改 | 增加 `readSkillRaw` 测试 |
| `packages/core/tests/skill-catalog.test.ts` | 新建 | 测试引导语与目录格式化 |
| `packages/core/tests/provider-manager.test.ts` | 修改 | 测试 `read_skill` 工具已注册 |

---

## Task 1: 扩展 SkillProvider 接口

**Files:**
- Modify: `packages/core/src/sdk/skill-provider.ts`
- Test: `packages/core/tests/file-skill-provider.test.ts`（后续 Task 3 再写具体测试）

- [ ] **Step 1: 修改接口，新增 `readSkillRaw`**

```typescript
export interface SkillProvider {
  loadSkills(): Promise<Skill[]>;
  formatCatalog(skills: Skill[]): string;
  readSkillRaw(name: string): Promise<string | undefined>;
}
```

- [ ] **Step 2: 提交**

```bash
git add packages/core/src/sdk/skill-provider.ts
git commit -m "feat(sdk): add readSkillRaw to SkillProvider interface"
```

---

## Task 2: 在 DefaultSkillCatalog 中追加引导语

**Files:**
- Modify: `packages/core/src/plugins/skill/default-catalog.ts`
- Test: `packages/core/tests/skill-catalog.test.ts`

- [ ] **Step 1: 编写失败的测试**

Create `packages/core/tests/skill-catalog.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DefaultSkillCatalog } from '../src/plugins/skill/default-catalog.js';

describe('DefaultSkillCatalog', () => {
  it('returns empty string for no skills', () => {
    const catalog = new DefaultSkillCatalog();
    expect(catalog.format([])).toBe('');
  });

  it('includes guidance and available_skills block', () => {
    const catalog = new DefaultSkillCatalog();
    const output = catalog.format([
      {
        name: 'github',
        description: 'GitHub CLI for issues and PRs.',
        location: '/skills/github/SKILL.md',
        content: 'Use gh.',
      },
    ]);

    expect(output).toContain('call the `read_skill` tool');
    expect(output).toContain('<available_skills>');
    expect(output).toContain('<name>github</name>');
    expect(output).toContain('GitHub CLI for issues and PRs.');
    expect(output).toContain('</available_skills>');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
pnpm --filter rem-agent-core test packages/core/tests/skill-catalog.test.ts
```

Expected: FAIL（`DefaultSkillCatalog` 还未输出引导语）

- [ ] **Step 3: 修改 DefaultSkillCatalog.format()**

修改 `packages/core/src/plugins/skill/default-catalog.ts`:

```typescript
import type { Skill, SkillCatalog } from '../../sdk/skill-provider.js';

const SKILL_GUIDANCE = `The following skills provide specialized instructions for specific tasks.
When a task matches a skill's description, call the \`read_skill\` tool with the skill name
to load its full SKILL.md. Then follow the instructions inside the skill; if the skill
references additional files or commands, use the appropriate tools to gather more
information or execute actions.`;

export class DefaultSkillCatalog implements SkillCatalog {
  format(skills: Skill[]): string {
    if (skills.length === 0) {
      return '';
    }

    const skillBlocks = skills
      .map(
        (skill) =>
          `  <skill>\n    <name>${escapeXml(skill.name)}</name>\n    <description>${escapeXml(skill.description)}</description>\n    <location>${escapeXml(skill.location)}</location>\n  </skill>`,
      )
      .join('\n');

    return [
      SKILL_GUIDANCE,
      '',
      '<available_skills>',
      skillBlocks,
      '</available_skills>',
    ].join('\n');
  }
}

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
pnpm --filter rem-agent-core test packages/core/tests/skill-catalog.test.ts
```

Expected: PASS

- [ ] **Step 5: 运行现有测试，确认未破坏 catalog 行为**

```bash
pnpm --filter rem-agent-core test packages/core/tests/file-skill-provider.test.ts
```

Expected: PASS（`formats catalog with XML block` 和 `returns empty catalog string when no skills` 仍通过）

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/plugins/skill/default-catalog.ts packages/core/tests/skill-catalog.test.ts
git commit -m "feat(skill): add guidance to skill catalog and include read_skill instruction"
```

---

## Task 3: FileSkillProvider 实现 readSkillRaw

**Files:**
- Modify: `packages/core/src/plugins/skill/file/index.ts`
- Test: `packages/core/tests/file-skill-provider.test.ts`

- [ ] **Step 1: 编写失败的测试**

在 `packages/core/tests/file-skill-provider.test.ts` 末尾追加：

```typescript
describe('FileSkillProvider.readSkillRaw', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'rem-agent-skill-raw-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createRawSkill(name: string, content: string) {
    const skillDir = join(tempDir, name);
    mkdirSync(skillDir);
    writeFileSync(join(skillDir, 'SKILL.md'), content);
  }

  it('returns full SKILL.md raw content', async () => {
    const raw = '---\nname: test\ndescription: Test skill.\n---\n\nBody here.';
    createRawSkill('test', raw);

    const provider = new FileSkillProvider({ skillsDir: tempDir });
    const result = await provider.readSkillRaw('test');

    expect(result).toBe(raw);
  });

  it('returns undefined when skill is not found', async () => {
    const provider = new FileSkillProvider({ skillsDir: tempDir });
    const result = await provider.readSkillRaw('missing');

    expect(result).toBeUndefined();
  });

  it('returns undefined when skillsDir is empty', async () => {
    const provider = new FileSkillProvider();
    const result = await provider.readSkillRaw('anything');

    expect(result).toBeUndefined();
  });

  it('returns undefined when SKILL.md is missing', async () => {
    mkdirSync(join(tempDir, 'no-file'));
    const provider = new FileSkillProvider({ skillsDir: tempDir });
    const result = await provider.readSkillRaw('no-file');

    expect(result).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
pnpm --filter rem-agent-core test packages/core/tests/file-skill-provider.test.ts
```

Expected: FAIL（`readSkillRaw` 未实现）

- [ ] **Step 3: 实现 readSkillRaw**

修改 `packages/core/src/plugins/skill/file/index.ts`，在 `formatCatalog` 后新增方法：

```typescript
async readSkillRaw(name: string): Promise<string | undefined> {
  if (this.skillsDir === '') {
    return undefined;
  }

  const skillDir = join(this.skillsDir, name);
  const skillFile = join(skillDir, 'SKILL.md');

  try {
    const entryStat = await stat(skillDir);
    if (!entryStat.isDirectory()) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  try {
    return await readFile(skillFile, 'utf-8');
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
pnpm --filter rem-agent-core test packages/core/tests/file-skill-provider.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/plugins/skill/file/index.ts packages/core/tests/file-skill-provider.test.ts
git commit -m "feat(skill): implement FileSkillProvider.readSkillRaw"
```

---

## Task 4: 创建 read_skill 内置工具

**Files:**
- Create: `packages/core/src/plugins/tool/builtin/skill-read.ts`
- Test: `packages/core/tests/skill-read-tool.test.ts`

- [ ] **Step 1: 编写失败的测试**

Create `packages/core/tests/skill-read-tool.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { Type } from '@sinclair/typebox';
import { createReadSkillToolDefinition, createReadSkillToolExecutor } from '../src/plugins/tool/builtin/skill-read.js';
import type { SkillProvider } from '../src/sdk/skill-provider.js';

function createFakeSkillProvider(rawByName: Record<string, string>): SkillProvider {
  return {
    loadSkills: async () => [],
    formatCatalog: () => '',
    readSkillRaw: async (name: string) => rawByName[name],
  };
}

describe('read_skill tool', () => {
  it('returns raw markdown when skill exists', async () => {
    const raw = '---\nname: foo\n---\n\nbar';
    const provider = createFakeSkillProvider({ foo: raw });
    const executor = createReadSkillToolExecutor(() => provider);

    const result = await executor({ name: 'foo' }, { cwd: '/', workspaceRoot: '/' });

    expect(result.output).toBe(raw);
  });

  it('returns error when skill is not found', async () => {
    const provider = createFakeSkillProvider({});
    const executor = createReadSkillToolExecutor(() => provider);

    const result = await executor({ name: 'missing' }, { cwd: '/', workspaceRoot: '/' });

    expect(result.error).toContain('not found');
    expect(result.output).toBe('');
  });

  it('exposes correct tool definition', () => {
    const def = createReadSkillToolDefinition();

    expect(def.name).toBe('read_skill');
    expect(def.description).toContain('SKILL.md');
    expect(def.parameters.properties).toHaveProperty('name');
    expect(def.parameters.required).toContain('name');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
pnpm --filter rem-agent-core test packages/core/tests/skill-read-tool.test.ts
```

Expected: FAIL（文件不存在）

- [ ] **Step 3: 实现 read_skill 工具**

Create `packages/core/src/plugins/tool/builtin/skill-read.ts`:

```typescript
import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition, ToolExecutor, ToolContext } from '../../../sdk/tool-provider.js';
import type { SkillProvider } from '../../../sdk/skill-provider.js';

const readSkillSchema = Type.Object(
  {
    name: Type.String({ description: 'Name of the skill to load' }),
  },
  { additionalProperties: false },
);

export type ReadSkillToolInput = Static<typeof readSkillSchema>;

export function createReadSkillToolDefinition(): ToolDefinition<typeof readSkillSchema> {
  return {
    name: 'read_skill',
    description:
      'Load the full SKILL.md content for a named skill so its specialized instructions can be followed.',
    parameters: readSkillSchema,
    readOnly: true,
  };
}

export function createReadSkillToolExecutor(
  getSkillProvider: () => SkillProvider,
): ToolExecutor<typeof readSkillSchema> {
  return async (input: ReadSkillToolInput, _ctx: ToolContext) => {
    const skillProvider = getSkillProvider();
    const raw = await skillProvider.readSkillRaw(input.name);

    if (raw === undefined) {
      return {
        output: '',
        error: `Skill "${input.name}" not found`,
      };
    }

    return { output: raw };
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
pnpm --filter rem-agent-core test packages/core/tests/skill-read-tool.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/plugins/tool/builtin/skill-read.ts packages/core/tests/skill-read-tool.test.ts
git commit -m "feat(tool): add read_skill builtin tool"
```

---

## Task 5: ProviderManager 注册 read_skill 工具

**Files:**
- Modify: `packages/core/src/provider-manager.ts`
- Test: `packages/core/tests/provider-manager.test.ts`

- [ ] **Step 1: 编写失败的测试**

修改 `packages/core/tests/provider-manager.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createProviderManager } from '../src/provider-manager.js';

describe('ProviderManager', () => {
  it('creates a new instance via factory function', async () => {
    const pm = await createProviderManager();
    expect(pm).toBeDefined();
  });

  it('provides required providers after init', async () => {
    const pm = await createProviderManager();
    expect(pm.require('session')).toBeDefined();
    expect(pm.require('tool')).toBeDefined();
    expect(pm.require('memory')).toBeDefined();
    expect(pm.require('compressor')).toBeDefined();
    expect(pm.require('error')).toBeDefined();
  });

  it('exposes model and behavior config', async () => {
    const pm = await createProviderManager();
    const behavior = pm.getBehaviorConfig();
    expect(behavior.name).toBe('Rem Agent');
    expect(behavior.maxTurns).toBe(60);

    const model = pm.getModelConfig();
    expect(model.provider).toBe('openai');
  });

  it('registers read_skill builtin tool after init', async () => {
    const pm = await createProviderManager();
    const toolProvider = pm.require<ToolProvider>('tool');
    const toolSet = toolProvider.getToolSet();

    expect(toolSet).toHaveProperty('read_skill');
    expect(toolSet.read_skill.description).toContain('SKILL.md');
    expect(toolSet.read_skill.parameters.properties).toHaveProperty('name');
  });
});
```

需要导入 `ToolProvider`：

```typescript
import { describe, it, expect } from 'vitest';
import { createProviderManager } from '../src/provider-manager.js';
import type { ToolProvider } from '../src/sdk/tool-provider.js';
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
pnpm --filter rem-agent-core test packages/core/tests/provider-manager.test.ts
```

Expected: FAIL（`read_skill` 未注册）

- [ ] **Step 3: 在 ProviderManager 中注册 read_skill**

修改 `packages/core/src/provider-manager.ts`:

导入新增内容：

```typescript
import type { ToolProvider } from './sdk/tool-provider.js';
import {
  createReadSkillToolDefinition,
  createReadSkillToolExecutor,
} from './plugins/tool/builtin/skill-read.js';
```

在 `init()` 中 `await registry.initialize();` 之后新增：

```typescript
await registry.initialize();
this.registerSkillReadTool();
this.registry = registry;
this.initialized = true;
```

新增私有方法：

```typescript
private registerSkillReadTool(): void {
  try {
    const toolProvider = this.registry.require<ToolProvider>('tool');
    const skillProvider = this.registry.require<SkillProvider>('skill');

    toolProvider.register(
      createReadSkillToolDefinition(),
      createReadSkillToolExecutor(() => skillProvider),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Debug log only; builtin tool registration should not block agent startup.
    // eslint-disable-next-line no-console
    console.debug(`[ProviderManager] skipped read_skill registration: ${message}`);
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
pnpm --filter rem-agent-core test packages/core/tests/provider-manager.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/provider-manager.ts packages/core/tests/provider-manager.test.ts
git commit -m "feat(core): register read_skill builtin tool in ProviderManager"
```

---

## Task 6: 全量类型检查与测试

- [ ] **Step 1: 运行全仓类型检查**

```bash
pnpm typecheck
```

Expected: 无错误

- [ ] **Step 2: 运行 core 全部测试**

```bash
pnpm --filter rem-agent-core test
```

Expected: 全部通过

- [ ] **Step 3: 提交（如有类型检查自动修复）**

```bash
git diff --stat
# 如果无变更则跳过
git add -A && git commit -m "chore(core): typecheck and test pass for skill loading feature" || true
```

---

## Self-Review

### Spec coverage

- ✅ `SkillProvider.readSkillRaw` 接口 — Task 1
- ✅ `FileSkillProvider.readSkillRaw` 实现 — Task 3
- ✅ System prompt 引导语 — Task 2
- ✅ `read_skill` 内置工具 — Task 4
- ✅ `ProviderManager` 注册内置工具 — Task 5
- ✅ 错误处理（未找到/读取失败）— Task 4
- ✅ 测试覆盖 — Task 2-6

### Placeholder scan

- 无 TBD/TODO
- 所有步骤包含具体代码和命令
- 所有测试包含具体断言

### Type consistency

- `readSkillRaw(name: string): Promise<string | undefined>` 在接口和实现中一致
- `ReadSkillToolInput` 使用 `Static<typeof readSkillSchema>`
- `ToolProvider` 接口已具备 `register` 方法，无需扩展

---

## 执行方式

Plan complete and saved to `docs/superpowers/plans/2026-07-06-skill-loading-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
