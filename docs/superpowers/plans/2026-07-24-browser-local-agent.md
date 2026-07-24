# 浏览器本地 Agent（LocalAgentService + RemLocalApp）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `runAgent`/AgentService 能在浏览器直接运行，UI 改为 `service: IAgentService` 必传，新增 `<RemLocalApp />` 与纯前端 Vite demo 包。

**Architecture:** Core 平台无关化（runtime 注入 + 修顶层 Node import + 纯装配函数 `assembleAgentContext`）→ bridge 新增 `rem-agent-bridge/local`（IndexedDB 存储 + LocalAgentService）→ UI 破坏性改 props + RemLocalApp（内置 key 设置面板）→ `packages/local-demo` Vite 静态 SPA。

**Tech Stack:** TypeScript / pnpm workspace / vitest / fake-indexeddb / React 19 / Vite / Tailwind v4。

**Spec:** `docs/superpowers/specs/2026-07-24-browser-local-agent-design.md`

**与 spec 的一处细化：** RemLocalApp 的 `tools` prop 类型从 `pi.Tool[]` 改为 `CustomTool[]`（`{ definition: ToolDefinition; executor: ToolExecutor }`，即 core 既有的 `OverlayToolProvider.register` 模式），与代码库现有工具注册方式一致，避免适配 pi-ai Tool 的运行时签名。

---

## Phase 1：Core 平台无关化

### Task 1: randomUUID 统一为 globalThis.crypto

**Files:**
- Modify: `packages/core/src/shared/generate-id.ts`
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/plugins/session/base.ts`
- Modify: `packages/core/src/plugins/session/sqlite/index.ts`
- Modify: `packages/core/src/plugins/session/in-memory/index.ts`
- Modify: `packages/core/src/plugins/storage/sqlite/session-store.ts`
- Modify: `packages/core/src/plugins/storage/sqlite/rule-store.ts`
- Test: `packages/core/tests/generate-id.test.ts`（新建）

- [ ] **Step 1: 找出所有 `from 'crypto'` / `from 'node:crypto'` 引用**

Run: `rg -n "from '(node:)?crypto'" packages/core/src`
Expected: 列出上述文件（可能还有少量其他文件，一并纳入本任务修改）

- [ ] **Step 2: 写失败测试**

创建 `packages/core/tests/generate-id.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { generateId } from '../src/shared/generate-id.js';

describe('generateId', () => {
  it('returns a valid UUID without Node crypto import', () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('does not reference node:crypto in module source', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../src/shared/generate-id.ts', import.meta.url), 'utf-8');
    expect(src).not.toMatch(/from '(node:)?crypto'/);
  });
});
```

Run: `pnpm vitest run packages/core/tests/generate-id.test.ts`
Expected: FAIL（第二条断言失败）

- [ ] **Step 3: 修改 generate-id.ts 与全部引用点**

`packages/core/src/shared/generate-id.ts` 改为：

```ts
export function generateId(): string {
  return globalThis.crypto.randomUUID();
}
```

`session.ts`、`plugins/session/base.ts`、`plugins/session/sqlite/index.ts` 等文件：删除 `import { randomUUID } from 'crypto'`（或 `node:crypto`），改为 `import { generateId } from '<相对路径>/shared/generate-id.js'`，调用点 `randomUUID()` → `generateId()`。

注意各文件到 `src/shared/generate-id.js` 的相对路径不同：
- `session.ts` → `./shared/generate-id.js`
- `plugins/session/base.ts`、`plugins/session/sqlite/index.ts`、`plugins/session/in-memory/index.ts` → `../../shared/generate-id.js`
- `plugins/storage/sqlite/session-store.ts`、`rule-store.ts` → `../../../shared/generate-id.js`

- [ ] **Step 4: 跑测试 + 类型检查**

Run: `pnpm vitest run packages/core/tests/generate-id.test.ts && pnpm --filter rem-agent-core typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src packages/core/tests/generate-id.test.ts
git commit -m "refactor(core): replace node:crypto randomUUID with globalThis.crypto"
```

---

### Task 2: debug-log 改为注入式 sink

**Files:**
- Modify: `packages/core/src/shared/debug-log.ts`
- Create: `packages/core/src/shared/debug-log-file.ts`
- Modify: `packages/core/src/agent-context-builder.ts:90`
- Test: `packages/core/tests/debug-log.test.ts`（新建）

- [ ] **Step 1: 找出 configureDebugLog 全部调用方**

Run: `rg -n "configureDebugLog|configureConsoleOutput" packages/ --glob '*.ts' | grep -v tests`
Expected: 至少 `agent-context-builder.ts:90-93`；如有其他调用方（demo/cli），一并记录，Step 4 同步修改

- [ ] **Step 2: 写失败测试**

创建 `packages/core/tests/debug-log.test.ts`：

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { log, setLogSink, flushDebugLog, isDebugEnabled } from '../src/shared/debug-log.js';

describe('debug-log sink', () => {
  afterEach(() => setLogSink(null));

  it('module source has no static fs import', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../src/shared/debug-log.ts', import.meta.url), 'utf-8');
    expect(src).not.toMatch(/^import .* from '(node:)?fs/m);
  });

  it('writes buffered lines to injected sink', async () => {
    const chunks: string[] = [];
    setLogSink((chunk) => { chunks.push(chunk); });
    expect(isDebugEnabled()).toBe(true);
    log('test', 'hello', { sessionId: 's1' });
    await flushDebugLog();
    await new Promise((r) => setTimeout(r, 150));
    await flushDebugLog();
    expect(chunks.join('')).toContain('[test]');
    expect(chunks.join('')).toContain('hello');
  });

  it('null sink disables logging', () => {
    setLogSink(null);
    expect(isDebugEnabled()).toBe(false);
  });
});
```

Run: `pnpm vitest run packages/core/tests/debug-log.test.ts`
Expected: FAIL（`setLogSink` 未导出）

- [ ] **Step 3: 重构 debug-log.ts 为纯模块**

`packages/core/src/shared/debug-log.ts` 改动要点（保留 `log`/`debugLog`/`flushDebugLog`/`configureConsoleOutput`/`LogContext` 的现有签名与行为）：

- 删除 `import { appendFile } from 'fs/promises'`。
- `let debugFile: string | null` 改为：

```ts
export type LogSink = (chunk: string) => void | Promise<void>;

let sink: LogSink | null = null;

/** 注入日志落盘 sink；传 null 禁用。替代原 configureDebugLog(filePath)。 */
export function setLogSink(s: LogSink | null): void {
  sink = s;
  if (!sink) {
    buffer = [];
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }
}
```

- 删除 `configureDebugLog`，`flushBuffer` 中 `await appendFile(debugFile, lines)` 改为 `if (sink) await sink(lines)`；`scheduleFlush`/`writeToFile` 中的 `debugFile` 判断改 `sink` 判断；`isDebugEnabled` 返回 `sink !== null`。

新建 `packages/core/src/shared/debug-log-file.ts`（Node-only，不被平台无关入口静态引用）：

```ts
import { appendFile } from 'node:fs/promises';
import { setLogSink } from './debug-log.js';

/** Node 环境：把 debug log 写入文件。浏览器入口不要 import 本模块。 */
export function configureFileDebugLog(file: string | null): void {
  if (!file) {
    setLogSink(null);
    return;
  }
  setLogSink((chunk) => {
    void appendFile(file, chunk).catch(() => {});
  });
}
```

- [ ] **Step 4: 修改调用方**

`agent-context-builder.ts`：
- `import { configureDebugLog, configureConsoleOutput } from './shared/debug-log.js'` 改为 `import { configureConsoleOutput } from './shared/debug-log.js'; import { configureFileDebugLog } from './shared/debug-log-file.js';`
- :90 `configureDebugLog(paths.debugLogFile)` 改为 `configureFileDebugLog(paths.debugLogFile)`。

Step 1 找到的其他调用方同步修改。

- [ ] **Step 5: 跑测试 + 全量 core 测试**

Run: `pnpm vitest run packages/core/tests/debug-log.test.ts && pnpm --filter rem-agent-core typecheck && pnpm vitest run packages/core/tests`
Expected: 全绿

- [ ] **Step 6: Commit**

```bash
git add packages/core/src packages/core/tests/debug-log.test.ts
git commit -m "refactor(core): make debug-log platform-neutral with injectable sink"
```

---

### Task 3: WorkspaceOutsideError 拆为纯模块

**Files:**
- Create: `packages/core/src/security/workspace-outside-error.ts`
- Modify: `packages/core/src/security/workspace-root-guard.ts`
- Modify: `packages/core/src/execute/execute-tools.ts:10`

- [ ] **Step 1: 找出 WorkspaceOutsideError 全部引用方**

Run: `rg -n "WorkspaceOutsideError" packages/ --glob '*.ts'`
Expected: `execute-tools.ts`、`workspace-root-guard.ts`，可能还有 file-system 工具与 routes/bridge 的引用，逐一记录

- [ ] **Step 2: 创建纯模块**

`packages/core/src/security/workspace-outside-error.ts`：

```ts
export class WorkspaceOutsideError extends Error {
  constructor(
    public readonly absolutePath: string,
    public readonly workspaceRoot: string,
  ) {
    super(`Path "${absolutePath}" resolves outside workspace root "${workspaceRoot}"`);
    this.name = 'WorkspaceOutsideError';
  }
}
```

- [ ] **Step 3: 改引用**

`workspace-root-guard.ts`：删除类定义，改为 `import { WorkspaceOutsideError } from './workspace-outside-error.js'; export { WorkspaceOutsideError };`（保持旧路径 re-export，Node-only 调用方不用动）。

`execute-tools.ts:10`：`import { WorkspaceOutsideError } from '../security/workspace-root-guard.js'` 改为 `from '../security/workspace-outside-error.js'`。

Step 1 中找到的**平台无关模块**（execute/、bridge 类型等）里的引用也改到新纯模块；file-system 工具插件内的引用保持从 workspace-root-guard 导入即可。

- [ ] **Step 4: 验证**

Run: `pnpm --filter rem-agent-core typecheck && pnpm vitest run packages/core/tests`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add packages/core/src
git commit -m "refactor(core): extract WorkspaceOutsideError into platform-neutral module"
```

---

### Task 4: AgentContext.runtime 注入，消除 runAgent 体内 process.*

**Files:**
- Modify: `packages/core/src/agent-context.ts`
- Modify: `packages/core/src/run-agent.ts:131,205-210`
- Modify: `packages/core/src/agent-context-builder.ts`
- Modify: `packages/core/src/plugins/compressor/llm-summary/index.ts`
- Test: `packages/core/tests/run-agent-runtime.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

创建 `packages/core/tests/run-agent-runtime.test.ts`：

```ts
import { describe, it, expect } from 'vitest';

describe('runAgent platform neutrality', () => {
  it('run-agent.ts does not reference process.* directly', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../src/run-agent.ts', import.meta.url), 'utf-8');
    expect(src).not.toMatch(/\bprocess\.(env|platform|version|cwd)\b/);
  });
});
```

Run: `pnpm vitest run packages/core/tests/run-agent-runtime.test.ts`
Expected: FAIL

- [ ] **Step 2: 定义 AgentRuntimeInfo 并挂上 AgentContext**

`packages/core/src/agent-context.ts` 顶部增加并加入 interface：

```ts
export interface AgentRuntimeInfo {
  platform: string;
  nodeVersion?: string;
  cwd: string;
  env: Record<string, string | undefined>;
}
```

`AgentContext` 增加字段 `runtime: AgentRuntimeInfo;`。

- [ ] **Step 3: run-agent.ts 改读 ctx.runtime**

- :131 `resolveContextWindow(effectiveModel.provider, effectiveModel.model, process.env, ctx.models)` → 第三参改 `ctx.runtime.env`。
- :205-210 `runtime` 块改为：

```ts
        runtime: {
          platform: ctx.runtime.platform,
          nodeVersion: ctx.runtime.nodeVersion ?? ctx.runtime.platform,
          today: new Date().toISOString().split('T')[0],
          cwd: ctx.runtime.cwd,
        },
```

- [ ] **Step 4: compressor 消除 process.env**

先查看 `packages/core/src/plugins/compressor/llm-summary/index.ts:43,47` 的 `resolveContextWindow(..., process.env, ...)` 调用上下文。给 `LLMSummarizingCompressor` 构造函数增加第 4 个可选参数：

```ts
constructor(
  compressionCfg: Required<CompressionConfig>,
  modelConfig: ResolvedModelConfig,
  models: Models,
  private env: Record<string, string | undefined> =
    typeof process !== 'undefined' ? process.env : {},
) {}
```

类内 `process.env` 引用全部改 `this.env`。

- [ ] **Step 5: buildAgentContext 填默认 runtime**

`AgentContextBuildOptions` 增加 `runtime?: AgentRuntimeInfo;`。builder return 对象中增加：

```ts
    runtime: options?.runtime ?? {
      platform: process.platform,
      nodeVersion: process.version,
      cwd: process.cwd(),
      env: process.env,
    },
```

同时 :123 compressor 构造调用末尾追加 env 实参：`(options?.runtime?.env ?? process.env)`。

检查仓内其他手工构造 `AgentContext` 的位置（`rg -n "AgentContext =|: AgentContext" packages/core/src packages/bridge/src packages/core/tests`），测试里的 mock ctx 也要补 `runtime` 字段。

- [ ] **Step 6: 验证**

Run: `pnpm vitest run packages/core/tests/run-agent-runtime.test.ts && pnpm typecheck && pnpm vitest run packages/core/tests packages/bridge/tests`
Expected: 全绿

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): inject AgentRuntimeInfo into AgentContext, remove process.* from runAgent"
```

---

### Task 5: 系统提示模板构建期内联

**Files:**
- Create: `packages/core/scripts/generate-templates.mjs`
- Create: `packages/core/src/system-prompt/templates/generated-templates.ts`（脚本生成）
- Modify: `packages/core/src/system-prompt/templates/claude-template.ts`
- Modify: `packages/core/src/system-prompt/templates/openai-template.ts`
- Modify: `packages/core/package.json:26`
- Delete: `packages/core/scripts/copy-templates.mjs`
- Test: `packages/core/tests/prompt-templates.test.ts`（新建）

- [ ] **Step 1: 确认模板文件与现状**

Run: `ls packages/core/src/system-prompt/templates/`
Expected: 看到 `claude-template.md`、`openai-template.md`（或类似命名）及对应 `.ts`；打开两个 `.ts` 确认与 claude-template.ts 同构

- [ ] **Step 2: 写失败测试**

创建 `packages/core/tests/prompt-templates.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { ClaudeAgentPromptTemplate } from '../src/system-prompt/templates/claude-template.js';
import { OpenAiAgentPromptTemplate } from '../src/system-prompt/templates/openai-template.js';

describe('prompt templates', () => {
  it('templates have no fs/url/path imports', async () => {
    const { readFile } = await import('node:fs/promises');
    for (const f of ['claude-template.ts', 'openai-template.ts']) {
      const src = await readFile(new URL(`../src/system-prompt/templates/${f}`, import.meta.url), 'utf-8');
      expect(src).not.toMatch(/^import .* from '(node:)?(fs|url|path)/m);
    }
  });

  it('renders agent variables into inlined content', async () => {
    const t = new ClaudeAgentPromptTemplate();
    const out = await t.render({ agentName: 'TestAgent', agentCorePrompt: 'CORE' } as never);
    expect(out.length).toBeGreaterThan(100);
  });
});
```

Run: `pnpm vitest run packages/core/tests/prompt-templates.test.ts`
Expected: FAIL（第一条断言失败）

- [ ] **Step 3: 写生成脚本**

`packages/core/scripts/generate-templates.mjs`：

```js
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(dir, '../src/system-prompt/templates');

const entries = [
  ['claude-template.md', 'CLAUDE_TEMPLATE'],
  ['openai-template.md', 'OPENAI_TEMPLATE'],
];

let out = '// Generated by scripts/generate-templates.mjs — do not edit manually.\n';
for (const [file, name] of entries) {
  const content = await readFile(join(templatesDir, file), 'utf-8');
  out += `\nexport const ${name} = ${JSON.stringify(content)};\n`;
}
await writeFile(join(templatesDir, 'generated-templates.ts'), out);
console.log('generated-templates.ts written');
```

- [ ] **Step 4: 改模板类为内联常量**

`claude-template.ts` 整体改为：

```ts
import type { PromptBuildContext, AgentPromptTemplate } from '../../sdk/system-prompt.js';
import { renderAgentRoleVariables } from '../variables/agent-role-variables.js';
import { CLAUDE_TEMPLATE } from './generated-templates.js';

export class ClaudeAgentPromptTemplate implements AgentPromptTemplate {
  readonly name = 'claude';

  async render(ctx: PromptBuildContext): Promise<string> {
    return renderAgentRoleVariables(CLAUDE_TEMPLATE, {
      agentName: ctx.agentName,
      agentCorePrompt: ctx.agentCorePrompt,
    });
  }
}
```

`openai-template.ts` 同构修改（用 `OPENAI_TEMPLATE`）。

- [ ] **Step 5: 生成常量 + 改 build 脚本 + 删 copy-templates**

Run: `node packages/core/scripts/generate-templates.mjs`

`packages/core/package.json` build 改为：

```json
"build": "node scripts/generate-templates.mjs && tsc",
```

删除 `scripts/copy-templates.mjs`。把 `generated-templates.ts` 提交进 git（构建可再生成，提交保证消费方无需先生成）。

- [ ] **Step 6: 验证**

Run: `pnpm vitest run packages/core/tests/prompt-templates.test.ts && pnpm --filter rem-agent-core typecheck && pnpm vitest run packages/core/tests && pnpm --filter rem-agent-core build`
Expected: 全绿，build 成功

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "refactor(core): inline system prompt templates at build time"
```

---

### Task 6: MCP StdioClientTransport 改动态 import

**Files:**
- Modify: `packages/core/src/mcp/connection-manager.ts`

- [ ] **Step 1: 读现状**

Run: `sed -n '40,75p' packages/core/src/mcp/connection-manager.ts`
看清 `createClient` 中 stdio/sse transport 的分支结构。

- [ ] **Step 2: 改动态 import**

- 删除顶层 `import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'`（:2）。
- `createClient` 改为 `private async createClient(...)`，stdio 分支内：

```ts
const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
```

- 调用点（:25 `this.createClient(name, config)`）改 `await this.createClient(name, config)`。

- [ ] **Step 3: 验证**

Run: `pnpm --filter rem-agent-core typecheck && pnpm vitest run packages/core/tests`
Expected: 全绿

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/mcp/connection-manager.ts
git commit -m "refactor(core): lazy-load MCP stdio transport"
```

---

### Task 7: 纯装配函数 assembleAgentContext + builder 注入点补全

**Files:**
- Create: `packages/core/src/agent-context-assembler.ts`
- Create: `packages/core/src/plugins/tool/static/index.ts`
- Create: `packages/core/src/plugins/skill/empty/index.ts`
- Modify: `packages/core/src/agent-context-builder.ts`
- Test: `packages/core/tests/agent-context-assembler.test.ts`（新建）

- [ ] **Step 1: 确认纯默认实现的可复用性**

Run: `head -5 packages/core/src/plugins/budget/fixed/index.ts packages/core/src/plugins/error/simple/index.ts packages/core/src/plugins/loop/react/index.ts packages/core/src/tool-composer.ts packages/core/src/todo/service.ts packages/core/src/plugins/title/llm/index.ts packages/core/src/security/permissions/factory.ts packages/core/src/security/rules/profiles.ts`
确认这些模块顶层无 `node:`/`fs` import（有 import type 无所谓）。若个别有，记录并在浏览器装配时改为注入。

- [ ] **Step 2: 创建 StaticToolProvider**

`packages/core/src/plugins/tool/static/index.ts`：

```ts
import type { TObject } from '@sinclair/typebox';
import type {
  ToolCall, ToolContext, ToolDefinition, ToolExecutor, ToolProvider, ToolResult, ToolSet,
} from '../../../sdk/tool-provider.js';

export interface CustomTool {
  definition: ToolDefinition<TObject>;
  executor: ToolExecutor<TObject>;
}

/** 内存工具集：register 模式，无 Node 依赖。 */
export class StaticToolProvider implements ToolProvider {
  private definitions = new Map<string, ToolDefinition>();
  private executors = new Map<string, ToolExecutor>();

  constructor(tools: CustomTool[] = []) {
    for (const t of tools) this.register(t.definition, t.executor);
  }

  register<T extends TObject>(def: ToolDefinition<T>, executor: ToolExecutor<T>): void {
    this.definitions.set(def.name, def as ToolDefinition);
    this.executors.set(def.name, executor as ToolExecutor);
  }

  getToolSet(): ToolSet {
    return [...this.definitions.values()].map((d) => ({
      name: d.name,
      description: d.description,
      parameters: d.parameters,
    })) as ToolSet;
  }

  getToolDefinition(name: string): ToolDefinition | undefined {
    return this.definitions.get(name);
  }

  async execute(calls: ToolCall[], ctx: ToolContext): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const call of calls) {
      const executor = this.executors.get(call.toolName);
      if (!executor) {
        results.push({ toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: `unknown tool: ${call.toolName}` });
        continue;
      }
      try {
        const r = await executor(call.input as never, ctx);
        results.push({ toolCallId: call.toolCallId, toolName: call.toolName, output: r.output, details: r.details });
      } catch (err) {
        results.push({ toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: err instanceof Error ? err.message : String(err) });
      }
    }
    return results;
  }

  isDangerous(toolName: string): boolean {
    return this.definitions.get(toolName)?.dangerous ?? false;
  }
}
```

- [ ] **Step 3: 创建 EmptySkillProvider**

`packages/core/src/plugins/skill/empty/index.ts`：

```ts
import type { Skill, SkillProvider } from '../../../sdk/skill-provider.js';

export class EmptySkillProvider implements SkillProvider {
  constructor(private skills: Skill[] = []) {}

  async loadSkills(): Promise<Skill[]> {
    return this.skills;
  }

  formatCatalog(skills: Skill[]): string {
    return skills.map((s) => `- ${s.name}: ${s.description}`).join('\n');
  }

  async readSkillRaw(name: string): Promise<string | undefined> {
    return this.skills.find((s) => s.name === name)?.content;
  }
}
```

- [ ] **Step 4: 创建 assembleAgentContext**

`packages/core/src/agent-context-assembler.ts`（纯模块，不 import 任何 Node-only 实现）：

```ts
import type { Models } from '@earendil-works/pi-ai';
import type { AgentContext, AgentRuntimeInfo } from './agent-context.js';
import type { ConfigProvider } from './sdk/config-provider.js';
import type { SessionProvider } from './sdk/session-provider.js';
import type { ToolProvider } from './sdk/tool-provider.js';
import type { ContextProvider } from './sdk/context-provider.js';
import type { SkillProvider } from './sdk/skill-provider.js';
import type { BudgetPolicy } from './sdk/budget-policy.js';
import type { ContextCompressor } from './sdk/compressor.js';
import type { ErrorHandler } from './sdk/error-handler.js';
import type { TitleProvider } from './sdk/title-provider.js';
import type { LoopStrategy } from './sdk/loop-strategy.js';
import type { SystemPromptAssembler } from './sdk/system-prompt.js';
import type { StorageProvider, RuleStorage } from './sdk/storage-provider.js';
import type { McpConnectionManager } from './mcp/connection-manager.js';
import type { FileMutationQueue } from './plugins/tool/file-system/shared/file-mutation-queue.js';
import type { SecurityMode } from './security/permissions/factory.js';
import type { Rule } from './security/rules/rule.js';
import { StaticToolProvider } from './plugins/tool/static/index.js';
import { EmptySkillProvider } from './plugins/skill/empty/index.js';
import { SimpleContextProvider } from './plugins/memory/simple/index.js';
import { FixedBudgetPolicy } from './plugins/budget/fixed/index.js';
import { LLMSummarizingCompressor } from './plugins/compressor/llm-summary/index.js';
import { SimpleErrorHandler } from './plugins/error/simple/index.js';
import { LLMTitleProvider } from './plugins/title/llm/index.js';
import { ReactLoop } from './plugins/loop/react/index.js';
import { DefaultToolComposer } from './tool-composer.js';
import { DefaultTodoService } from './todo/service.js';
import { RuleEngine } from './security/rules/rule-engine.js';
import { getProfileRules } from './security/rules/profiles.js';
import { createPermissionEvaluator, type ApprovalRequestFactory } from './security/permissions/factory.js';

export interface AssembleAgentContextOptions {
  // 必需（浏览器/Node 都必须显式给）
  configProvider: ConfigProvider;
  sessionProvider: SessionProvider;
  storageProvider: StorageProvider;
  systemPromptAssembler: SystemPromptAssembler;
  models: Models;
  runtime: AgentRuntimeInfo;
  mcpManager: McpConnectionManager;
  // 可选（有纯默认实现）
  toolProvider?: ToolProvider;
  mcpProviders?: ToolProvider[];
  skillProvider?: SkillProvider;
  contextProvider?: ContextProvider;
  budgetPolicy?: BudgetPolicy;
  compressor?: ContextCompressor;
  errorHandler?: ErrorHandler;
  titleProvider?: TitleProvider;
  loopStrategy?: LoopStrategy;
  fileMutationQueue?: FileMutationQueue;
  securityMode?: SecurityMode;
}

class NoopFileMutationQueue {
  async withQueue<T>(_filePath: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

export async function buildRuleSecurity(
  configProvider: ConfigProvider,
  ruleStore: RuleStorage,
): Promise<{ ruleEngine: RuleEngine; ruleStore: RuleStorage }> {
  const userRules = await ruleStore.loadAll();
  const config = configProvider.getConfig();
  const profileRules = getProfileRules(config.profile ?? 'coding');
  const defaultRules: Rule[] = [
    { permission: 'read', pattern: '**', action: 'allow', source: 'default' },
    { permission: 'ls', pattern: '**', action: 'allow', source: 'default' },
    { permission: 'session_status', pattern: '*', action: 'allow', source: 'default' },
    { permission: 'todowrite', pattern: '*', action: 'allow', source: 'default' },
  ];
  const sessionRules = config.sessionRules ?? [];
  const ruleEngine = new RuleEngine([...defaultRules, ...profileRules, ...userRules, ...sessionRules]);
  return { ruleEngine, ruleStore };
}

export async function assembleAgentContext(options: AssembleAgentContextOptions): Promise<AgentContext> {
  const { configProvider, storageProvider, models, runtime } = options;

  const compressor = options.compressor
    ?? new LLMSummarizingCompressor(configProvider.getCompressionConfig(), configProvider.getModelConfig(), models, runtime.env);

  const { ruleEngine, ruleStore } = await buildRuleSecurity(configProvider, storageProvider.ruleStore);

  const approvalFactory: ApprovalRequestFactory = { create: (input) => input };
  const securityMode = options.securityMode ?? 'interactive';
  const permissionEvaluator = createPermissionEvaluator(securityMode, ruleEngine, approvalFactory);

  return {
    configProvider,
    sessionProvider: options.sessionProvider,
    toolProvider: options.toolProvider ?? new StaticToolProvider(),
    mcpProviders: options.mcpProviders ?? [],
    skillProvider: options.skillProvider ?? new EmptySkillProvider(),
    toolComposer: new DefaultToolComposer(),
    contextProvider: options.contextProvider ?? new SimpleContextProvider(configProvider),
    budgetPolicy: options.budgetPolicy ?? new FixedBudgetPolicy(configProvider),
    compressor,
    errorHandler: options.errorHandler ?? new SimpleErrorHandler(),
    titleProvider: options.titleProvider ?? new LLMTitleProvider(configProvider, models),
    loopStrategy: options.loopStrategy ?? new ReactLoop(),
    mcpManager: options.mcpManager,
    fileMutationQueue: options.fileMutationQueue ?? (new NoopFileMutationQueue() as FileMutationQueue),
    systemPromptAssembler: options.systemPromptAssembler,
    ruleEngine,
    ruleStore,
    todoService: new DefaultTodoService(storageProvider.todoStore),
    permissionEvaluator,
    securityMode,
    archiveStore: storageProvider.archiveStore,
    workspaceStore: storageProvider.workspaceStore,
    models,
    runtime,
  };
}
```

注意：先读 `packages/core/src/sdk/agent-role.ts`、`plugins/budget/fixed/index.ts` 确认构造签名与本代码一致；不一致以源码为准调整。

- [ ] **Step 5: 写装配测试**

`packages/core/tests/agent-context-assembler.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { assembleAgentContext } from '../src/agent-context-assembler.js';

describe('assembleAgentContext', () => {
  it('module source has no node builtin imports', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../src/agent-context-assembler.ts', import.meta.url), 'utf-8');
    expect(src).not.toMatch(/^import .* from '(node:)?(fs|path|os|crypto|url|child_process)/m);
  });
});
```

再补一个最小装配冒烟测试：构造内存版必需 provider（configProvider/sessionProvider/storageProvider/systemPromptAssembler/models/runtime/mcpManager 用最小 stub），断言返回的 ctx 包含全部 `AgentContext` 字段且 `ruleEngine` 可用。stub 写法参考 `packages/core/tests/` 里已有的 mock 模式。

- [ ] **Step 6: buildAgentContext 改为委托 assembler + 补注入点**

`AgentContextBuildOptions` 增加：

```ts
  runtime?: AgentRuntimeInfo;
  configProvider?: ConfigProvider;
  sessionProvider?: SessionProvider;
  toolProvider?: ToolProvider;
  skillProvider?: SkillProvider;
  contextProvider?: ContextProvider;
  compressor?: ContextCompressor;
  titleProvider?: TitleProvider;
  loopStrategy?: LoopStrategy;
  systemPromptAssembler?: SystemPromptAssembler;
  mcpProviders?: ToolProvider[];
```

`buildAgentContext` 主体改为：保留 paths/debug-log/models/storageProvider 的 Node 默认构造与 `configProvider.init()`（注入的 configProvider 用 `await (configProvider as { init?: () => Promise<void> }).init?.()` 兼容），MCP connectAll 保留；删除 `buildRuleSecurity` 私有函数（改用 assembler 导出版），结尾改为：

```ts
  return assembleAgentContext({
    configProvider,
    sessionProvider: options?.sessionProvider ?? new SqliteSessionProvider(storageProvider.sessionStore),
    storageProvider,
    systemPromptAssembler: options?.systemPromptAssembler ?? defaultAssembler,
    models,
    runtime,
    mcpManager,
    toolProvider: options?.toolProvider ?? createFileSystemTools(configProvider, fileMutationQueue),
    mcpProviders,
    skillProvider: options?.skillProvider ?? new FileSkillProvider(configProvider, paths),
    contextProvider: options?.contextProvider,
    compressor: options?.compressor,
    titleProvider: options?.titleProvider,
    loopStrategy: options?.loopStrategy,
    fileMutationQueue,
    securityMode: options?.securityMode,
  });
```

其中 `runtime` 按 Task 4 Step 5 构造；`defaultAssembler` 为现有 templateSelector + sections 逻辑（保留在 builder）。

- [ ] **Step 7: 全量验证**

Run: `pnpm typecheck && pnpm vitest run packages/core/tests packages/bridge/tests`
Expected: 全绿（现有测试不得回归）

- [ ] **Step 8: Commit**

```bash
git add packages/core
git commit -m "feat(core): add platform-neutral assembleAgentContext with injectable providers"
```

---

### Task 8: rem-agent-core/browser 子路径导出

**Files:**
- Create: `packages/core/src/browser.ts`
- Modify: `packages/core/package.json`（exports）

- [ ] **Step 1: 确认 system-prompt 各模块纯度**

Run: `head -8 packages/core/src/system-prompt/index.ts && rg -ln "from '(node:)?(fs|path|os|url)'" packages/core/src/system-prompt/`
确认 `DefaultSystemPromptAssembler`、`ProviderAwareTemplateSelector`、各 Section 所在文件无 Node import；`ProjectAgentsMdLoader`（fs）所在文件记录下来——browser.ts **不从 system-prompt/index.ts 桶文件导入**，改从具体纯模块文件导入。若 sections 集中在某个含 Node import 的文件，则把纯实现拆出。

- [ ] **Step 2: 创建 browser.ts**

`packages/core/src/browser.ts`（只导出平台无关表面；逐文件 import，不走含 Node-only 的桶文件）：

```ts
// 平台无关入口：浏览器/edge 可用。禁止从此文件 import 任何 Node-only 模块。
export { runAgent } from './run-agent.js';
export type { RunAgentParams, RunAgentResult } from './run-agent.js';
export { AgentState } from './agent-state.js';
export { assembleAgentContext, buildRuleSecurity } from './agent-context-assembler.js';
export type { AssembleAgentContextOptions } from './agent-context-assembler.js';
export type { AgentContext, AgentRuntimeInfo } from './agent-context.js';
export { createCoreModels } from './llm/models.js';
export type { CreateCoreModelsOptions } from './llm/models.js';
export { generateId } from './shared/generate-id.js';
export { log, setLogSink, configureConsoleOutput } from './shared/debug-log.js';
export { StaticToolProvider } from './plugins/tool/static/index.js';
export type { CustomTool } from './plugins/tool/static/index.js';
export { EmptySkillProvider } from './plugins/skill/empty/index.js';
export { SimpleContextProvider } from './plugins/memory/simple/index.js';
export { ReactLoop } from './plugins/loop/react/index.js';
export { UnsupportedSessionSchemaError } from './plugins/session/errors.js';
// system-prompt 纯件：从 Step 1 确认无 Node import 的具体模块文件逐个导入；
// 禁止从 './system-prompt/index.js' 桶文件导入（它 re-export 含 fs 的 loader）。
// 如果 DefaultSystemPromptAssembler / ProviderAwareTemplateSelector / 各 Section
// 与 Node-only 代码同文件，先把纯实现拆到独立文件再从新文件导出。
export { ClaudeAgentPromptTemplate } from './system-prompt/templates/claude-template.js';
export { OpenAiAgentPromptTemplate } from './system-prompt/templates/openai-template.js';
// 各 Section 按 Step 1 确认的实际纯模块路径导出（ToolingSection/ExecutionBiasSection/
// SafetySection/AgentsMdSection/SkillsSection/WorkspaceSection/RuntimeSection）
// 常用类型
export type * from './sdk/config-provider.js';
export type * from './sdk/session-provider.js';
export type * from './sdk/tool-provider.js';
export type * from './sdk/skill-provider.js';
export type * from './sdk/storage-provider.js';
export type * from './sdk/system-prompt.js';
export type * from './sdk/compressor.js';
export type * from './sdk/title-provider.js';
export type * from './sdk/loop-strategy.js';
export type * from './sdk/context-provider.js';
export type * from './sdk/budget-policy.js';
export type * from './sdk/error-handler.js';
export type * from './sdk/tool-composer.js';
export type { Session, SessionSummary } from './session.js';
export type { Rule } from './security/rules/rule.js';
export type { TodoItem } from './todo/types.js';
export type { SecurityMode } from './security/permissions/factory.js';
export type { ApprovalDecision, ApprovalRequest } from './security/permissions/types.js';
export type { UserInputContent, AgentOutput, AgentStream } from './types.js';
```

写之前先 `rg -n "export" packages/core/src/index.ts` 对齐现有类型名（`ApprovalDecision`/`UserInputContent` 等的真实出处），以源码为准。

- [ ] **Step 3: package.json 加 exports**

`packages/core/package.json` exports 增加：

```json
    "./browser": {
      "import": "./dist/browser.js",
      "types": "./dist/browser.d.ts"
    },
```

- [ ] **Step 4: 构建验证 + 纯度过检**

Run: `pnpm --filter rem-agent-core build && node -e "const m = await import('/Users/guoshencheng/Documents/work/rem/packages/core/dist/browser.js'); console.log(Object.keys(m).length)"`
Expected: 构建成功，browser.js 可加载且导出非空。再跑 `rg -n "node:|from 'fs'|from 'crypto'" packages/core/dist/browser.js` 无命中；并抽查 browser.js 的静态依赖闭包（dist 里被它 import 的文件）无 Node builtin 静态 import。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/browser.ts packages/core/package.json
git commit -m "feat(core): add rem-agent-core/browser platform-neutral entry"
```

---

## Phase 2：Bridge 浏览器实现（rem-agent-bridge/local）

### Task 9: IAgentService.searchSessions 三实现

**Files:**
- Modify: `packages/bridge/src/agent-service.interface.ts`
- Modify: `packages/bridge/src/agent-session.ts`
- Modify: `packages/bridge/src/agent.ts`
- Modify: `packages/bridge/src/agent-remote-service.ts`
- Test: `packages/bridge/tests/agent-service.test.ts`（已有，追加用例）

- [ ] **Step 1: 确认 routes 已支持 q 参数**

Run: `sed -n '1,40p' packages/routes/src/handlers/sessions.ts`
Expected: GET /sessions 处理函数读取 `q` query 参数并过滤。若不支持，先在该 handler 补上（按 title 大小写不敏感 includes 过滤）。

- [ ] **Step 2: 接口加方法**

`agent-service.interface.ts` 在 `listSessions` 后加：

```ts
  searchSessions(workspace: string, q: string): Promise<SessionSummary[]>;
```

- [ ] **Step 3: SessionManager 实现**

`agent-session.ts` 增加：

```ts
  async searchSessions(workspace: string, q: string): Promise<SessionSummary[]> {
    const all = await this.listSessions(workspace);
    const lower = q.toLowerCase();
    return all.filter((s) => (s.title ?? '').toLowerCase().includes(lower));
  }
```

- [ ] **Step 4: AgentService 委托**

`agent.ts` 增加：

```ts
  async searchSessions(workspace: string, q: string): Promise<SessionSummary[]> {
    this.ensureInitialized();
    return this.sessionManager!.searchSessions(workspace, q);
  }
```

- [ ] **Step 5: AgentRemoteService 实现**

`agent-remote-service.ts` 在 `listSessions` 后加：

```ts
  async searchSessions(workspace: string, q: string): Promise<SessionSummary[]> {
    const response = await fetch(`${this.resolvedBaseUrl}${this.apiPrefix}/sessions?${AgentRemoteService.wsQuery(workspace)}&q=${encodeURIComponent(q)}`);
    if (!response.ok) {
      throw new Error(`Failed to search sessions: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as SessionSummary[];
  }
```

- [ ] **Step 6: 测试**

在 `packages/bridge/tests/agent-service.test.ts` 追加：创建 2 个 session（一个 title 含 "hello"），`searchSessions(ws, 'hello')` 只返回匹配的；空串返回全部。参照文件内现有用例的 setup 模式。

Run: `pnpm vitest run packages/bridge/tests && pnpm typecheck`
Expected: 全绿

- [ ] **Step 7: Commit**

```bash
git add packages/bridge packages/routes
git commit -m "feat(bridge): add searchSessions to IAgentService and all implementations"
```

---

### Task 10: IndexedDB promise 化 helper

**Files:**
- Create: `packages/bridge/src/local/idb.ts`
- Test: `packages/bridge/tests/local-idb.test.ts`（新建）

- [ ] **Step 1: 加 fake-indexeddb 依赖**

Run: `pnpm add -Dw fake-indexeddb`
（根 package.json devDependencies）

- [ ] **Step 2: 写失败测试**

`packages/bridge/tests/local-idb.test.ts`：

```ts
// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { openDatabase, txStore, reqPromise } from '../src/local/idb.js';

describe('idb helper', () => {
  it('opens db, creates stores, round-trips a record', async () => {
    const db = await openDatabase('test-db', 1, (d) => {
      d.createObjectStore('items', { keyPath: 'id' });
    });
    const store = txStore(db, 'items', 'readwrite');
    await reqPromise(store.put({ id: 'a', v: 1 }));
    const got = await reqPromise(txStore(db, 'items', 'readonly').get('a')) as { id: string; v: number };
    expect(got.v).toBe(1);
    db.close();
    indexedDB.deleteDatabase('test-db');
  });
});
```

Run: `pnpm vitest run packages/bridge/tests/local-idb.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 idb.ts**

`packages/bridge/src/local/idb.ts`：

```ts
/** 原生 IndexedDB 的极简 promise 封装，无第三方依赖。 */

export function reqPromise<T = unknown>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export function openDatabase(
  name: string,
  version: number,
  upgrade: (db: IDBDatabase) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error(`Failed to open IndexedDB "${name}"`));
  });
}

export function txStore(db: IDBDatabase, store: string, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(store, mode).objectStore(store);
}

export async function getAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return reqPromise(txStore(db, store, 'readonly').getAll()) as Promise<T[]>;
}

export async function getAllByIndex<T>(db: IDBDatabase, store: string, index: string, key: IDBValidKey): Promise<T[]> {
  return reqPromise(txStore(db, store, 'readonly').index(index).getAll(key)) as Promise<T[]>;
}
```

- [ ] **Step 4: 跑测试**

Run: `pnpm vitest run packages/bridge/tests/local-idb.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/local/idb.ts packages/bridge/tests/local-idb.test.ts package.json pnpm-lock.yaml
git commit -m "feat(bridge): add minimal IndexedDB promise helper"
```

---

### Task 11: IndexedDBStorageProvider + BrowserSessionProvider

**Files:**
- Create: `packages/bridge/src/local/idb-storage-provider.ts`
- Create: `packages/bridge/src/local/browser-session-provider.ts`
- Test: `packages/bridge/tests/local-idb-storage.test.ts`（新建）

- [ ] **Step 1: 写失败测试（镜像 Sqlite 实现的关键行为）**

`packages/bridge/tests/local-idb-storage.test.ts`：

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IndexedDBStorageProvider } from '../src/local/idb-storage-provider.js';
import { BrowserSessionProvider } from '../src/local/browser-session-provider.js';

describe('IndexedDBStorageProvider', () => {
  let provider: IndexedDBStorageProvider;

  beforeEach(async () => {
    provider = new IndexedDBStorageProvider(`test-${Math.random().toString(36).slice(2)}`);
    await provider.init();
  });

  it('session round-trip with dates revived', async () => {
    const s = await provider.sessionStore.create('ws1');
    s.metadata.title = 'hello';
    await provider.sessionStore.save(s);
    const loaded = await provider.sessionStore.load(s.sessionId);
    expect(loaded?.metadata.title).toBe('hello');
    expect(loaded?.createdAt).toBeInstanceOf(Date);
  });

  it('listByWorkspace filters', async () => {
    await provider.sessionStore.create('ws1');
    await provider.sessionStore.create('ws2');
    expect(await provider.sessionStore.listByWorkspace('ws1')).toHaveLength(1);
    expect(await provider.sessionStore.listAll()).toHaveLength(2);
  });

  it('todo replace/get', async () => {
    await provider.todoStore.replaceForSession('s1', [{ id: 't1', title: 'x', status: 'pending' } as never]);
    expect(await provider.todoStore.getBySession('s1')).toHaveLength(1);
  });

  it('rule save/loadBySource', async () => {
    await provider.ruleStore.saveApproved({ permission: 'read', pattern: '**', action: 'allow' });
    expect(await provider.ruleStore.loadBySource('approved')).toHaveLength(1);
    expect(await provider.ruleStore.loadAll()).toHaveLength(1);
  });

  it('archive save/getLatest versions', async () => {
    await provider.archiveStore.save({ id: 'a1', sessionId: 's1', compressedAt: new Date(), version: 1, conversationSnapshot: [], summary: '' });
    await provider.archiveStore.save({ id: 'a2', sessionId: 's1', compressedAt: new Date(), version: 2, conversationSnapshot: [], summary: '' });
    expect((await provider.archiveStore.getLatest('s1'))?.version).toBe(2);
  });

  it('workspace add/list/remove', async () => {
    await provider.workspaceStore.add('/ws/a');
    expect(await provider.workspaceStore.list()).toHaveLength(1);
    await provider.workspaceStore.remove('/ws/a');
    expect(await provider.workspaceStore.list()).toHaveLength(0);
  });

  it('BrowserSessionProvider create/load/addMessage', async () => {
    const sp = new BrowserSessionProvider(provider.sessionStore);
    const s = await sp.create();
    const { messageId, message } = sp.addMessage(s, 'assistant');
    sp.appendContent(s, message, { type: 'text', text: 'hi' } as never);
    await sp.save(s);
    const loaded = await sp.load(s.sessionId);
    expect(loaded?.conversation).toHaveLength(1);
    expect(messageId).toBeTruthy();
  });
});
```

Run: `pnpm vitest run packages/bridge/tests/local-idb-storage.test.ts`
Expected: FAIL

- [ ] **Step 2: 实现 idb-storage-provider.ts**

`packages/bridge/src/local/idb-storage-provider.ts`。要点：
- `openDatabase(name, 1, upgrade)` 中建 5 个 store：`sessions`（keyPath `sessionId`，index `workspace` on `workspace`）、`todos`（keyPath `sessionId`）、`rules`（keyPath `id` autoIncrement，index `source`）、`archives`（keyPath `id`，index `sessionId`）、`workspaces`（keyPath `path`）。
- sessions record 形如 `{ sessionId, workspace, data }`，`data` 为 session 的 JSON 序列化（`createdAt`/`updatedAt` 转 ISO string，读回时 revive 为 `Date`）。
- `listByWorkspace` 用 `getAllByIndex(db, 'sessions', 'workspace', workspace)`，映射为 `SessionSummary`（title/pinned 从 `data.metadata` 取，`messageCount` 取 `data.conversation.length`）。
- `init()` 失败（如隐私模式）：catch 后把 `this.db = null`，所有 store 操作降级到内存 Map 实现并 `console.warn`——内存降级实现抽成文件内私有 class，与 idb 实现同接口，按 `this.db ? idb : memory` 分派。
- 接口严格按 `packages/core/src/sdk/storage-provider.ts` 的 `StorageProvider`/`SessionStore`/`TodoStore`/`RuleStorage`/`ArchiveStore`/`WorkspaceStore` 实现；类型从 `rem-agent-core/browser` import。
- `close()` 关闭 db。

- [ ] **Step 3: 实现 browser-session-provider.ts**

`packages/bridge/src/local/browser-session-provider.ts`：镜像 `packages/core/src/plugins/session/sqlite/index.ts` 的 `SqliteSessionProvider`，差异仅两处：`randomUUID()` 改用 `rem-agent-core/browser` 的 `generateId()`；`UnsupportedSessionSchemaError` 从 `rem-agent-core/browser` import。构造同 `(private store: SessionStore)`，`create()` 调 `store.create('default')`。

- [ ] **Step 4: 跑测试**

Run: `pnpm vitest run packages/bridge/tests/local-idb-storage.test.ts && pnpm --filter rem-agent-bridge typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/local packages/bridge/tests/local-idb-storage.test.ts
git commit -m "feat(bridge): add IndexedDB storage provider and browser session provider"
```

---

### Task 12: CredentialStore

**Files:**
- Create: `packages/bridge/src/local/credential-store.ts`
- Test: `packages/bridge/tests/local-credential-store.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

`packages/bridge/tests/local-credential-store.test.ts`：

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { CredentialStore } from '../src/local/credential-store.js';

describe('CredentialStore', () => {
  it('save/load/clear round-trip', async () => {
    const store = new CredentialStore(`cred-test-${Math.random().toString(36).slice(2)}`);
    expect(await store.load()).toBeNull();
    await store.save({ provider: 'anthropic', apiKey: 'sk-test', model: 'claude-sonnet-4-5' });
    const loaded = await store.load();
    expect(loaded?.provider).toBe('anthropic');
    expect(loaded?.apiKey).toBe('sk-test');
    await store.clear();
    expect(await store.load()).toBeNull();
  });
});
```

- [ ] **Step 2: 实现**

`packages/bridge/src/local/credential-store.ts`：

```ts
import { openDatabase, reqPromise, txStore } from './idb.js';

export interface ProviderCredential {
  provider: string;
  apiKey: string;
  model?: string;
  baseURL?: string;
}

const STORE = 'credential';
const KEY = 'active';

export class CredentialStore {
  constructor(private dbName = 'rem-agent') {}

  private async db(): Promise<IDBDatabase> {
    return openDatabase(this.dbName, 1, (d) => {
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
    });
  }

  async load(): Promise<ProviderCredential | null> {
    const db = await this.db();
    try {
      const v = await reqPromise(txStore(db, STORE, 'readonly').get(KEY));
      return (v as ProviderCredential | undefined) ?? null;
    } finally {
      db.close();
    }
  }

  async save(credential: ProviderCredential): Promise<void> {
    const db = await this.db();
    try {
      await reqPromise(txStore(db, STORE, 'readwrite').put(credential, KEY));
    } finally {
      db.close();
    }
  }

  async clear(): Promise<void> {
    const db = await this.db();
    try {
      await reqPromise(txStore(db, STORE, 'readwrite').delete(KEY));
    } finally {
      db.close();
    }
  }
}
```

注意：`IndexedDBStorageProvider` 与 `CredentialStore` 默认 dbName 都是 `rem-agent` 但 version/store 定义不同会冲突——统一方案：`CredentialStore` 默认 dbName 也用 `rem-agent`，但 version 升 2 且在 upgrade 里 `if (!d.objectStoreNames.contains(...)) createObjectStore(...)` 幂等创建全部 store；`IndexedDBStorageProvider` 同步把 upgrade 回调改为幂等创建 5 个 store + version 2。两处的 upgrade 函数必须创建**并集**（sessions/todos/rules/archives/workspaces/credential）。把 upgrade 逻辑抽成 `local/schema.ts` 导出 `upgradeRemAgentDb(db)` 供两处共用。

- [ ] **Step 3: 跑测试**

Run: `pnpm vitest run packages/bridge/tests/local-credential-store.test.ts packages/bridge/tests/local-idb-storage.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/bridge/src/local packages/bridge/tests/local-credential-store.test.ts
git commit -m "feat(bridge): add CredentialStore with shared idb schema"
```

---

### Task 13: 浏览器 ConfigProvider / NoopCompressor

**Files:**
- Create: `packages/bridge/src/local/static-config-provider.ts`
- Create: `packages/bridge/src/local/noop-compressor.ts`
- Test: `packages/bridge/tests/local-static-config.test.ts`（新建）

- [ ] **Step 1: 读 ResolvedAgentRole 与相关类型**

Run: `cat packages/core/src/sdk/agent-role.ts`
确认 `ResolvedAgentRole` 的字段（runAgent 用到 `agentRole.model`、`agentRole.name`、`agentRole.corePrompt`）。

- [ ] **Step 2: 写失败测试**

`packages/bridge/tests/local-static-config.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { StaticConfigProvider } from '../src/local/static-config-provider.js';
import { NoopCompressor } from '../src/local/noop-compressor.js';

describe('StaticConfigProvider', () => {
  it('resolves model config with apiKey', () => {
    const cp = new StaticConfigProvider({ provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: 'sk-x' });
    const mc = cp.getModelConfig();
    expect(mc.provider).toBe('anthropic');
    expect(mc.apiKey).toBe('sk-x');
    expect(cp.getMcpConfig()).toEqual({});
    expect(cp.getBehaviorConfig().maxTurns).toBeGreaterThan(0);
    expect(cp.resolveAgent().name).toBeTruthy();
  });
});

describe('NoopCompressor', () => {
  it('never compresses', async () => {
    const c = new NoopCompressor();
    expect(c.shouldCompress({} as never)).toBe(false);
    expect(await c.compress([1, 2] as never)).toEqual([1, 2]);
  });
});
```

- [ ] **Step 3: 实现 static-config-provider.ts**

`packages/bridge/src/local/static-config-provider.ts`：实现 core `ConfigProvider` 接口（类型从 `rem-agent-core/browser` import）：

```ts
import type {
  AgentToolConfig, CompressionConfig, ConfigProvider, ResolvedAgentConfig,
  ResolvedModelConfig, McpServerConfig, ResolvedAgentRole,
} from 'rem-agent-core/browser';

export interface StaticConfigOptions {
  provider: string;
  model: string;
  apiKey: string;
  baseURL?: string;
  name?: string;
  maxTurns?: number;
  workspaceRoot?: string;
}

export class StaticConfigProvider implements ConfigProvider {
  constructor(private options: StaticConfigOptions) {}

  getConfig(): ResolvedAgentConfig {
    return { ...this.getBehaviorConfig(), model: this.getModelConfig() };
  }

  getModelConfig(): ResolvedModelConfig {
    return {
      provider: this.options.provider,
      model: this.options.model,
      apiKey: this.options.apiKey,
      baseURL: this.options.baseURL,
    };
  }

  getToolConfig(): AgentToolConfig {
    return {};
  }

  getBehaviorConfig() {
    return {
      name: this.options.name ?? 'Rem',
      maxTurns: this.options.maxTurns ?? 60,
      workspaceRoot: this.options.workspaceRoot ?? '/',
      readOnly: false,
      autoApproveDangerous: true,
      sessionsDir: '',
      profile: 'coding',
      sessionRules: [],
      compression: this.getCompressionConfig(),
    } as ReturnType<ConfigProvider['getBehaviorConfig']>;
  }

  getCompressionConfig(): Required<CompressionConfig> {
    return { enabled: false, thresholdRatio: 0.8, protectHead: 4, protectTail: 8 };
  }

  getMcpConfig(): Record<string, McpServerConfig> {
    return {};
  }

  resolveAgent(): ResolvedAgentRole {
    return {
      name: this.options.name ?? 'Rem',
      model: undefined,
      corePrompt: '',
    } as ResolvedAgentRole;
  }
}
```

字段以 Step 1 读到的真实类型为准调整；若 `McpServerConfig`/`ResolvedAgentRole` 未从 `rem-agent-core/browser` 导出，回 Task 8 的 browser.ts 补 export（在同一个 commit 内完成）。

- [ ] **Step 4: 实现 noop-compressor.ts**

```ts
import type { ContextCompressor } from 'rem-agent-core/browser';
import type { Message } from '@earendil-works/pi-ai';
import type { Session } from 'rem-agent-core/browser';

export class NoopCompressor implements ContextCompressor {
  shouldCompress(_session: Session): boolean {
    return false;
  }

  async compress(messages: Message[]): Promise<Message[]> {
    return messages;
  }
}
```

先 `cat packages/core/src/sdk/compressor.ts` 确认接口签名，以源码为准。

- [ ] **Step 5: 跑测试**

Run: `pnpm vitest run packages/bridge/tests/local-static-config.test.ts && pnpm --filter rem-agent-bridge typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/bridge/src/local packages/bridge/tests/local-static-config.test.ts packages/core/src/browser.ts
git commit -m "feat(bridge): add static config provider and noop compressor for browser"
```

---

### Task 14: AgentServiceCore 抽取 + LocalAgentService + /local 导出

**Files:**
- Create: `packages/bridge/src/agent-service-core.ts`
- Modify: `packages/bridge/src/agent.ts`
- Create: `packages/bridge/src/local/agent-local-service.ts`
- Create: `packages/bridge/src/local/idb-workspace-repository.ts`
- Create: `packages/bridge/src/local.ts`
- Modify: `packages/bridge/package.json`（exports）
- Test: `packages/bridge/tests/local-agent-service.test.ts`（新建）

- [ ] **Step 1: 抽取 AgentServiceCore**

把 `agent.ts` 中除 `init()`/`buildAgentContext` 之外的实现（run/drive/interrupt/reset/getMessages/getTodos/createSession/listSessions/searchSessions/updateSession/deleteSession/listPendingApprovals/resolveApproval/stream/listWorkspaces/addWorkspace/removeWorkspace）抽成 `agent-service-core.ts`：

```ts
export interface AgentServiceCoreDeps {
  ctx: AgentContext;
  agentState: AgentState;
  sessionManager: AgentSessionManager;
  workspaceRepository: WorkspaceRepository;
}

export class AgentServiceCore implements IAgentService {
  constructor(private deps: AgentServiceCoreDeps) {}
  async init(): Promise<void> {}
  // ……从 agent.ts 平移的方法体，this.ctx → this.deps.ctx，this.agentState → this.deps.agentState，
  // this.sessionManager → this.deps.sessionManager，this.workspaceRepository → this.deps.workspaceRepository
}
```

`AgentService` 改为持有 `AgentServiceCore`，`init()` 里 `buildAgentContext` 后组装 deps，所有 `IAgentService` 方法一行委托。`AgentService.context`/`AgentService.state` getter 保留。现有 `packages/bridge/tests/agent-service.test.ts` 必须不改用例全绿。

- [ ] **Step 2: 验证抽取无回归**

Run: `pnpm vitest run packages/bridge/tests && pnpm --filter rem-agent-bridge typecheck`
Expected: 全绿

- [ ] **Step 3: Commit（抽取单独一个提交）**

```bash
git add packages/bridge/src
git commit -m "refactor(bridge): extract AgentServiceCore from AgentService"
```

- [ ] **Step 4: 写 LocalAgentService 失败测试**

`packages/bridge/tests/local-agent-service.test.ts`：

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { LocalAgentService } from '../src/local/agent-local-service.js';

describe('LocalAgentService', () => {
  it('init + workspace + session CRUD + stream', async () => {
    const svc = new LocalAgentService({
      credential: { provider: 'anthropic', apiKey: 'sk-test', model: 'claude-sonnet-4-5' },
      dbName: `svc-test-${Math.random().toString(36).slice(2)}`,
    });
    await svc.init();

    await svc.addWorkspace('default');
    expect(await svc.listWorkspaces()).toHaveLength(1);

    const s = await svc.createSession('default');
    expect(s.sessionId).toBeTruthy();
    expect(await svc.listSessions('default')).toHaveLength(1);

    await svc.updateSession('default', s.sessionId, { title: 'renamed' });
    expect((await svc.searchSessions('default', 'renam'))).toHaveLength(1);

    expect(await svc.getMessages('default', s.sessionId)).toEqual([]);
    expect(await svc.getTodos('default', s.sessionId)).toEqual([]);

    // stream 是可中断的 AsyncIterable
    const controller = new AbortController();
    const iter = svc.stream(controller.signal)[Symbol.asyncIterator]();
    controller.abort();
    await iter.next();

    await svc.deleteSession('default', s.sessionId);
    expect(await svc.listSessions('default')).toHaveLength(0);
  });
});
```

（不测试 run()——需要真实 LLM；run 路径由 demo 手动验证。）

- [ ] **Step 5: 实现 idb-workspace-repository.ts**

`packages/bridge/src/local/idb-workspace-repository.ts`：实现 bridge `WorkspaceRepository` 接口（先 `cat packages/bridge/src/workspace-repository.ts packages/bridge/src/types.ts` 确认 `Workspace` 形状，一般是 `{ path: string }`），内部委托 `StorageProvider.workspaceStore`，`list()` 把 `WorkspaceRecord` 映射为 `Workspace`。

- [ ] **Step 6: 实现 agent-local-service.ts**

`packages/bridge/src/local/agent-local-service.ts`：

```ts
import {
  AgentState, assembleAgentContext, createCoreModels,
  DefaultSystemPromptAssembler, ProviderAwareTemplateSelector,
  ClaudeAgentPromptTemplate, OpenAiAgentPromptTemplate,
  StaticToolProvider, EmptySkillProvider,
} from 'rem-agent-core/browser';
import type { AgentContext, CustomTool } from 'rem-agent-core/browser';
import type { IAgentService } from '../agent-service.interface.js';
import { AgentSessionManager } from '../agent-session.js';
import { AgentServiceCore } from '../agent-service-core.js';
import { IndexedDBStorageProvider } from './idb-storage-provider.js';
import { BrowserSessionProvider } from './browser-session-provider.js';
import { StaticConfigProvider } from './static-config-provider.js';
import { NoopCompressor } from './noop-compressor.js';
import { IdbWorkspaceRepository } from './idb-workspace-repository.js';
import type { ProviderCredential } from './credential-store.js';

export interface LocalAgentServiceOptions {
  credential: ProviderCredential;
  tools?: CustomTool[];
  maxTurns?: number;
  name?: string;
  dbName?: string;
}

export class LocalAgentService implements IAgentService {
  private core: AgentServiceCore | undefined;

  constructor(private options: LocalAgentServiceOptions) {}

  async init(): Promise<void> {
    const { credential } = this.options;
    const configProvider = new StaticConfigProvider({
      provider: credential.provider,
      model: credential.model ?? '',
      apiKey: credential.apiKey,
      baseURL: credential.baseURL,
      name: this.options.name,
      maxTurns: this.options.maxTurns,
    });

    const storageProvider = new IndexedDBStorageProvider(this.options.dbName ?? 'rem-agent');
    await storageProvider.init();

    const models = createCoreModels({ all: true });

    const templateSelector = new ProviderAwareTemplateSelector(
      new ClaudeAgentPromptTemplate(),
      { openai: new OpenAiAgentPromptTemplate() },
    );
    // instruction loader：浏览器无文件系统，返回空数组的 noop 实现
    const noopInstructionLoader = { load: async () => [] as string[] };
    const systemPromptAssembler = new DefaultSystemPromptAssembler(
      templateSelector,
      [
        new ToolingSection(),
        new ExecutionBiasSection(),
        new SafetySection(),
        new AgentsMdSection(noopInstructionLoader),
        new SkillsSection(new EmptySkillProvider()),
        new WorkspaceSection(),
        new RuntimeSection(),
      ],
    );
    // 注意：section 类名与 AgentsMdSection 的 loader 参数形状以
    // packages/core/src/system-prompt/ 源码为准（先读再写）；
    // 这些类必须从 rem-agent-core/browser 导出（Task 8 Step 1/2 保证）。

    const ctx: AgentContext = await assembleAgentContext({
      configProvider,
      sessionProvider: new BrowserSessionProvider(storageProvider.sessionStore),
      storageProvider,
      systemPromptAssembler, // 如上组装
      models,
      runtime: { platform: 'web', cwd: '/', env: {} },
      mcpManager, // new McpConnectionManager()——若不期望 MCP，可用 { } as 占位或 core 提供 NoopMcpManager
      toolProvider: new StaticToolProvider(this.options.tools ?? []),
      skillProvider: new EmptySkillProvider(),
      compressor: new NoopCompressor(),
      securityMode: 'auto',
    });

    const agentState = new AgentState();
    this.core = new AgentServiceCore({
      ctx,
      agentState,
      sessionManager: new AgentSessionManager(ctx.sessionProvider, agentState),
      workspaceRepository: new IdbWorkspaceRepository(storageProvider.workspaceStore),
    });
  }

  // IAgentService 全方法委托 this.core（未 init 抛 ServiceError('not initialized', 503)）
}
```

注意：`mcpManager` 类型是 core 的 `McpConnectionManager`。若 browser 入口不导出它，在 assembler options 里把 `mcpManager` 改为可选、缺省 `{} as McpConnectionManager`（ctx.mcpManager 仅 Node 路径使用，浏览器 runAgent 不触碰）——回 Task 7/8 同步调整并同 commit。

- [ ] **Step 7: local.ts 入口 + exports**

`packages/bridge/src/local.ts`：

```ts
export { LocalAgentService } from './local/agent-local-service.js';
export type { LocalAgentServiceOptions } from './local/agent-local-service.js';
export { CredentialStore } from './local/credential-store.js';
export type { ProviderCredential } from './local/credential-store.js';
export { IndexedDBStorageProvider } from './local/idb-storage-provider.js';
export type { CustomTool } from 'rem-agent-core/browser';
```

`packages/bridge/package.json` exports 增加：

```json
    "./local": {
      "import": "./dist/local.js",
      "types": "./dist/local.d.ts"
    },
```

注意：`agent-session.ts`、`agent-service-core.ts`、`types.ts` 等 local 依赖的 bridge 内部模块必须不传递引入 Node-only 模块（`workspace-repository-json.ts`/`workspace-repository-sqlite.ts` 不得被 local.ts 链路 import；`agent.ts` 也不能被 local.ts 链路 import，因为它 import `rem-agent-core` 主桶）。检查 `agent-service-core.ts` 的 import 列表，确保只 import 纯模块与类型。

- [ ] **Step 8: 跑测试 + 构建**

Run: `pnpm vitest run packages/bridge/tests && pnpm typecheck && pnpm --filter rem-agent-bridge build`
Expected: 全绿

- [ ] **Step 9: Commit**

```bash
git add packages/bridge packages/core/src/browser.ts packages/core/src/agent-context-assembler.ts
git commit -m "feat(bridge): add LocalAgentService for in-browser agent runs"
```

---

## Phase 3：UI 改造

### Task 15: RemApp/RemChat 改 service 必传 + 三处修复

**Files:**
- Modify: `packages/ui/src/components/rem-app.tsx`
- Modify: `packages/ui/src/components/rem-chat.tsx`
- Modify: `packages/ui/src/components/sidebar/session-item.tsx`
- Modify: `packages/ui/src/components/sidebar/session-list.tsx`（透传）
- Modify: `packages/ui/src/components/sidebar/workspace-sidebar.tsx`（透传）
- Test: `packages/ui/tests/rem-app.test.tsx`（新建或追加）

- [ ] **Step 1: 读透传链**

Run: `sed -n '1,80p' packages/ui/src/components/sidebar/workspace-sidebar.tsx && sed -n '1,60p' packages/ui/src/components/sidebar/session-list.tsx`
确认 sessions 渲染链与 props 名（WorkspaceSidebar → SessionList/SessionSidebar → SessionItem）。

- [ ] **Step 2: rem-app.tsx 改造**

- Props 改：

```ts
export interface RemAppProps {
  service: IAgentService;
  className?: string;
}
```

- 删除 `apiPrefix`/`baseUrl` 与 :19 的 `useMemo(new AgentRemoteService(...))`，`agentService` 直接用 prop；`import { AgentRemoteService } from 'rem-agent-bridge/client'` 改为 `import type { IAgentService } from 'rem-agent-bridge/client'`。
- 新增搜索状态与收口：

```ts
  const [searchResults, setSearchResults] = useState<SessionSummary[] | null>(null);

  const handleSearch = useCallback(async (q: string) => {
    if (!activeWorkspace) return;
    if (q) {
      const results = await agentService.searchSessions(activeWorkspace, q).catch(() => [] as SessionSummary[]);
      setSearchResults(results);
    } else {
      setSearchResults(null);
    }
  }, [agentService, activeWorkspace]);
```

`WorkspaceSidebar` 的 `sessions` prop 传 `(searchResults ?? sessions) as SessionSummary[]`。
- `handleRemoveWorkspace` 改 async，先 `await agentService.removeWorkspace(path).catch(() => {})` 再更本地 state。
- 新增 `handleUpdateSession` 并透传：

```ts
  const handleUpdateSession = useCallback(async (sessionId: string, updates: { title?: string; pinned?: boolean }) => {
    if (!activeWorkspace) return;
    await agentService.updateSession(activeWorkspace, sessionId, updates);
  }, [agentService, activeWorkspace]);
```

- [ ] **Step 3: 透传链加 onUpdateSession**

`workspace-sidebar.tsx` props 加 `onUpdateSession(sessionId: string, updates: { title?: string; pinned?: boolean }): void`，沿渲染链传到 `SessionItem`。

- [ ] **Step 4: session-item.tsx 改走回调**

- 删除文件内 `updateSession` 函数（:32-39，硬编码 `/api` 的 bug）。
- Props 加 `onUpdate(id: string, updates: { title?: string; pinned?: boolean }): void`。
- `handleRename` 中 `updateSession(session.sessionId, workspace, { title: trimmed })` → `onUpdate(session.sessionId, { title: trimmed })`；`handleTogglePin` 同理（失败回滚逻辑保留：`onUpdate` 不抛错时无需 catch，保留 `.catch` 无意义则删除）。`workspace` prop 若不再使用则一并从 props 删除（检查其他用途）。

- [ ] **Step 5: rem-chat.tsx 改造**

Props 改 `{ service: IAgentService; sessionId: string; workspace?: string; className?: string }`，删除内部 `new AgentRemoteService`。

- [ ] **Step 6: 测试**

`packages/ui/tests/rem-app.test.tsx`（参照 ui 已有测试的 jsdom + testing-library 模式）：构造 mock `IAgentService`（listWorkspaces 返回 `[{path:'default'}]`，listSessions 返回 `[]`，stream 返回空 AsyncIterable，其余方法 stub），渲染 `<RemApp service={mock} />`，断言加载完成出现 sidebar；调 `onSearch` 触发 `searchSessions` 被调用。RemChat 同理 smoke。

Run: `pnpm vitest run packages/ui && pnpm typecheck`
Expected: 全绿（web 包暂时 typecheck 失败属预期，Task 17 修）

- [ ] **Step 7: Commit**

```bash
git add packages/ui
git commit -m "feat(ui)!: require service prop on RemApp/RemChat; fix session update and workspace removal"
```

---

### Task 16: RemLocalApp + CredentialSetup

**Files:**
- Create: `packages/ui/src/components/rem-local-app.tsx`
- Create: `packages/ui/src/components/credential-setup.tsx`
- Test: `packages/ui/tests/rem-local-app.test.tsx`（新建）

- [ ] **Step 1: 写失败测试**

`packages/ui/tests/rem-local-app.test.tsx`：mock `rem-agent-bridge/local`（vi.mock），让 `CredentialStore.load()` 返回 null → 渲染 `<RemLocalApp />` 应出现设置表单（provider 选择 + key 输入）；填表单提交后 `CredentialStore.save` 被调且 `LocalAgentService` 被构造。再测 load 返回已有凭据 → 直接渲染 RemApp（mock 组件替身）。

- [ ] **Step 2: 实现 credential-setup.tsx**

`packages/ui/src/components/credential-setup.tsx`：受控表单组件，props `{ initial?: ProviderCredential | null; onSave(c: ProviderCredential): void; onCancel?: () => void }`。字段：provider `<select>`（`anthropic`/`openai`/`openrouter`/`custom`）、apiKey `<input type="password">`、model `<input>`（placeholder 按 provider 给默认，如 anthropic → `claude-sonnet-4-5`）、baseURL `<input>`（仅 custom/openrouter 显示）。样式用现有 tailwind token（bg-card/bd/tx/tx2/ac 等，参照 `add-workspace-dialog.tsx`）。

- [ ] **Step 3: 实现 rem-local-app.tsx**

`packages/ui/src/components/rem-local-app.tsx`：

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { LocalAgentService, CredentialStore } from 'rem-agent-bridge/local';
import type { CustomTool, ProviderCredential } from 'rem-agent-bridge/local';
import { RemApp } from './rem-app';
import { CredentialSetup } from './credential-setup';

export interface RemLocalAppProps {
  tools?: CustomTool[];
  maxTurns?: number;
  className?: string;
}

export function RemLocalApp({ tools, maxTurns, className }: RemLocalAppProps) {
  const [store] = useState(() => new CredentialStore());
  const [credential, setCredential] = useState<ProviderCredential | null>(null);
  const [service, setService] = useState<LocalAgentService | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    store.load().then((c) => {
      setCredential(c);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [store]);

  useEffect(() => {
    if (!credential) {
      setService(null);
      return;
    }
    const svc = new LocalAgentService({ credential, tools, maxTurns });
    let cancelled = false;
    svc.init().then(() => {
      if (!cancelled) {
        setService(svc);
        setError(null);
      }
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    return () => { cancelled = true; };
  }, [credential, tools, maxTurns]);

  const handleSave = useCallback(async (c: ProviderCredential) => {
    await store.save(c);
    setCredential(c);           // 触发 service 重建；agent-bus 单例会自动重连
    setSettingsOpen(false);
  }, [store]);

  if (loading) {
    return <div className="flex h-full items-center justify-center text-tx2 text-sm">Loading...</div>;
  }

  if (!credential || settingsOpen) {
    return (
      <div className="flex h-full items-center justify-center">
        <CredentialSetup initial={credential} onSave={handleSave} onCancel={credential ? () => setSettingsOpen(false) : undefined} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm">
        <p className="text-err">初始化失败：{error}</p>
        <button className="px-3 py-1.5 rounded-btn bg-ac text-white" onClick={() => { setError(null); setCredential({ ...credential }); }}>重试</button>
      </div>
    );
  }

  if (!service) {
    return <div className="flex h-full items-center justify-center text-tx2 text-sm">Loading...</div>;
  }

  return (
    <div className={className ?? 'relative flex h-full'}>
      <RemApp service={service} className="flex h-full flex-1" />
      <button
        aria-label="settings"
        className="absolute top-2 right-2 z-40 p-1.5 rounded-btn text-tx3 hover:text-tx hover:bg-card transition-colors"
        onClick={() => setSettingsOpen(true)}
      >
        ⚙
      </button>
    </div>
  );
}
```

⚙ 换成 lucide-react 的 `Settings` 图标（ui 已有 lucide-react 依赖）。

- [ ] **Step 4: 跑测试**

Run: `pnpm vitest run packages/ui && pnpm --filter rem-agent-ui typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): add RemLocalApp with built-in credential setup"
```

---

### Task 17: UI 导出 + web 包适配

**Files:**
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/web/src/app/page.tsx`

- [ ] **Step 1: ui/index.ts**

```ts
export { RemApp } from './components/rem-app';
export type { RemAppProps } from './components/rem-app';
export { RemChat } from './components/rem-chat';
export type { RemChatProps } from './components/rem-chat';
export { RemLocalApp } from './components/rem-local-app';
export type { RemLocalAppProps } from './components/rem-local-app';
export { AgentRemoteService } from 'rem-agent-bridge/client';
export type { IAgentService } from 'rem-agent-bridge/client';
```

- [ ] **Step 2: web/page.tsx 适配**

```tsx
'use client';

import { useMemo } from 'react';
import { RemApp, AgentRemoteService } from 'rem-agent-ui';

export default function Home() {
  const service = useMemo(() => new AgentRemoteService('', { apiPrefix: '/api/rem' }), []);
  return <RemApp service={service} />;
}
```

检查 web 包内其他 `apiPrefix`/`<RemChat` 使用点（`rg -n "RemChat|apiPrefix" packages/web/src`），同步适配。

- [ ] **Step 3: 全仓验证**

Run: `pnpm typecheck && pnpm test && pnpm --filter rem-agent-ui build && pnpm --filter rem-agent-web build`
Expected: 全绿

- [ ] **Step 4: Commit**

```bash
git add packages/ui packages/web
git commit -m "feat(ui): export RemLocalApp and AgentRemoteService; adapt web to service prop"
```

---

## Phase 4：Demo 包

### Task 18: packages/local-demo scaffold

**Files:**
- Create: `packages/local-demo/package.json`
- Create: `packages/local-demo/vite.config.ts`
- Create: `packages/local-demo/index.html`
- Create: `packages/local-demo/src/main.tsx`
- Create: `packages/local-demo/src/styles.css`
- Create: `packages/local-demo/src/empty-module.ts`
- Create: `packages/local-demo/tsconfig.json`

- [ ] **Step 1: package.json**

```json
{
  "name": "rem-agent-local-demo",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "rem-agent-bridge": "workspace:*",
    "rem-agent-core": "workspace:*",
    "rem-agent-ui": "workspace:*"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "typescript": "^5.4.0",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 2: vite.config.ts（含 Node-only alias stub）**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const stub = fileURLToPath(new URL('./src/empty-module.ts', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@smithy/node-http-handler': stub,
      'http-proxy-agent': stub,
      'https-proxy-agent': stub,
    },
  },
});
```

`src/empty-module.ts`：`export default {}; export const __esModule = true;`

- [ ] **Step 3: index.html / main.tsx / styles.css / tsconfig.json**

`index.html` 标准 Vite 模板（`<div id="root">` + `<script type="module" src="/src/main.tsx">`）。

`src/main.tsx`：

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`src/styles.css`：参照 `packages/web` 的全局样式引入方式（先 `rg -n "rem-agent-ui/styles" packages/web/src` 看 web 怎么引），至少：

```css
@import "tailwindcss";
@import "rem-agent-ui/styles.css";
```

`tsconfig.json`：标准 Vite react-ts 配置（`jsx: react-jsx`、`moduleResolution: bundler`、strict）。

- [ ] **Step 4: install + dev 冒烟（app.tsx 下一任务写，先用占位）**

临时 `src/app.tsx` 返回 `<div>local demo</div>`。

Run: `pnpm install && pnpm --filter rem-agent-local-demo dev`
Expected: Vite 起服务，页面渲染占位文本。Ctrl+C 停掉。

- [ ] **Step 5: Commit**

```bash
git add packages/local-demo pnpm-lock.yaml
git commit -m "feat(local-demo): scaffold Vite static demo package"
```

---

### Task 19: demo 工具 + App 组装

**Files:**
- Create: `packages/local-demo/src/demo-tools.ts`
- Create: `packages/local-demo/src/app.tsx`

- [ ] **Step 1: demo-tools.ts**

两个纯 JS 工具（core `CustomTool` 形态，typebox 参数）：

```ts
import { Type } from '@sinclair/typebox';
import type { CustomTool } from 'rem-agent-bridge/local';

export const calculatorTool: CustomTool = {
  definition: {
    name: 'calculator',
    description: 'Evaluate a JavaScript arithmetic expression like "2 * (3 + 4)".',
    parameters: Type.Object({
      expression: Type.String({ description: 'Arithmetic expression' }),
    }),
    readOnly: true,
  },
  executor: async (input) => {
    const expr = (input as { expression: string }).expression;
    if (!/^[\d\s+\-*/().%]+$/.test(expr)) {
      return { output: 'Error: only arithmetic characters are allowed' };
    }
    try {
      const result = Function(`"use strict"; return (${expr})`)();
      return { output: String(result) };
    } catch (err) {
      return { output: `Error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

export const webFetchTool: CustomTool = {
  definition: {
    name: 'web_fetch',
    description: 'Fetch a URL and return the first 2000 characters of the body (subject to CORS).',
    parameters: Type.Object({
      url: Type.String({ description: 'URL to fetch' }),
    }),
    readOnly: true,
  },
  executor: async (input) => {
    const { url } = input as { url: string };
    try {
      const res = await fetch(url);
      const text = await res.text();
      return { output: text.slice(0, 2000) };
    } catch (err) {
      return { output: `Error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
```

`@sinclair/typebox` 需加进 local-demo dependencies（`pnpm --filter rem-agent-local-demo add @sinclair/typebox`）。

- [ ] **Step 2: app.tsx**

```tsx
import { RemLocalApp } from 'rem-agent-ui';
import { calculatorTool, webFetchTool } from './demo-tools';

export function App() {
  return (
    <div className="h-screen">
      <RemLocalApp tools={[calculatorTool, webFetchTool]} maxTurns={20} />
    </div>
  );
}
```

- [ ] **Step 3: 构建验证**

Run: `pnpm --filter rem-agent-local-demo build`
Expected: 构建成功。检查 dist 产物中无 `node:fs` 等残留（`rg -n "node:fs|better-sqlite3" packages/local-demo/dist` 无命中；pi-ai 的 `typeof process` 守卫保留属正常）。

- [ ] **Step 4: dev 手动验证清单**

Run: `pnpm --filter rem-agent-local-demo dev`
手动过一遍：
1. 首屏出现凭据设置表单；填 anthropic key + model 保存。
2. 进入主界面，发一条消息能收到流式回复。
3. 问 "用 calculator 算 123*456"，确认工具被调用并渲染 tool call。
4. 刷新页面 → 会话仍在（IndexedDB），凭据无需重填。
5. 点 ⚙ 改 key → service 重建正常。
6. rename/pin/搜索/workspace 增删正常（验证 Task 15 的三处修复在 local 模式生效）。

- [ ] **Step 5: Commit**

```bash
git add packages/local-demo
git commit -m "feat(local-demo): add demo tools and app assembly"
```

---

## Phase 5：全量验证

### Task 20: 回归 + 文档同步

**Files:**
- Modify: `AGENTS.md`（常用入口/项目结构补 local-demo 与 bridge/local）
- Modify: `packages/core/src/browser.ts` 等（如验证中发现遗漏）

- [ ] **Step 1: 全量回归**

Run: `pnpm typecheck && pnpm test`
Expected: 全绿

- [ ] **Step 2: 全量构建**

Run: `pnpm --filter rem-agent-core build && pnpm --filter rem-agent-bridge build && pnpm --filter rem-agent-ui build && pnpm --filter rem-agent-web build && pnpm --filter rem-agent-local-demo build`
Expected: 全部成功

- [ ] **Step 3: web remote demo 手动回归**

Run: `pnpm --filter rem-agent-web dev`
过一遍：会话列表/发送/中断/rename/pin/搜索/workspace 增删。

- [ ] **Step 4: AGENTS.md 同步**

在项目结构加 `local-demo/ — rem-agent-local-demo：纯前端 Vite demo（浏览器内跑 Agent）`；常用入口表加 `packages/bridge/src/local/agent-local-service.ts — LocalAgentService（浏览器内 AgentService）` 与 `packages/ui/src/components/rem-local-app.tsx — <RemLocalApp /> 纯前端聊天应用（内置 key 设置）`。

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md
git commit -m "docs: add local-demo and bridge/local to project docs"
```
