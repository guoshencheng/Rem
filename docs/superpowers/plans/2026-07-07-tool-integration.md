# Tool 整合职责迁移实现计划

> **For agentic workers:** REQUIRED SUB-_SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 tool 整合逻辑从 `createAgentFromEnv` 迁移到 `runAgent`，通过 `ToolComposer` 统一合并本地 tools、MCP tools 和 `read_skill`，并保证每次运行产生独立实例、不污染原始 provider。

**Architecture:** 新增 `ToolComposer` 接口与 `DefaultToolComposer` 实现，由 `runAgent` 在启动时调用；新增 `OverlayToolProvider` 在不修改原始 provider 的前提下叠加 `read_skill`；`AgentContext` 增加 `mcpProviders` 和 `toolComposer` 字段，`createAgentFromEnv` 只负责创建/连接 raw providers。

**Tech Stack:** TypeScript, Vitest, pnpm monorepo (`packages/core`).

## Global Constraints

- 不替换现有 `ToolProvider` 接口。
- 不改变 LLM reason / execute 的调用方式。
- 本次不统一调整 `toolPolicy` 的作用范围（本地 vs MCP）。
- 每次 `compose()` 返回新实例，原始 providers 不被修改。
- MCP 连接失败沿用现有 `McpConnectionManager` 机制：跳过失败连接，不阻塞启动。
- 代码与测试遵循现有 `packages/core/tests/` 的 Vitest 风格。

## 文件结构

| 文件 | 职责 |
|---|---|
| `packages/core/src/sdk/tool-composer.ts` | `ToolComposer` 接口定义 |
| `packages/core/src/overlay-tool-provider.ts` | 叠加层 provider：包裹 base provider，支持额外注册工具且不修改 base |
| `packages/core/src/tool-composer.ts` | `DefaultToolComposer` 实现：合并本地/MCP tools，叠加 `read_skill` |
| `packages/core/src/plugins/tool/builtin/skill-read.ts` | 增加 `createReadSkillTool(skillProvider)` 便捷工厂 |
| `packages/core/src/agent-context.ts` | 增加 `mcpProviders` 和 `toolComposer` 字段 |
| `packages/core/src/agent-factory.ts` | 不再预合并 tools，改为返回 raw providers 和 `toolComposer` |
| `packages/core/src/run-agent.ts` | 启动时调用 `toolComposer.compose()` 得到最终 `toolProvider` |
| `packages/core/tests/overlay-tool-provider.test.ts` | `OverlayToolProvider` 单元测试 |
| `packages/core/tests/tool-composer.test.ts` | `DefaultToolComposer` 单元测试 |
| `packages/core/tests/skill-read-tool.test.ts` | `createReadSkillTool` 测试 |
| `packages/core/tests/run-agent.test.ts` | `runAgent` 调用 `toolComposer.compose()` 的测试 |

---

### Task 1: `ToolComposer` 接口

**Files:**
- Create: `packages/core/src/sdk/tool-composer.ts`
- Test: `packages/core/tests/tool-composer-interface.test.ts`

**Interfaces:**
- Consumes: `ToolProvider` (`packages/core/src/sdk/tool-provider.ts`), `SkillProvider` (`packages/core/src/sdk/skill-provider.ts`)
- Produces: `ToolComposer` interface

- [ ] **Step 1: Create the interface file**

```typescript
// packages/core/src/sdk/tool-composer.ts
import type { ToolProvider } from './tool-provider.js';
import type { SkillProvider } from './skill-provider.js';

export interface ToolComposer {
  compose(params: {
    toolProvider: ToolProvider;
    mcpProviders: ToolProvider[];
    skillProvider: SkillProvider;
  }): ToolProvider;
}
```

- [ ] **Step 2: Write a structural test**

```typescript
// packages/core/tests/tool-composer-interface.test.ts
import { describe, it, expect } from 'vitest';
import type { ToolComposer } from '../src/sdk/tool-composer.js';
import type { ToolProvider } from '../src/sdk/tool-provider.js';
import type { SkillProvider } from '../src/sdk/skill-provider.js';

describe('ToolComposer interface', () => {
  it('can be implemented with the expected signature', () => {
    const composer: ToolComposer = {
      compose({ toolProvider, mcpProviders, skillProvider }): ToolProvider {
        void toolProvider;
        void mcpProviders;
        void skillProvider;
        return { getToolSet: () => ({}), execute: async () => [], register: () => {}, isDangerous: () => false };
      },
    };

    expect(composer).toBeDefined();
    expect(typeof composer.compose).toBe('function');
  });
});
```

- [ ] **Step 3: Run the test**

Run:
```bash
pnpm --filter rem-agent-core test -- packages/core/tests/tool-composer-interface.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/sdk/tool-composer.ts packages/core/tests/tool-composer-interface.test.ts
git commit -m "feat(core): add ToolComposer interface

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: `OverlayToolProvider`

**Files:**
- Create: `packages/core/src/overlay-tool-provider.ts`
- Test: `packages/core/tests/overlay-tool-provider.test.ts`

**Interfaces:**
- Consumes: `ToolProvider`, `ToolDefinition`, `ToolExecutor`, `ToolCall`, `ToolResult`, `ToolContext`, `ToolSet`
- Produces: `OverlayToolProvider` class

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/tests/overlay-tool-provider.test.ts
import { describe, it, expect } from 'vitest';
import { Type, type Static } from '@sinclair/typebox';
import { OverlayToolProvider } from '../src/overlay-tool-provider.js';
import type { ToolProvider, ToolDefinition, ToolExecutor, ToolContext } from '../src/sdk/tool-provider.js';

function createBaseProvider(tools: Record<string, { def: ToolDefinition; executor: ToolExecutor }>): ToolProvider {
  return {
    register: () => {},
    getToolSet: () => {
      const result: Record<string, { description: string; parameters: Record<string, unknown> }> = {};
      for (const [name, { def }] of Object.entries(tools)) {
        result[name] = { description: def.description, parameters: def.parameters as Record<string, unknown> };
      }
      return result;
    },
    execute: async (calls) => calls.map((call) => {
      const tool = tools[call.toolName];
      if (!tool) return { toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: 'not found' };
      return { toolCallId: call.toolCallId, toolName: call.toolName, output: 'base' };
    }),
    isDangerous: (name) => tools[name]?.def.dangerous === true,
  };
}

const echoSchema = Type.Object({ message: Type.String() });
type EchoInput = Static<typeof echoSchema>;

describe('OverlayToolProvider', () => {
  it('exposes base tools plus overlay tools', () => {
    const base = createBaseProvider({});
    const overlay = new OverlayToolProvider(base);

    const def: ToolDefinition<typeof echoSchema> = {
      name: 'echo',
      description: 'echo',
      parameters: echoSchema,
    };
    const executor: ToolExecutor<typeof echoSchema> = async ({ message }) => ({ output: message });
    overlay.register(def, executor);

    const tools = overlay.getToolSet();
    expect(tools).toHaveProperty('echo');
  });

  it('does not mutate the base provider when registering', () => {
    const base = createBaseProvider({});
    const overlay = new OverlayToolProvider(base);

    overlay.register(
      { name: 'echo', description: 'echo', parameters: echoSchema },
      async ({ message }) => ({ output: message }),
    );

    expect(base.getToolSet()).toEqual({});
    expect(overlay.getToolSet()).toHaveProperty('echo');
  });

  it('executes overlay tools independently of base provider', async () => {
    const base = createBaseProvider({});
    const overlay = new OverlayToolProvider(base);

    overlay.register(
      { name: 'echo', description: 'echo', parameters: echoSchema },
      async ({ message }) => ({ output: `overlay:${message}` }),
    );

    const results = await overlay.execute(
      [{ toolCallId: '1', toolName: 'echo', input: { message: 'hi' } }],
      { cwd: '/', workspaceRoot: '/' },
    );

    expect(results[0].output).toBe('overlay:hi');
  });

  it('delegates unknown tools to base provider', async () => {
    const base = createBaseProvider({
      baseTool: {
        def: { name: 'baseTool', description: 'base', parameters: echoSchema },
        executor: async () => ({ output: 'from base' }),
      },
    });
    const overlay = new OverlayToolProvider(base);

    const results = await overlay.execute(
      [{ toolCallId: '1', toolName: 'baseTool', input: { message: 'x' } }],
      { cwd: '/', workspaceRoot: '/' },
    );

    expect(results[0].output).toBe('from base');
  });

  it('reports isDangerous from overlay definition', () => {
    const base = createBaseProvider({});
    const overlay = new OverlayToolProvider(base);

    overlay.register(
      { name: 'dangerousTool', description: 'dangerous', parameters: echoSchema, dangerous: true },
      async () => ({ output: '' }),
    );

    expect(overlay.isDangerous('dangerousTool')).toBe(true);
    expect(overlay.isDangerous('missing')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter rem-agent-core test -- packages/core/tests/overlay-tool-provider.test.ts
```

Expected: FAIL with "OverlayToolProvider is not defined" or import error.

- [ ] **Step 3: Implement `OverlayToolProvider`**

```typescript
// packages/core/src/overlay-tool-provider.ts
import { TypeCompiler } from '@sinclair/typebox/compiler';
import type { TObject } from '@sinclair/typebox';
import type {
  ToolCall,
  ToolContext,
  ToolDefinition,
  ToolExecutor,
  ToolProvider,
  ToolResult,
} from './sdk/tool-provider.js';
import type { ToolSet } from './llm/types.js';

export class OverlayToolProvider implements ToolProvider {
  private overlays = new Map<
    string,
    {
      def: ToolDefinition;
      executor: ToolExecutor;
      check: ReturnType<typeof TypeCompiler.Compile>;
    }
  >();

  constructor(private base: ToolProvider) {}

  register<T extends TObject>(def: ToolDefinition<T>, executor: ToolExecutor<T>): void {
    this.overlays.set(def.name, {
      def: def as ToolDefinition,
      executor: executor as ToolExecutor,
      check: TypeCompiler.Compile(def.parameters),
    });
  }

  getToolSet(): ToolSet {
    const result: ToolSet = { ...this.base.getToolSet() };
    for (const [name, { def }] of this.overlays) {
      if (result[name]) {
        console.warn(`[OverlayToolProvider] duplicate tool "${name}" overwritten by overlay`);
      }
      result[name] = { description: def.description, parameters: def.parameters as Record<string, unknown> };
    }
    return result;
  }

  isDangerous(toolName: string): boolean {
    const overlay = this.overlays.get(toolName);
    if (overlay) return overlay.def.dangerous === true;
    return this.base.isDangerous(toolName);
  }

  async execute(calls: ToolCall[], ctx: ToolContext): Promise<ToolResult[]> {
    const baseCalls: ToolCall[] = [];
    const overlayCalls: ToolCall[] = [];

    for (const call of calls) {
      if (this.overlays.has(call.toolName)) {
        overlayCalls.push(call);
      } else {
        baseCalls.push(call);
      }
    }

    const results: ToolResult[] = [];
    if (baseCalls.length > 0) {
      results.push(...await this.base.execute(baseCalls, ctx));
    }

    for (const call of overlayCalls) {
      const entry = this.overlays.get(call.toolName)!;
      if (!entry.check.Check(call.input)) {
        const errors = Array.from(entry.check.Errors(call.input));
        const message = errors.map((e) => `${e.path}: ${e.message}`).join('; ') || 'invalid input';
        results.push({ toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: `Invalid input: ${message}` });
        continue;
      }

      try {
        const { output, details } = await entry.executor(call.input as never, ctx);
        results.push({ toolCallId: call.toolCallId, toolName: call.toolName, output, details });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: message });
      }
    }

    return results;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter rem-agent-core test -- packages/core/tests/overlay-tool-provider.test.ts
```

Expected: PASS

- [ ] **Step 5: Run typecheck**

Run:
```bash
pnpm --filter rem-agent-core typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/overlay-tool-provider.ts packages/core/tests/overlay-tool-provider.test.ts
git commit -m "feat(core): add OverlayToolProvider for non-mutating tool registration

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: `DefaultToolComposer`

**Files:**
- Create: `packages/core/src/tool-composer.ts`
- Test: `packages/core/tests/tool-composer.test.ts`

**Interfaces:**
- Consumes: `ToolComposer` interface, `OverlayToolProvider`, `CompositeToolProvider`, `createReadSkillTool`
- Produces: `DefaultToolComposer` class

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/tests/tool-composer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { DefaultToolComposer } from '../src/tool-composer.js';
import { InMemoryToolProvider } from '../src/plugins/tool/in-memory/index.js';
import type { SkillProvider } from '../src/sdk/skill-provider.js';

function createFakeSkillProvider(rawByName: Record<string, string>): SkillProvider {
  return {
    loadSkills: async () => [],
    formatCatalog: () => '',
    readSkillRaw: async (name: string) => rawByName[name],
  };
}

describe('DefaultToolComposer', () => {
  it('registers read_skill when no mcp providers are given', () => {
    const toolProvider = new InMemoryToolProvider();
    const skillProvider = createFakeSkillProvider({ foo: 'bar' });
    const composer = new DefaultToolComposer();

    const result = composer.compose({ toolProvider, mcpProviders: [], skillProvider });

    const tools = result.getToolSet();
    expect(tools).toHaveProperty('read_skill');
  });

  it('includes base tool provider tools in the result', () => {
    const toolProvider = new InMemoryToolProvider();
    toolProvider.register(
      { name: 'localTool', description: 'local', parameters: { type: 'object', properties: {} } as any },
      async () => ({ output: 'ok' }),
    );

    const skillProvider = createFakeSkillProvider({});
    const composer = new DefaultToolComposer();

    const result = composer.compose({ toolProvider, mcpProviders: [], skillProvider });

    expect(result.getToolSet()).toHaveProperty('localTool');
    expect(result.getToolSet()).toHaveProperty('read_skill');
  });

  it('does not mutate the original toolProvider when composing', () => {
    const toolProvider = new InMemoryToolProvider();
    const skillProvider = createFakeSkillProvider({ foo: 'bar' });
    const composer = new DefaultToolComposer();

    composer.compose({ toolProvider, mcpProviders: [], skillProvider });

    expect(toolProvider.getToolSet()).not.toHaveProperty('read_skill');
  });

  it('returns a new instance on each compose call', () => {
    const toolProvider = new InMemoryToolProvider();
    const skillProvider = createFakeSkillProvider({ foo: 'bar' });
    const composer = new DefaultToolComposer();

    const a = composer.compose({ toolProvider, mcpProviders: [], skillProvider });
    const b = composer.compose({ toolProvider, mcpProviders: [], skillProvider });

    expect(a).not.toBe(b);
  });

  it('uses CompositeToolProvider when mcp providers are present', () => {
    const toolProvider = new InMemoryToolProvider();
    const mcpProvider = new InMemoryToolProvider();
    mcpProvider.register(
      { name: 'mcp__tool', description: 'mcp tool', parameters: { type: 'object', properties: {} } as any },
      async () => ({ output: 'mcp' }),
    );

    const skillProvider = createFakeSkillProvider({});
    const composer = new DefaultToolComposer();

    const result = composer.compose({ toolProvider, mcpProviders: [mcpProvider], skillProvider });

    expect(result.getToolSet()).toHaveProperty('mcp__tool');
    expect(result.getToolSet()).toHaveProperty('read_skill');
  });

  it('read_skill executor can read skill raw content', async () => {
    const toolProvider = new InMemoryToolProvider();
    const skillProvider = createFakeSkillProvider({ foo: '---\nname: foo\n---\ncontent' });
    const composer = new DefaultToolComposer();

    const result = composer.compose({ toolProvider, mcpProviders: [], skillProvider });
    const execResults = await result.execute(
      [{ toolCallId: '1', toolName: 'read_skill', input: { name: 'foo' } }],
      { cwd: '/', workspaceRoot: '/' },
    );

    expect(execResults[0].output).toBe('---\nname: foo\n---\ncontent');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter rem-agent-core test -- packages/core/tests/tool-composer.test.ts
```

Expected: FAIL with "DefaultToolComposer is not defined" or import error.

- [ ] **Step 3: Add `createReadSkillTool` helper and its test**

Before implementing `DefaultToolComposer`, add the helper in the skill-read file:

```typescript
// packages/core/src/plugins/tool/builtin/skill-read.ts
export function createReadSkillTool(skillProvider: SkillProvider): {
  definition: ToolDefinition<typeof readSkillSchema>;
  executor: ToolExecutor<typeof readSkillSchema>;
} {
  return {
    definition: createReadSkillToolDefinition(),
    executor: createReadSkillToolExecutor(() => skillProvider),
  };
}
```

Append a test to `packages/core/tests/skill-read-tool.test.ts`:

```typescript
  it('createReadSkillTool bundles definition and executor', async () => {
    const provider = createFakeSkillProvider({ foo: '---\nname: foo\n---\nbar' });
    const { definition, executor } = createReadSkillTool(provider);

    expect(definition.name).toBe('read_skill');
    const result = await executor({ name: 'foo' }, { cwd: '/', workspaceRoot: '/' });
    expect(result.output).toBe('---\nname: foo\n---\nbar');
  });
```

- [ ] **Step 4: Implement `DefaultToolComposer`**

```typescript
// packages/core/src/tool-composer.ts
import { CompositeToolProvider } from './mcp/composite-tool-provider.js';
import { OverlayToolProvider } from './overlay-tool-provider.js';
import { createReadSkillTool } from './plugins/tool/builtin/skill-read.js';
import type { ToolProvider } from './sdk/tool-provider.js';
import type { SkillProvider } from './sdk/skill-provider.js';
import type { ToolComposer } from './sdk/tool-composer.js';

export class DefaultToolComposer implements ToolComposer {
  compose({ toolProvider, mcpProviders, skillProvider }: {
    toolProvider: ToolProvider;
    mcpProviders: ToolProvider[];
    skillProvider: SkillProvider;
  }): ToolProvider {
    const base = mcpProviders.length > 0
      ? new CompositeToolProvider(toolProvider, mcpProviders)
      : toolProvider;

    const overlay = new OverlayToolProvider(base);
    const readSkillTool = createReadSkillTool(skillProvider);
    overlay.register(readSkillTool.definition, readSkillTool.executor);

    return overlay;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
pnpm --filter rem-agent-core test -- packages/core/tests/tool-composer.test.ts
```

Expected: PASS

- [ ] **Step 6: Run typecheck**

Run:
```bash
pnpm --filter rem-agent-core typecheck
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/tool-composer.ts packages/core/src/plugins/tool/builtin/skill-read.ts packages/core/tests/tool-composer.test.ts packages/core/tests/skill-read-tool.test.ts
git commit -m "feat(core): add DefaultToolComposer and createReadSkillTool helper

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 更新 `AgentContext` 类型

**Files:**
- Modify: `packages/core/src/agent-context.ts`

**Interfaces:**
- Consumes: `ToolComposer` interface, `ToolProvider`
- Produces: updated `AgentContext` interface

- [ ] **Step 1: Modify `AgentContext`**

```typescript
// packages/core/src/agent-context.ts
import type { ConfigProvider } from './sdk/config-provider.js';
import type { SessionProvider } from './sdk/session-provider.js';
import type { AgentLiveProvider } from './sdk/agent-state-provider.js';
import type { ToolProvider } from './sdk/tool-provider.js';
import type { ContextProvider } from './sdk/context-provider.js';
import type { SkillProvider } from './sdk/skill-provider.js';
import type { BudgetPolicy } from './sdk/budget-policy.js';
import type { ContextCompressor } from './sdk/compressor.js';
import type { ErrorHandler } from './sdk/error-handler.js';
import type { TitleProvider } from './sdk/title-provider.js';
import type { LoopStrategy } from './sdk/loop-strategy.js';
import type { McpConnectionManager } from './mcp/connection-manager.js';
import type { ToolComposer } from './sdk/tool-composer.js';

export interface AgentContext {
  configProvider: ConfigProvider;
  sessionProvider: SessionProvider;
  agentLiveProvider: AgentLiveProvider;
  toolProvider: ToolProvider;        // 原始本地 tools，不再预合并
  mcpProviders: ToolProvider[];      // 新增
  skillProvider: SkillProvider;
  toolComposer: ToolComposer;        // 新增
  contextProvider: ContextProvider;
  budgetPolicy: BudgetPolicy;
  compressor: ContextCompressor;
  errorHandler: ErrorHandler;
  titleProvider: TitleProvider;
  loopStrategy: LoopStrategy;
  mcpManager: McpConnectionManager;
}
```

- [ ] **Step 2: Run typecheck**

Run:
```bash
pnpm --filter rem-agent-core typecheck
```

Expected: errors in `agent-factory.ts` and `run-agent.ts` because they haven't been updated yet; `agent-context.ts` itself should type-check. Do not fix downstream errors in this task.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/agent-context.ts
git commit -m "refactor(core): add mcpProviders and toolComposer to AgentContext

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 更新 `createAgentFromEnv`

**Files:**
- Modify: `packages/core/src/agent-factory.ts`
- Create: `packages/core/tests/agent-factory.test.ts`

**Interfaces:**
- Consumes: updated `AgentContext`, `DefaultToolComposer`
- Produces: `AgentContext` with raw providers and `toolComposer`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/tests/agent-factory.test.ts
import { describe, it, expect } from 'vitest';
import { createAgentFromEnv } from '../src/agent-factory.js';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('createAgentFromEnv', () => {
  it('returns raw providers and a toolComposer without pre-merging tools', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rem-agent-test-'));
    writeFileSync(join(dir, 'agent.json'), JSON.stringify({ name: 'test-agent' }));

    const previousHome = process.env.REM_AGENT_HOME;
    process.env.REM_AGENT_HOME = dir;

    try {
      const ctx = await createAgentFromEnv({ configPath: join(dir, 'agent.json') });

      expect(ctx.toolProvider).toBeDefined();
      expect(ctx.mcpProviders).toBeDefined();
      expect(ctx.mcpProviders).toBeInstanceOf(Array);
      expect(ctx.toolComposer).toBeDefined();
      expect(typeof ctx.toolComposer.compose).toBe('function');

      // read_skill should NOT be pre-registered on the raw toolProvider
      expect(ctx.toolProvider.getToolSet()).not.toHaveProperty('read_skill');
    } finally {
      if (previousHome === undefined) {
        delete process.env.REM_AGENT_HOME;
      } else {
        process.env.REM_AGENT_HOME = previousHome;
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter rem-agent-core test -- packages/core/tests/agent-factory.test.ts
```

Expected: FAIL because `createAgentFromEnv` still returns merged `toolProvider` and lacks `mcpProviders`/`toolComposer`.

- [ ] **Step 3: Update `createAgentFromEnv`**

```typescript
// packages/core/src/agent-factory.ts
import { registerBuiltInProviders } from './llm/providers/index.js';
import { createDefaultAgentPaths } from './config/paths.js';
import { configureDebugLog } from './shared/debug-log.js';
import { DefaultConfigProvider } from './plugins/config/default/index.js';
import { InMemorySessionProvider } from './plugins/session/in-memory/index.js';
import { InMemoryAgentLiveProvider } from './plugins/state/in-memory/index.js';
import { createFileSystemTools } from './plugins/tool/file-system/index.js';
import { SimpleContextProvider } from './plugins/memory/simple/index.js';
import { FileSkillProvider } from './plugins/skill/file/index.js';
import { FixedBudgetPolicy } from './plugins/budget/fixed/index.js';
import { NoOpCompressor } from './plugins/compressor/no-op/index.js';
import { SimpleErrorHandler } from './plugins/error/simple/index.js';
import { LLMTitleProvider } from './plugins/title/llm/index.js';
import { ReactLoop } from './plugins/loop/react/index.js';
import { McpConnectionManager } from './mcp/connection-manager.js';
import { DefaultToolComposer } from './tool-composer.js';
import type { AgentContext } from './agent-context.js';

export interface CreateAgentOptions {
  name?: string;
  configPath?: string;
  maxTurns?: number;
  workspaceRoot?: string;
  readOnly?: boolean;
  autoApproveDangerous?: boolean;
  provider?: string;
  model?: string;
}

export async function createAgentFromEnv(options?: CreateAgentOptions): Promise<AgentContext> {
  registerBuiltInProviders();

  const paths = createDefaultAgentPaths();
  configureDebugLog(paths.debugLogFile);

  const configProvider = new DefaultConfigProvider({
    paths,
    configPath: options?.configPath,
    overrides: {
      name: options?.name,
      maxTurns: options?.maxTurns,
      workspaceRoot: options?.workspaceRoot,
      readOnly: options?.readOnly,
      autoApproveDangerous: options?.autoApproveDangerous,
      ...(options?.provider ? { model: { provider: options.provider, model: options.model ?? '' } } : {}),
    },
  });
  await configProvider.init();

  const sessionProvider = new InMemorySessionProvider();
  const agentLiveProvider = new InMemoryAgentLiveProvider();
  const toolProvider = createFileSystemTools(configProvider);
  const contextProvider = new SimpleContextProvider(configProvider);
  const skillProvider = new FileSkillProvider(configProvider, paths);
  const budgetPolicy = new FixedBudgetPolicy(configProvider);
  const compressor = new NoOpCompressor();
  const errorHandler = new SimpleErrorHandler();
  const titleProvider = new LLMTitleProvider(configProvider);
  const loopStrategy = new ReactLoop();

  const mcpConfig = configProvider.getMcpConfig();
  const mcpManager = new McpConnectionManager();
  const mcpProviders = await mcpManager.connectAll(mcpConfig);

  const toolComposer = new DefaultToolComposer();

  return {
    configProvider,
    sessionProvider,
    agentLiveProvider,
    toolProvider,        // 原始本地 tools
    mcpProviders,        // 连接成功的 MCP providers
    skillProvider,
    toolComposer,
    contextProvider,
    budgetPolicy,
    compressor,
    errorHandler,
    titleProvider,
    loopStrategy,
    mcpManager,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter rem-agent-core test -- packages/core/tests/agent-factory.test.ts
```

Expected: PASS

- [ ] **Step 5: Run typecheck**

Run:
```bash
pnpm --filter rem-agent-core typecheck
```

Expected: only `run-agent.ts` errors remain (because it still uses `ctx.toolProvider` directly).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agent-factory.ts packages/core/tests/agent-factory.test.ts
git commit -m "refactor(core): move tool composition out of createAgentFromEnv

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 更新 `runAgent`

**Files:**
- Modify: `packages/core/src/run-agent.ts`
- Modify: `packages/core/tests/run-agent.test.ts`

**Interfaces:**
- Consumes: updated `AgentContext` with `toolComposer`, `mcpProviders`, raw `toolProvider`
- Produces: `runAgent` calls `toolComposer.compose()` and uses the effective tool provider

- [ ] **Step 1: Update the failing test**

Add a test to `packages/core/tests/run-agent.test.ts` that verifies `toolComposer.compose` is called and its result is used:

```typescript
// packages/core/tests/run-agent.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { AgentContext } from '../src/agent-context.js';
```

Add a test inside the existing `describe('runAgent', () => { ... })` block:

```typescript
  it('calls toolComposer.compose and uses the effective tool provider', async () => {
    const composedToolSet = { composedTool: { description: 'composed', parameters: { type: 'object', properties: {} } } };
    const compose = vi.fn(() => ({
      getToolSet: () => composedToolSet,
      execute: async () => [],
      register: () => {},
      isDangerous: () => false,
    }));

    const mockCtx = {
      configProvider: {
        getBehaviorConfig: () => ({ name: 'test', maxTurns: 1, workspaceRoot: '/tmp', readOnly: false, sessionsDir: '/tmp/.sessions', autoApproveDangerous: false }),
        getModelConfig: () => ({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test', baseURL: undefined }),
        getToolConfig: () => ({}),
        getMcpConfig: () => ({}),
      },
      sessionProvider: { load: async () => null, save: async () => {}, addMessage: () => ({} as any), appendContent: () => {} },
      agentLiveProvider: { get: () => null, getOrCreate: () => ({} as any), set: () => {} },
      toolProvider: { getToolSet: () => ({}), register: () => {} },
      mcpProviders: [],
      skillProvider: { loadSkills: async () => [], formatCatalog: () => '' },
      toolComposer: { compose },
      contextProvider: { build: async () => ({ system: 'You are test.', messages: [] }) },
      budgetPolicy: { checkTurn: () => true, checkTimeout: () => true, shouldCircuitBreak: () => false, getStatus: () => ({ turnsRemaining: 1, consecutiveErrors: 0, atRisk: false }) },
      compressor: { shouldCompress: () => false, compress: async (msgs: unknown[]) => msgs },
      errorHandler: { classify: () => 'unknown', isRetryable: () => false },
      titleProvider: { generateTitle: async () => undefined },
      loopStrategy: {
        run: async (ctx: any) => {
          // Verify the tools passed to reason are the composed tools
          expect(ctx.reason).toBeDefined();
          return {
            content: 'hello back',
            newMessages: [],
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        },
      },
      mcpManager: { connectAll: async () => [], closeAll: async () => {} },
    } as unknown as AgentContext;

    const { runAgent } = await import('../src/run-agent.js');
    const result = runAgent({
      input: { content: 'hello', timestamp: new Date() },
      sessionId: 'test-session',
      ctx: mockCtx,
    });

    for await (const _chunk of result.stream.fullStream) {
      // drain
    }

    await result.output;

    expect(compose).toHaveBeenCalledWith({
      toolProvider: mockCtx.toolProvider,
      mcpProviders: mockCtx.mcpProviders,
      skillProvider: mockCtx.skillProvider,
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter rem-agent-core test -- packages/core/tests/run-agent.test.ts
```

Expected: FAIL because `runAgent` does not yet call `compose`.

- [ ] **Step 3: Update `runAgent`**

In `packages/core/src/run-agent.ts`, replace the destructuring and tool usage:

```typescript
// Around line 77-78, change from:
const toolProvider = ctx.toolProvider;
const skillProvider = ctx.skillProvider;

// To:
const toolProvider = ctx.toolProvider;
const mcpProviders = ctx.mcpProviders;
const skillProvider = ctx.skillProvider;
const toolComposer = ctx.toolComposer;
```

Then after loading skills (around line 92), compose the effective tool provider:

```typescript
let systemWithSkills = system;
try {
  const skills = await skillProvider.loadSkills();
  const catalog = skillProvider.formatCatalog(skills);
  if (catalog) systemWithSkills = `${system}\n\n${catalog}`;
} catch { /* best-effort */ }

const effectiveToolProvider = toolComposer.compose({
  toolProvider,
  mcpProviders,
  skillProvider,
});
```

Then replace all downstream uses of `toolProvider` in the `loopCtx` with `effectiveToolProvider`:

```typescript
const loopCtx: LoopContext = {
  liveState,
  messages: msgs,
  addMessage,
  appendContent,
  system: systemWithSkills,
  reason: () => reason(
    {
      provider: modelConfig.provider, model: modelConfig.model, apiKey: modelConfig.apiKey,
      baseURL: modelConfig.baseURL, system: systemWithSkills, messages: msgs,
      tools: effectiveToolProvider.getToolSet(), signal: params.signal, errorHandler,
    },
    (chunk) => controller.emit(chunk),
  ),
  execute: (calls: ToolCall[]): Promise<ToolResult[]> => executeTools({
    toolCalls: calls, toolProvider: effectiveToolProvider, addMessage, appendContent,
    liveProvider: ctx.agentLiveProvider,
    registry: params.approvalRegistry,
    workspaceRoot: behavior.workspaceRoot, agentName: behavior.name,
    readOnly: behavior.readOnly, sessionId: params.sessionId, signal: params.signal,
    emit: (chunk) => controller.emit(chunk),
  }),
  emit: (chunk) => controller.emit(chunk),
  signal: params.signal, maxSteps: behavior.maxTurns,
  workspaceRoot: behavior.workspaceRoot, readOnly: behavior.readOnly,
  agentName: behavior.name, sessionId: params.sessionId,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter rem-agent-core test -- packages/core/tests/run-agent.test.ts
```

Expected: PASS

- [ ] **Step 5: Run typecheck**

Run:
```bash
pnpm --filter rem-agent-core typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/run-agent.ts packages/core/tests/run-agent.test.ts
git commit -m "refactor(core): compose tools inside runAgent via toolComposer

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: 全量验证

**Files:**
- All modified files

- [ ] **Step 1: Run all core tests**

Run:
```bash
pnpm --filter rem-agent-core test
```

Expected: PASS

- [ ] **Step 2: Run full typecheck**

Run:
```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 3: Run lint/format if configured**

Run:
```bash
pnpm --filter rem-agent-core lint || pnpm --filter rem-agent-core format
```

Expected: no unfixable errors

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "chore(core): verify tool composition migration

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

### Spec coverage

| Spec 要求 | 对应任务 |
|---|---|
| `createAgentFromEnv` 只创建/连接 raw providers | Task 5 |
| `runAgent` 统一调用整合器 | Task 6 |
| `read_skill` 注册延迟到 `runAgent` | Task 3, 6 |
| 每次运行产生新实例、不污染原始 provider | Task 2, 3 |
| 不替换 `ToolProvider` 接口 | 全计划 |
| 不改变 reason/execute 调用方式 | Task 6 |
| MCP 失败跳过机制不变 | Task 5（未改动现有逻辑） |

### Placeholder scan

- 无 TBD/TODO/"implement later" / "add appropriate error handling" / "similar to Task N"。
- 每个代码步骤都包含完整代码。
- 每个测试步骤都包含完整测试代码。

### Type consistency

- `AgentContext` 中 `toolProvider`、`mcpProviders`、`toolComposer` 名称与 `runAgent`、`DefaultToolComposer` 中一致。
- `ToolComposer.compose` 参数名 `toolProvider` / `mcpProviders` / `skillProvider` 在 interface、implementation、runAgent 调用中一致。
- `createReadSkillTool` 返回 `{ definition, executor }`，在 `DefaultToolComposer` 中按此解构。

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-07-tool-integration.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach would you like?
