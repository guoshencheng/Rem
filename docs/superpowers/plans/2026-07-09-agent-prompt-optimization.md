# Agent Prompt 优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Rem Agent Core 的 system prompt 从硬编码的 `You are ${agentName}.` 重构为结构化、可扩展、支持 Claude/GPT 模板路由的 system prompt 组装管线。

**Architecture:** 基于 `SystemPromptAssembler` + `PromptSection` + `AgentPromptTemplateSelector` 三层结构；`DefaultSystemPromptAssembler` 按固定顺序调用 section，`ProviderAwareTemplateSelector` 根据 provider/model 选择 Claude 默认模板或 GPT 专用模板。

**Tech Stack:** TypeScript, Node.js ESM, Vitest, tsc

---

## 文件结构总览

### 新增文件

| 文件 | 职责 |
|---|---|
| `packages/core/src/sdk/system-prompt.ts` | 定义 `PromptBuildContext`、`AgentPromptTemplate`、`PromptSection`、`SystemPromptAssembler`、`AgentPromptTemplateSelector` 接口 |
| `packages/core/src/system-prompt/assembler.ts` | `DefaultSystemPromptAssembler` 实现 |
| `packages/core/src/system-prompt/template-selector.ts` | `ProviderAwareTemplateSelector` 实现 |
| `packages/core/src/system-prompt/templates/claude-template.md` | Claude 默认模板内容 |
| `packages/core/src/system-prompt/templates/claude-template.ts` | 读取并渲染 Claude 模板 |
| `packages/core/src/system-prompt/templates/openai-template.md` | GPT 专用模板内容 |
| `packages/core/src/system-prompt/templates/openai-template.ts` | 读取并渲染 OpenAI 模板 |
| `packages/core/src/system-prompt/sections/tooling-section.ts` | Tooling section |
| `packages/core/src/system-prompt/sections/execution-bias-section.ts` | Execution Bias section |
| `packages/core/src/system-prompt/sections/safety-section.ts` | Safety section |
| `packages/core/src/system-prompt/sections/workspace-section.ts` | Workspace section |
| `packages/core/src/system-prompt/sections/agents-md-section.ts` | AGENTS.md section |
| `packages/core/src/system-prompt/sections/skills-section.ts` | Skills section |
| `packages/core/src/system-prompt/sections/runtime-section.ts` | Runtime section |
| `packages/core/src/system-prompt/loaders/project-agents-md-loader.ts` | `AGENTS.md` 加载器 |
| `packages/core/src/system-prompt/index.ts` | 统一导出 |
| `packages/core/scripts/copy-templates.js` | build 时复制 .md 模板到 dist |
| 对应测试文件 | 见各 Task |

### 修改文件

| 文件 | 修改内容 |
|---|---|
| `packages/core/src/agent-context.ts` | 新增 `systemPromptAssembler` 字段 |
| `packages/core/src/agent-context-builder.ts` | 创建 `DefaultSystemPromptAssembler` 并注入 context |
| `packages/core/src/run-agent.ts` | 构造 `PromptBuildContext`，调用 assembler，移除手动 skill catalog 拼接 |
| `packages/core/src/plugins/memory/simple/index.ts` | `system` 字段返回空字符串 |
| `packages/core/package.json` | build 脚本增加模板复制步骤 |

---

## Task 1: SDK 接口与 Assembler

**Files:**
- Create: `packages/core/src/sdk/system-prompt.ts`
- Create: `packages/core/src/system-prompt/assembler.ts`
- Test: `packages/core/tests/system-prompt/assembler.test.ts`

- [ ] **Step 1: 写失败测试**

在 `packages/core/tests/system-prompt/assembler.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { DefaultSystemPromptAssembler } from '../../src/system-prompt/assembler.js';
import type { PromptBuildContext, AgentPromptTemplateSelector, PromptSection } from '../../src/sdk/system-prompt.js';

describe('DefaultSystemPromptAssembler', () => {
  it('joins template and non-empty sections with double newline', async () => {
    const selector: AgentPromptTemplateSelector = {
      select: () => ({ name: 'test', render: async () => 'Identity' }),
    };
    const sections: PromptSection[] = [
      { name: 'a', render: async () => 'Section A' },
      { name: 'b', render: async () => undefined },
      { name: 'c', render: async () => 'Section C' },
    ];
    const assembler = new DefaultSystemPromptAssembler(selector, sections);
    const result = await assembler.assemble({} as PromptBuildContext);
    expect(result).toBe('Identity\n\nSection A\n\nSection C');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter rem-agent-core test packages/core/tests/system-prompt/assembler.test.ts
```

Expected: FAIL（`DefaultSystemPromptAssembler` 或 `system-prompt.ts` 不存在）

- [ ] **Step 3: 实现最小代码**

`packages/core/src/sdk/system-prompt.ts`：

```typescript
export interface ToolInfo {
  name: string;
  description: string;
}

export interface PromptBuildContext {
  agentName: string;
  workspaceRoot: string;
  readOnly: boolean;
  tools: ToolInfo[];
  skills: import('./skill-provider.js').Skill[];
  model: { provider: string; model: string };
  runtime: {
    platform: string;
    nodeVersion: string;
    today: string;
    cwd: string;
  };
}

export interface AgentPromptTemplate {
  readonly name: string;
  render(ctx: PromptBuildContext): string | Promise<string>;
}

export interface AgentPromptTemplateSelector {
  select(ctx: PromptBuildContext): AgentPromptTemplate;
}

export interface PromptSection {
  readonly name: string;
  render(ctx: PromptBuildContext): string | undefined | Promise<string | undefined>;
}

export interface SystemPromptAssembler {
  assemble(ctx: PromptBuildContext): Promise<string>;
}

export interface AgentInstructionLoader {
  load(workspaceRoot: string, agentName: string): Promise<string | undefined>;
}
```

`packages/core/src/system-prompt/assembler.ts`：

```typescript
import type { PromptBuildContext, AgentPromptTemplateSelector, PromptSection, SystemPromptAssembler } from '../sdk/system-prompt.js';

export class DefaultSystemPromptAssembler implements SystemPromptAssembler {
  constructor(
    private templateSelector: AgentPromptTemplateSelector,
    private sections: PromptSection[],
  ) {}

  async assemble(ctx: PromptBuildContext): Promise<string> {
    const template = this.templateSelector.select(ctx);
    const parts: string[] = [await template.render(ctx)];
    for (const section of this.sections) {
      const content = await section.render(ctx);
      if (content) parts.push(content);
    }
    return parts.filter(Boolean).join('\n\n');
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter rem-agent-core test packages/core/tests/system-prompt/assembler.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/sdk/system-prompt.ts packages/core/src/system-prompt/assembler.ts packages/core/tests/system-prompt/assembler.test.ts
git commit -m "feat(system-prompt): add SDK interfaces and default assembler

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Provider-Aware 模板选择器与模板

**Files:**
- Create: `packages/core/src/system-prompt/template-selector.ts`
- Create: `packages/core/src/system-prompt/templates/claude-template.md`
- Create: `packages/core/src/system-prompt/templates/claude-template.ts`
- Create: `packages/core/src/system-prompt/templates/openai-template.md`
- Create: `packages/core/src/system-prompt/templates/openai-template.ts`
- Create: `packages/core/scripts/copy-templates.js`
- Modify: `packages/core/package.json`
- Test: `packages/core/tests/system-prompt/template-selector.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/core/tests/system-prompt/template-selector.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { ProviderAwareTemplateSelector } from '../../src/system-prompt/template-selector.js';
import { ClaudeAgentPromptTemplate } from '../../src/system-prompt/templates/claude-template.js';
import { OpenAiAgentPromptTemplate } from '../../src/system-prompt/templates/openai-template.js';
import type { PromptBuildContext } from '../../src/sdk/system-prompt.js';

const baseCtx = {
  agentName: 'Rem',
  workspaceRoot: '/tmp',
  readOnly: false,
  tools: [],
  skills: [],
  runtime: { platform: 'darwin', nodeVersion: 'v20.0.0', today: '2026-07-09', cwd: '/tmp' },
} as Omit<PromptBuildContext, 'model'>;

describe('ProviderAwareTemplateSelector', () => {
  const selector = new ProviderAwareTemplateSelector(
    new ClaudeAgentPromptTemplate(),
    { openai: new OpenAiAgentPromptTemplate() },
  );

  it('selects Claude template by default', async () => {
    const ctx = { ...baseCtx, model: { provider: 'anthropic', model: 'claude-sonnet-4-6' } } as PromptBuildContext;
    const template = selector.select(ctx);
    const rendered = await template.render(ctx);
    expect(rendered).toContain('powered by Claude');
  });

  it('selects OpenAI template for GPT models', async () => {
    const ctx = { ...baseCtx, model: { provider: 'openai', model: 'gpt-4o' } } as PromptBuildContext;
    const template = selector.select(ctx);
    const rendered = await template.render(ctx);
    expect(rendered).toContain('powered by an OpenAI model');
  });

  it('replaces agentName placeholder', async () => {
    const ctx = { ...baseCtx, agentName: 'Coder', model: { provider: 'anthropic', model: 'claude-sonnet-4-6' } } as PromptBuildContext;
    const template = selector.select(ctx);
    const rendered = await template.render(ctx);
    expect(rendered).toContain('You are Coder,');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter rem-agent-core test packages/core/tests/system-prompt/template-selector.test.ts
```

Expected: FAIL（缺少文件）

- [ ] **Step 3: 实现模板文件与选择器**

`packages/core/src/system-prompt/template-selector.ts`：

```typescript
import type { PromptBuildContext, AgentPromptTemplate, AgentPromptTemplateSelector } from '../sdk/system-prompt.js';

export class ProviderAwareTemplateSelector implements AgentPromptTemplateSelector {
  constructor(
    private defaultTemplate: AgentPromptTemplate,
    private providerTemplates: Record<string, AgentPromptTemplate>,
  ) {}

  select(ctx: PromptBuildContext): AgentPromptTemplate {
    const key = `${ctx.model.provider}/${ctx.model.model}`.toLowerCase();
    if (key.includes('openai') || key.includes('gpt')) {
      return this.providerTemplates['openai'] ?? this.defaultTemplate;
    }
    return this.defaultTemplate;
  }
}
```

`packages/core/src/system-prompt/templates/claude-template.md`：

```markdown
You are {{agentName}}, a general-purpose assistant running inside Rem Agent, powered by Claude.

You help users with software engineering and daily tasks by using the tools available to you.

# Tone and style
- Be concise, direct, and technically accurate.
- Prioritize truthfulness over validating the user's beliefs; disagree respectfully when necessary.
- Your output is displayed in a terminal/chat UI. Use GitHub-flavored markdown for formatting.
- Only use tools to complete tasks; do not use code comments or shell output as a substitute for user communication.
- Avoid emojis unless the user explicitly asks for them.

# Code conventions
- When referencing specific code, use `file_path:line_number`.
- Do not add comments unless asked.
- Do not create files unless absolutely necessary; prefer editing existing files.
- Follow existing code conventions in the project.

# Tool usage
- Use specialized tools instead of bash commands when a first-class tool exists.
- You can call multiple tools in parallel when they are independent.
- If a tool result is weak or empty, vary your query/path/command before giving up.
```

`packages/core/src/system-prompt/templates/claude-template.ts`：

```typescript
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { PromptBuildContext, AgentPromptTemplate } from '../../sdk/system-prompt.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class ClaudeAgentPromptTemplate implements AgentPromptTemplate {
  readonly name = 'claude';
  private content?: string;

  async render(ctx: PromptBuildContext): Promise<string> {
    if (this.content === undefined) {
      this.content = await readFile(join(__dirname, 'claude-template.md'), 'utf-8');
    }
    return this.content.replace(/{{agentName}}/g, ctx.agentName);
  }
}
```

`packages/core/src/system-prompt/templates/openai-template.md`：

```markdown
You are {{agentName}}, a general-purpose assistant running inside Rem Agent, powered by an OpenAI model.

You help users with software engineering and daily tasks by using the tools available to you.

# Tone and style
- Be concise, direct, and to the point. Minimize output tokens while maintaining helpfulness and accuracy.
- Prioritize truthfulness over validating the user's beliefs.
- Your output is displayed in a terminal/chat UI. Use GitHub-flavored markdown for formatting.
- Only use tools to complete tasks; do not use code comments or shell output as a substitute for user communication.

# Code conventions
- When referencing specific code, use `file_path:line_number`.
- Do not add comments unless asked.
- Do not create files unless absolutely necessary; prefer editing existing files.
- Follow existing code conventions in the project.

# Tool usage
- Use specialized tools instead of bash commands when a first-class tool exists.
- Call multiple tools in parallel when they are independent.
- If a tool result is weak or empty, vary your query/path/command before giving up.
```

`packages/core/src/system-prompt/templates/openai-template.ts`：

```typescript
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { PromptBuildContext, AgentPromptTemplate } from '../../sdk/system-prompt.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class OpenAiAgentPromptTemplate implements AgentPromptTemplate {
  readonly name = 'openai';
  private content?: string;

  async render(ctx: PromptBuildContext): Promise<string> {
    if (this.content === undefined) {
      this.content = await readFile(join(__dirname, 'openai-template.md'), 'utf-8');
    }
    return this.content.replace(/{{agentName}}/g, ctx.agentName);
  }
}
```

`packages/core/scripts/copy-templates.js`：

```javascript
import { cp } from 'fs/promises';

await cp('src/system-prompt/templates', 'dist/system-prompt/templates', { recursive: true, force: true });
console.log('Templates copied to dist/system-prompt/templates');
```

修改 `packages/core/package.json`：

```json
"build": "tsc && node scripts/copy-templates.js"
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter rem-agent-core test packages/core/tests/system-prompt/template-selector.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/system-prompt/template-selector.ts packages/core/src/system-prompt/templates packages/core/scripts/copy-templates.js packages/core/package.json packages/core/tests/system-prompt/template-selector.test.ts
git commit -m "feat(system-prompt): add provider-aware template selector and Claude/OpenAI templates

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: AGENTS.md 加载器

**Files:**
- Create: `packages/core/src/system-prompt/loaders/project-agents-md-loader.ts`
- Test: `packages/core/tests/system-prompt/loaders/project-agents-md-loader.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/core/tests/system-prompt/loaders/project-agents-md-loader.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ProjectAgentsMdLoader } from '../../../src/system-prompt/loaders/project-agents-md-loader.js';

describe('ProjectAgentsMdLoader', () => {
  it('returns undefined when AGENTS.md is missing', async () => {
    const loader = new ProjectAgentsMdLoader();
    const result = await loader.load('/nonexistent/path', 'Rem');
    expect(result).toBeUndefined();
  });

  it('loads and trims AGENTS.md content', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rem-agent-test-'));
    await writeFile(join(dir, 'AGENTS.md'), '\n# Project Rules\n\nBe careful.\n\n');
    const loader = new ProjectAgentsMdLoader();
    const result = await loader.load(dir, 'Rem');
    expect(result).toBe('# Project Rules\n\nBe careful.');
    await rm(dir, { recursive: true, force: true });
  });

  it('returns undefined for empty AGENTS.md', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rem-agent-test-'));
    await writeFile(join(dir, 'AGENTS.md'), '   \n   ');
    const loader = new ProjectAgentsMdLoader();
    const result = await loader.load(dir, 'Rem');
    expect(result).toBeUndefined();
    await rm(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter rem-agent-core test packages/core/tests/system-prompt/loaders/project-agents-md-loader.test.ts
```

Expected: FAIL

- [ ] **Step 3: 实现加载器**

`packages/core/src/system-prompt/loaders/project-agents-md-loader.ts`：

```typescript
import { readFile } from 'fs/promises';
import { join } from 'path';
import type { AgentInstructionLoader } from '../../sdk/system-prompt.js';

export class ProjectAgentsMdLoader implements AgentInstructionLoader {
  async load(workspaceRoot: string, _agentName: string): Promise<string | undefined> {
    const filePath = join(workspaceRoot, 'AGENTS.md');
    const content = await readFile(filePath, 'utf-8').catch(() => undefined);
    return content?.trim() || undefined;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter rem-agent-core test packages/core/tests/system-prompt/loaders/project-agents-md-loader.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/system-prompt/loaders/project-agents-md-loader.ts packages/core/src/sdk/system-prompt.ts packages/core/tests/system-prompt/loaders/project-agents-md-loader.test.ts
git commit -m "feat(system-prompt): add AGENTS.md loader

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Tooling Section

**Files:**
- Create: `packages/core/src/system-prompt/sections/tooling-section.ts`
- Test: `packages/core/tests/system-prompt/sections/tooling-section.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/core/tests/system-prompt/sections/tooling-section.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { ToolingSection } from '../../../src/system-prompt/sections/tooling-section.js';
import type { PromptBuildContext } from '../../../src/sdk/system-prompt.js';

const baseCtx: PromptBuildContext = {
  agentName: 'Rem',
  workspaceRoot: '/tmp',
  readOnly: false,
  tools: [],
  skills: [],
  model: { provider: 'openai', model: 'gpt-4o' },
  runtime: { platform: 'darwin', nodeVersion: 'v20.0.0', today: '2026-07-09', cwd: '/tmp' },
};

describe('ToolingSection', () => {
  it('returns undefined when no tools', () => {
    const section = new ToolingSection();
    expect(section.render(baseCtx)).toBeUndefined();
  });

  it('lists tools with descriptions', () => {
    const section = new ToolingSection();
    const ctx = { ...baseCtx, tools: [{ name: 'read', description: 'Read file contents' }] };
    const result = section.render(ctx);
    expect(result).toContain('## Tooling');
    expect(result).toContain('- read: Read file contents');
    expect(result).toContain('Names are case-sensitive');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter rem-agent-core test packages/core/tests/system-prompt/sections/tooling-section.test.ts
```

Expected: FAIL

- [ ] **Step 3: 实现 section**

`packages/core/src/system-prompt/sections/tooling-section.ts`：

```typescript
import type { PromptBuildContext, PromptSection } from '../../sdk/system-prompt.js';

export class ToolingSection implements PromptSection {
  readonly name = 'tooling';

  render(ctx: PromptBuildContext): string | undefined {
    if (ctx.tools.length === 0) return undefined;
    const lines = [
      '## Tooling',
      '',
      'You have access to the following tools. Names are case-sensitive; call exactly as listed.',
      '',
      ...ctx.tools.map((t) => `- ${t.name}: ${t.description}`),
    ];
    return lines.join('\n');
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter rem-agent-core test packages/core/tests/system-prompt/sections/tooling-section.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/system-prompt/sections/tooling-section.ts packages/core/tests/system-prompt/sections/tooling-section.test.ts
git commit -m "feat(system-prompt): add tooling section

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Execution Bias Section

**Files:**
- Create: `packages/core/src/system-prompt/sections/execution-bias-section.ts`
- Test: `packages/core/tests/system-prompt/sections/execution-bias-section.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { ExecutionBiasSection } from '../../../src/system-prompt/sections/execution-bias-section.js';
import type { PromptBuildContext } from '../../../src/sdk/system-prompt.js';

const ctx = {} as PromptBuildContext;

describe('ExecutionBiasSection', () => {
  it('contains key execution bias instructions', () => {
    const section = new ExecutionBiasSection();
    const result = section.render(ctx);
    expect(result).toContain('## Execution Bias');
    expect(result).toContain('Actionable request: act in this turn');
    expect(result).toContain('Continue until done or genuinely blocked');
    expect(result).toContain('Final answer needs evidence');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter rem-agent-core test packages/core/tests/system-prompt/sections/execution-bias-section.test.ts
```

Expected: FAIL

- [ ] **Step 3: 实现 section**

`packages/core/src/system-prompt/sections/execution-bias-section.ts`：

```typescript
import type { PromptBuildContext, PromptSection } from '../../sdk/system-prompt.js';

export class ExecutionBiasSection implements PromptSection {
  readonly name = 'execution-bias';

  render(_ctx: PromptBuildContext): string {
    return [
      '## Execution Bias',
      '',
      '- Actionable request: act in this turn.',
      '- Continue until done or genuinely blocked; do not finish with a plan when tools can move forward.',
      '- Weak/empty tool result: vary query, path, command, or source before concluding.',
      '- Mutable facts need live checks: files, git, clocks, versions, services.',
      '- Final answer needs evidence: test/build/lint output, inspection, or a named blocker.',
    ].join('\n');
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter rem-agent-core test packages/core/tests/system-prompt/sections/execution-bias-section.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/system-prompt/sections/execution-bias-section.ts packages/core/tests/system-prompt/sections/execution-bias-section.test.ts
git commit -m "feat(system-prompt): add execution bias section

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Safety Section

**Files:**
- Create: `packages/core/src/system-prompt/sections/safety-section.ts`
- Test: `packages/core/tests/system-prompt/sections/safety-section.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { SafetySection } from '../../../src/system-prompt/sections/safety-section.js';
import type { PromptBuildContext } from '../../../src/sdk/system-prompt.js';

const ctx = {} as PromptBuildContext;

describe('SafetySection', () => {
  it('contains safety boundary instructions', () => {
    const section = new SafetySection();
    const result = section.render(ctx);
    expect(result).toContain('## Safety');
    expect(result).toContain('No independent goals');
    expect(result).toContain('Before changing config or schedulers');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter rem-agent-core test packages/core/tests/system-prompt/sections/safety-section.test.ts
```

Expected: FAIL

- [ ] **Step 3: 实现 section**

`packages/core/src/system-prompt/sections/safety-section.ts`：

```typescript
import type { PromptBuildContext, PromptSection } from '../../sdk/system-prompt.js';

export class SafetySection implements PromptSection {
  readonly name = 'safety';

  render(_ctx: PromptBuildContext): string {
    return [
      '## Safety',
      '',
      '- No independent goals: no self-preservation, replication, resource acquisition, or power-seeking.',
      '- Safety/oversight over completion. Conflicts: pause and ask.',
      '- Before changing config or schedulers, inspect existing state first and preserve by default.',
      '- Do not persuade anyone to expand access or disable safeguards.',
    ].join('\n');
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter rem-agent-core test packages/core/tests/system-prompt/sections/safety-section.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/system-prompt/sections/safety-section.ts packages/core/tests/system-prompt/sections/safety-section.test.ts
git commit -m "feat(system-prompt): add safety section

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Workspace Section

**Files:**
- Create: `packages/core/src/system-prompt/sections/workspace-section.ts`
- Test: `packages/core/tests/system-prompt/sections/workspace-section.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { WorkspaceSection } from '../../../src/system-prompt/sections/workspace-section.js';
import type { PromptBuildContext } from '../../../src/sdk/system-prompt.js';

const baseCtx: PromptBuildContext = {
  agentName: 'Rem',
  workspaceRoot: '/tmp',
  readOnly: false,
  tools: [],
  skills: [],
  model: { provider: 'openai', model: 'gpt-4o' },
  runtime: { platform: 'darwin', nodeVersion: 'v20.0.0', today: '2026-07-09', cwd: '/tmp' },
};

describe('WorkspaceSection', () => {
  it('returns undefined when workspaceRoot is empty', () => {
    const section = new WorkspaceSection();
    expect(section.render({ ...baseCtx, workspaceRoot: '' })).toBeUndefined();
  });

  it('shows workspace root and read-only status', () => {
    const section = new WorkspaceSection();
    const result = section.render({ ...baseCtx, readOnly: true });
    expect(result).toContain('## Workspace');
    expect(result).toContain('Working directory: /tmp');
    expect(result).toContain('Read-only mode: true');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter rem-agent-core test packages/core/tests/system-prompt/sections/workspace-section.test.ts
```

Expected: FAIL

- [ ] **Step 3: 实现 section**

`packages/core/src/system-prompt/sections/workspace-section.ts`：

```typescript
import type { PromptBuildContext, PromptSection } from '../../sdk/system-prompt.js';

export class WorkspaceSection implements PromptSection {
  readonly name = 'workspace';

  render(ctx: PromptBuildContext): string | undefined {
    if (!ctx.workspaceRoot) return undefined;
    return [
      '## Workspace',
      '',
      `Working directory: ${ctx.workspaceRoot}`,
      `Read-only mode: ${ctx.readOnly}`,
    ].join('\n');
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter rem-agent-core test packages/core/tests/system-prompt/sections/workspace-section.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/system-prompt/sections/workspace-section.ts packages/core/tests/system-prompt/sections/workspace-section.test.ts
git commit -m "feat(system-prompt): add workspace section

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: AGENTS.md Section

**Files:**
- Create: `packages/core/src/system-prompt/sections/agents-md-section.ts`
- Test: `packages/core/tests/system-prompt/sections/agents-md-section.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { AgentsMdSection } from '../../../src/system-prompt/sections/agents-md-section.js';
import type { PromptBuildContext, AgentInstructionLoader } from '../../../src/sdk/system-prompt.js';

const baseCtx: PromptBuildContext = {
  agentName: 'Rem',
  workspaceRoot: '/tmp',
  readOnly: false,
  tools: [],
  skills: [],
  model: { provider: 'openai', model: 'gpt-4o' },
  runtime: { platform: 'darwin', nodeVersion: 'v20.0.0', today: '2026-07-09', cwd: '/tmp' },
};

describe('AgentsMdSection', () => {
  it('returns undefined when loader returns empty', async () => {
    const loader: AgentInstructionLoader = { load: async () => undefined };
    const section = new AgentsMdSection(loader);
    const result = await section.render(baseCtx);
    expect(result).toBeUndefined();
  });

  it('wraps loaded content with heading', async () => {
    const loader: AgentInstructionLoader = { load: async () => '# Rules\n\nBe careful.' };
    const section = new AgentsMdSection(loader);
    const result = await section.render(baseCtx);
    expect(result).toContain('## Project Instructions');
    expect(result).toContain('# Rules\n\nBe careful.');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter rem-agent-core test packages/core/tests/system-prompt/sections/agents-md-section.test.ts
```

Expected: FAIL

- [ ] **Step 3: 实现 section**

`packages/core/src/system-prompt/sections/agents-md-section.ts`：

```typescript
import type { PromptBuildContext, PromptSection, AgentInstructionLoader } from '../../sdk/system-prompt.js';

export class AgentsMdSection implements PromptSection {
  readonly name = 'agents-md';

  constructor(private loader: AgentInstructionLoader) {}

  async render(ctx: PromptBuildContext): Promise<string | undefined> {
    const content = await this.loader.load(ctx.workspaceRoot, ctx.agentName);
    if (!content) return undefined;
    return `## Project Instructions\n\n${content}`;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter rem-agent-core test packages/core/tests/system-prompt/sections/agents-md-section.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/system-prompt/sections/agents-md-section.ts packages/core/tests/system-prompt/sections/agents-md-section.test.ts
git commit -m "feat(system-prompt): add AGENTS.md section

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Skills Section

**Files:**
- Create: `packages/core/src/system-prompt/sections/skills-section.ts`
- Test: `packages/core/tests/system-prompt/sections/skills-section.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { SkillsSection } from '../../../src/system-prompt/sections/skills-section.js';
import type { PromptBuildContext } from '../../../src/sdk/system-prompt.js';
import type { SkillProvider } from '../../../src/sdk/skill-provider.js';

const baseCtx: PromptBuildContext = {
  agentName: 'Rem',
  workspaceRoot: '/tmp',
  readOnly: false,
  tools: [],
  skills: [],
  model: { provider: 'openai', model: 'gpt-4o' },
  runtime: { platform: 'darwin', nodeVersion: 'v20.0.0', today: '2026-07-09', cwd: '/tmp' },
};

describe('SkillsSection', () => {
  it('returns undefined when catalog is empty', () => {
    const skillProvider: SkillProvider = {
      loadSkills: vi.fn(),
      formatCatalog: () => '',
      readSkillRaw: vi.fn(),
    };
    const section = new SkillsSection(skillProvider);
    expect(section.render(baseCtx)).toBeUndefined();
  });

  it('delegates to skillProvider.formatCatalog', () => {
    const skillProvider: SkillProvider = {
      loadSkills: vi.fn(),
      formatCatalog: () => 'SKILL_CATALOG_CONTENT',
      readSkillRaw: vi.fn(),
    };
    const section = new SkillsSection(skillProvider);
    const result = section.render(baseCtx);
    expect(result).toBe('SKILL_CATALOG_CONTENT');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter rem-agent-core test packages/core/tests/system-prompt/sections/skills-section.test.ts
```

Expected: FAIL

- [ ] **Step 3: 实现 section 并调整 SDK 类型**

`packages/core/src/system-prompt/sections/skills-section.ts`：

```typescript
import type { PromptBuildContext, PromptSection } from '../../sdk/system-prompt.js';
import type { SkillProvider, Skill } from '../../sdk/skill-provider.js';

export class SkillsSection implements PromptSection {
  readonly name = 'skills';

  constructor(private skillProvider: SkillProvider) {}

  render(ctx: PromptBuildContext): string | undefined {
    if (ctx.skills.length === 0) return undefined;
    const catalog = this.skillProvider.formatCatalog(ctx.skills as Skill[]);
    return catalog || undefined;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter rem-agent-core test packages/core/tests/system-prompt/sections/skills-section.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/system-prompt/sections/skills-section.ts packages/core/src/sdk/system-prompt.ts packages/core/tests/system-prompt/sections/skills-section.test.ts
git commit -m "feat(system-prompt): add skills section

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Runtime Section

**Files:**
- Create: `packages/core/src/system-prompt/sections/runtime-section.ts`
- Test: `packages/core/tests/system-prompt/sections/runtime-section.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { RuntimeSection } from '../../../src/system-prompt/sections/runtime-section.js';
import type { PromptBuildContext } from '../../../src/sdk/system-prompt.js';

const ctx: PromptBuildContext = {
  agentName: 'Rem',
  workspaceRoot: '/tmp',
  readOnly: false,
  tools: [],
  skills: [],
  model: { provider: 'openai', model: 'gpt-4o' },
  runtime: { platform: 'darwin', nodeVersion: 'v20.0.0', today: '2026-07-09', cwd: '/tmp' },
};

describe('RuntimeSection', () => {
  it('contains runtime info', () => {
    const section = new RuntimeSection();
    const result = section.render(ctx);
    expect(result).toContain('## Runtime');
    expect(result).toContain('Agent: Rem');
    expect(result).toContain('Provider: openai');
    expect(result).toContain('Model: gpt-4o');
    expect(result).toContain('Platform: darwin');
    expect(result).toContain('Date: 2026-07-09');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter rem-agent-core test packages/core/tests/system-prompt/sections/runtime-section.test.ts
```

Expected: FAIL

- [ ] **Step 3: 实现 section**

`packages/core/src/system-prompt/sections/runtime-section.ts`：

```typescript
import type { PromptBuildContext, PromptSection } from '../../sdk/system-prompt.js';

export class RuntimeSection implements PromptSection {
  readonly name = 'runtime';

  render(ctx: PromptBuildContext): string {
    const { agentName, model, runtime } = ctx;
    const parts = [
      `Agent: ${agentName}`,
      `Provider: ${model.provider}`,
      `Model: ${model.model}`,
      `Platform: ${runtime.platform}`,
      `Node: ${runtime.nodeVersion}`,
      `Date: ${runtime.today}`,
    ];
    return `## Runtime\n\n${parts.join(' | ')}`;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter rem-agent-core test packages/core/tests/system-prompt/sections/runtime-section.test.ts
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/system-prompt/sections/runtime-section.ts packages/core/tests/system-prompt/sections/runtime-section.test.ts
git commit -m "feat(system-prompt): add runtime section

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: System Prompt 模块入口

**Files:**
- Create: `packages/core/src/system-prompt/index.ts`

- [ ] **Step 1: 创建入口文件**

`packages/core/src/system-prompt/index.ts`：

```typescript
export { DefaultSystemPromptAssembler } from './assembler.js';
export { ProviderAwareTemplateSelector } from './template-selector.js';
export { ClaudeAgentPromptTemplate } from './templates/claude-template.js';
export { OpenAiAgentPromptTemplate } from './templates/openai-template.js';
export { ToolingSection } from './sections/tooling-section.js';
export { ExecutionBiasSection } from './sections/execution-bias-section.js';
export { SafetySection } from './sections/safety-section.js';
export { WorkspaceSection } from './sections/workspace-section.js';
export { AgentsMdSection } from './sections/agents-md-section.js';
export { SkillsSection } from './sections/skills-section.js';
export { RuntimeSection } from './sections/runtime-section.js';
export { ProjectAgentsMdLoader } from './loaders/project-agents-md-loader.js';
```

- [ ] **Step 2: 类型检查**

```bash
pnpm --filter rem-agent-core typecheck
```

Expected: PASS（可能因其他未引用问题而报错，先确保 system-prompt 目录自身无类型错误）

- [ ] **Step 3: 提交**

```bash
git add packages/core/src/system-prompt/index.ts
git commit -m "feat(system-prompt): add module entrypoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: 更新 AgentContext 与 AgentContextBuilder

**Files:**
- Modify: `packages/core/src/agent-context.ts`
- Modify: `packages/core/src/agent-context-builder.ts`

- [ ] **Step 1: 修改 AgentContext 接口**

`packages/core/src/agent-context.ts`：

```typescript
import type { SystemPromptAssembler } from './sdk/system-prompt.js';

export interface AgentContext {
  // ... 现有字段
  systemPromptAssembler: SystemPromptAssembler;
}
```

- [ ] **Step 2: 修改 AgentContextBuilder**

在 `packages/core/src/agent-context-builder.ts` 中引入：

```typescript
import {
  DefaultSystemPromptAssembler,
  ProviderAwareTemplateSelector,
  ClaudeAgentPromptTemplate,
  OpenAiAgentPromptTemplate,
  ToolingSection,
  ExecutionBiasSection,
  SafetySection,
  WorkspaceSection,
  AgentsMdSection,
  SkillsSection,
  RuntimeSection,
  ProjectAgentsMdLoader,
} from './system-prompt/index.js';
```

在 `buildAgentContext` 中创建 assembler：

```typescript
const templateSelector = new ProviderAwareTemplateSelector(
  new ClaudeAgentPromptTemplate(),
  { openai: new OpenAiAgentPromptTemplate() },
);

const systemPromptAssembler = new DefaultSystemPromptAssembler(
  templateSelector,
  [
    new ToolingSection(),
    new ExecutionBiasSection(),
    new SafetySection(),
    new WorkspaceSection(),
    new AgentsMdSection(new ProjectAgentsMdLoader()),
    new SkillsSection(skillProvider),
    new RuntimeSection(),
  ],
);
```

在返回的 `AgentContext` 中加入 `systemPromptAssembler`。

- [ ] **Step 3: 类型检查**

```bash
pnpm --filter rem-agent-core typecheck
```

Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/agent-context.ts packages/core/src/agent-context-builder.ts
git commit -m "feat(system-prompt): wire assembler into AgentContext

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: 更新 run-agent.ts

**Files:**
- Modify: `packages/core/src/run-agent.ts`

- [ ] **Step 1: 构造 PromptBuildContext 并使用 assembler**

在 `packages/core/src/run-agent.ts` 的 try 块中：

1. 移除这段代码：

```typescript
let systemWithSkills = system;
try {
  const skills = await skillProvider.loadSkills();
  const catalog = skillProvider.formatCatalog(skills);
  if (catalog) systemWithSkills = `${system}\n\n${catalog}`;
} catch { /* best-effort */ }
```

2. 移除 `const { system, messages } = await contextProvider.build(session, behavior.name);` 中的 `system` 使用。

3. 构造 `PromptBuildContext`：

```typescript
const toolSet = effectiveToolProvider.getToolSet();
const tools = Object.entries(toolSet).map(([name, schema]) => ({
  name,
  description: schema.description,
}));

const skills = await skillProvider.loadSkills().catch(() => [] as Skill[]);

const buildCtx: PromptBuildContext = {
  agentName: behavior.name,
  workspaceRoot,
  readOnly: behavior.readOnly,
  tools,
  skills,
  model: { provider: modelConfig.provider, model: modelConfig.model },
  runtime: {
    platform: process.platform,
    nodeVersion: process.version,
    today: new Date().toISOString().split('T')[0],
    cwd: process.cwd(),
  },
};

const systemPrompt = await ctx.systemPromptAssembler.assemble(buildCtx);
```

注意：需要从 `sdk/system-prompt.js` 导入 `PromptBuildContext`，从 `sdk/skill-provider.js` 导入 `Skill` 类型：

```typescript
import type { Skill } from './sdk/skill-provider.js';
```

`ToolInfo` 无需单独导入，因为 `tools` 数组类型会自动推导。

4. 把 `loopCtx.system` 和 `reason()` 调用中的 `systemWithSkills` 替换为 `systemPrompt`。

- [ ] **Step 2: 类型检查**

```bash
pnpm --filter rem-agent-core typecheck
```

Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add packages/core/src/run-agent.ts
git commit -m "feat(system-prompt): use assembler in run-agent

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: 简化 SimpleContextProvider

**Files:**
- Modify: `packages/core/src/plugins/memory/simple/index.ts`
- Test: `packages/core/tests/simple-memory-provider.test.ts`（如果存在相关断言需更新）

- [ ] **Step 1: 修改 SimpleContextProvider**

`packages/core/src/plugins/memory/simple/index.ts`：

```typescript
async build(session: Session, _agentName: string): Promise<{ system: string; messages: ModelMessage[] }> {
  return {
    system: '',
    messages: session.conversation,
  };
}
```

- [ ] **Step 2: 检查并更新现有测试**

如果 `packages/core/tests/simple-memory-provider.test.ts` 存在并断言 `systemPrompt` 内容，需要更新为期望空字符串或移除断言。

- [ ] **Step 3: 类型检查与测试**

```bash
pnpm --filter rem-agent-core typecheck
pnpm --filter rem-agent-core test packages/core/tests/simple-memory-provider.test.ts
```

Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/plugins/memory/simple/index.ts packages/core/tests/simple-memory-provider.test.ts
git commit -m "refactor(system-prompt): clear system prompt from SimpleContextProvider

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: 集成与快照测试

**Files:**
- Create: `packages/core/tests/system-prompt/integration.test.ts`

- [ ] **Step 1: 写集成测试**

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  DefaultSystemPromptAssembler,
  ProviderAwareTemplateSelector,
  ClaudeAgentPromptTemplate,
  OpenAiAgentPromptTemplate,
  ToolingSection,
  ExecutionBiasSection,
  SafetySection,
  WorkspaceSection,
  AgentsMdSection,
  SkillsSection,
  RuntimeSection,
  ProjectAgentsMdLoader,
} from '../../src/system-prompt/index.js';
import type { PromptBuildContext } from '../../src/sdk/system-prompt.js';
import type { SkillProvider } from '../../src/sdk/skill-provider.js';
import { vi } from 'vitest';

async function buildAssembler(skillProvider: SkillProvider) {
  return new DefaultSystemPromptAssembler(
    new ProviderAwareTemplateSelector(
      new ClaudeAgentPromptTemplate(),
      { openai: new OpenAiAgentPromptTemplate() },
    ),
    [
      new ToolingSection(),
      new ExecutionBiasSection(),
      new SafetySection(),
      new WorkspaceSection(),
      new AgentsMdSection(new ProjectAgentsMdLoader()),
      new SkillsSection(skillProvider),
      new RuntimeSection(),
    ],
  );
}

const baseCtx: PromptBuildContext = {
  agentName: 'Rem',
  workspaceRoot: '/tmp',
  readOnly: false,
  tools: [{ name: 'read', description: 'Read file' }],
  skills: [{ name: 'test', description: 'A skill', location: '/tmp/test', content: '' }],
  model: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  runtime: { platform: 'darwin', nodeVersion: 'v20.0.0', today: '2026-07-09', cwd: '/tmp' },
};

describe('system prompt integration', () => {
  it('generates full prompt for Claude model', async () => {
    const skillProvider: SkillProvider = {
      loadSkills: vi.fn(),
      formatCatalog: () => '<available_skills><skill><name>test</name></skill></available_skills>',
      readSkillRaw: vi.fn(),
    };
    const assembler = await buildAssembler(skillProvider);
    const dir = await mkdtemp(join(tmpdir(), 'rem-agent-test-'));
    await writeFile(join(dir, 'AGENTS.md'), '# Project Rules\n\nAlways test.');
    const ctx = { ...baseCtx, workspaceRoot: dir };
    const result = await assembler.assemble(ctx);
    expect(result).toContain('You are Rem,');
    expect(result).toContain('## Tooling');
    expect(result).toContain('## Project Instructions');
    expect(result).toContain('## Runtime');
    expect(result).toMatchSnapshot();
    await rm(dir, { recursive: true, force: true });
  });

  it('generates full prompt for OpenAI model', async () => {
    const skillProvider: SkillProvider = {
      loadSkills: vi.fn(),
      formatCatalog: () => '',
      readSkillRaw: vi.fn(),
    };
    const assembler = await buildAssembler(skillProvider);
    const ctx = { ...baseCtx, model: { provider: 'openai', model: 'gpt-4o' }, skills: [] };
    const result = await assembler.assemble(ctx);
    expect(result).toContain('powered by an OpenAI model');
    expect(result).not.toContain('## Project Instructions');
    expect(result).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: 运行测试生成快照**

```bash
pnpm --filter rem-agent-core test packages/core/tests/system-prompt/integration.test.ts --update
```

Expected: PASS，生成 `.snap` 文件

- [ ] **Step 3: 提交**

```bash
git add packages/core/tests/system-prompt/integration.test.ts packages/core/tests/system-prompt/__snapshots__
git commit -m "test(system-prompt): add integration and snapshot tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: 全量验证与最终提交

- [ ] **Step 1: 全量类型检查**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 2: 全量测试**

```bash
pnpm test
```

Expected: PASS（可能生成新的 coverage 文件，按需提交）

- [ ] **Step 3: 检查 git diff**

```bash
git status
```

确认所有变更文件都已跟踪。

- [ ] **Step 4: 最终提交或收尾提交**

如果还有未提交的 coverage 或快照变更：

```bash
git add coverage packages/core/tests/system-prompt/__snapshots__
git commit -m "test(system-prompt): update snapshots and coverage

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 实施计划自查

### Spec 覆盖检查

| Spec 要求 | 对应 Task |
|---|---|
| `PromptBuildContext` / `AgentPromptTemplate` / `PromptSection` / `SystemPromptAssembler` / `AgentPromptTemplateSelector` 接口 | Task 1 |
| `DefaultSystemPromptAssembler` 按顺序拼接 section | Task 1 |
| `ProviderAwareTemplateSelector` Claude 默认 + GPT 专用 | Task 2 |
| Claude / OpenAI 模板文件 | Task 2 |
| 8 个 section（Identity 通过模板，其余 7 个） | Task 2（Identity）+ Tasks 4-10 |
| `ProjectAgentsMdLoader` | Task 3 |
| AGENTS.md 注入 | Task 8 |
| `AgentContext` 新增字段 | Task 12 |
| `AgentContextBuilder` 创建 assembler | Task 12 |
| `run-agent.ts` 构造 context 并调用 assembler | Task 13 |
| `SimpleContextProvider` 清空 system | Task 14 |
| 单元测试 / 集成测试 / 快照测试 | 各 Task + Task 15 |

### Placeholder 扫描

- 无 TBD / TODO / "implement later" / "fill in details"
- 每个代码步骤都有具体代码
- 每个运行步骤都有命令和预期输出

### 类型一致性检查

- `AgentPromptTemplate.render` 签名前后一致
- `DefaultSystemPromptAssembler` 接收 `AgentPromptTemplateSelector`
- `PromptBuildContext` 中 `tools` 为 `ToolInfo[]`，`skills` 为 `import('./skill-provider.js').Skill[]`
- `SkillsSection` 从 `sdk/skill-provider.js` 导入 `SkillProvider` 和 `Skill`，避免重复定义接口

### 已知风险

- `.md` 模板文件在测试时通过 `fileURLToPath(import.meta.url)` 读取。Vitest 使用 tsx 直接执行 src，因此 `__dirname` 指向 `src/system-prompt/templates`，测试能读到 `.md` 文件；构建后 `copy-templates.js` 会复制到 dist。

---

## 执行交接

**Plan complete and saved to `docs/superpowers/plans/2026-07-09-agent-prompt-optimization.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
