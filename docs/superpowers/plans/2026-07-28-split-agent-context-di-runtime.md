# 拆分 AgentContext 为 AgentDI + AgentRuntimeConfig 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 `AgentContext`，将其字段拆为 `AgentDI`（18 个注入 provider）与 `AgentRuntimeConfig`（`securityMode` + `runtime`），全仓消费点改为 `di` + `runtimeConfig` 两个独立参数/字段。

**Architecture:** 纯类型与传参形态重构，不改任何运行时行为。按 core 执行链路 → core 装配链路 → bridge 的顺序推进；每个 Task 结束时对应包的 scoped typecheck + test 必须全绿，最后一个 Task 做全仓验证。新建模块遵循 module-separation-convention（单文件单职责）。

**Tech Stack:** TypeScript、pnpm monorepo、vitest。

**Spec:** `docs/superpowers/specs/2026-07-28-split-agent-context-di-runtime-design.md`

**验证命令约定：**
- core 包：`pnpm --filter rem-agent-core typecheck`、`pnpm --filter rem-agent-core test`
- bridge 包：`pnpm --filter rem-agent-bridge typecheck`、`pnpm --filter rem-agent-bridge test`
- 注意：Task 2/3 完成后 bridge 包暂时红（仍引用旧签名），属预期，Task 4 修复。

---

### Task 1: 新建类型文件 agent-di.ts 与 agent-runtime-config.ts

**Files:**
- Create: `packages/core/src/agent-di.ts`
- Create: `packages/core/src/agent-runtime-config.ts`

- [ ] **Step 1: 创建 `packages/core/src/agent-di.ts`**

字段与注释从 `agent-context.ts` 平移（含三处既有 TODO 注释中属于 DI 侧的两条：`toolComposer`、`fileMutationQueue`）：

```ts
import type { Models } from '@earendil-works/pi-ai';
import type { SystemPromptAssembler } from './sdk/system-prompt.js';
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
import type { McpConnectionManager } from './mcp/connection-manager.js';
import type { ToolComposer } from './sdk/tool-composer.js';
import type { FileMutationQueue } from './plugins/tool/file-system/shared/file-mutation-queue.js';
import type { RuleEngine } from './security/rules/rule-engine.js';
import type { StorageProvider } from './sdk/storage-provider.js';
import type { ToolPermissionEvaluator } from './security/permissions/types.js';

export interface AgentDI {
  configProvider: ConfigProvider; // 基础配置

  // Agent基础配置
  sessionProvider: SessionProvider; // 会话管理
  budgetPolicy: BudgetPolicy;
  systemPromptAssembler: SystemPromptAssembler;
  // context builder
  contextProvider: ContextProvider;
  // 压缩
  compressor: ContextCompressor;
  errorHandler: ErrorHandler;
  titleProvider: TitleProvider;
  loopStrategy: LoopStrategy;

  // 基础但是可有可无
  mcpManager: McpConnectionManager;

  // 业务相关
  toolProvider: ToolProvider;        // 原始本地 tools，不再预合并
  mcpProviders: ToolProvider[];
  skillProvider: SkillProvider;
  // TODO： 这个设计是不是不应该放在这里？
  toolComposer: ToolComposer;

  // 统一存储入口：session/rule/todo/archive/workspace 全部由其实现
  storage: StorageProvider;

  // TODO： 在文件相关的工具侧自己处理，不用处理
  fileMutationQueue: FileMutationQueue;

  // 工具的规则校验
  ruleEngine: RuleEngine;

  permissionEvaluator: ToolPermissionEvaluator;

  models: Models;
}
```

- [ ] **Step 2: 创建 `packages/core/src/agent-runtime-config.ts`**

```ts
import type { SecurityMode } from './security/permissions/factory.js';

export interface AgentRuntimeInfo {
  platform: string;
  nodeVersion?: string;
  // TODO: env 不应该传入，看看是否只是依赖cwd，其他的Agent可以自己通过 shell 自己获取到
  env: Record<string, string | undefined>;
}

export interface AgentRuntimeConfig {
  securityMode: SecurityMode;
  runtime: AgentRuntimeInfo;
}
```

- [ ] **Step 3: typecheck**

Run: `pnpm --filter rem-agent-core typecheck`
Expected: PASS（新文件暂无人引用，agent-context.ts 保留不动）

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/agent-di.ts packages/core/src/agent-runtime-config.ts
git commit -m "feat(core): 新增 AgentDI 与 AgentRuntimeConfig 类型定义"
```

---

### Task 2: core 执行链路改造（run-agent / delegate-task / build-child-context）

**Files:**
- Modify: `packages/core/src/run-agent.ts`
- Modify: `packages/core/src/plugins/tool/builtin/delegate-task.ts`
- Modify: `packages/core/src/sub-agent/build-child-context.ts`
- Test: `packages/core/tests/run-agent.test.ts`
- Test: `packages/core/tests/run-agent-custom.test.ts`
- Test: `packages/core/tests/run-agent-workspace-root.test.ts`
- Test: `packages/core/tests/delegate-task-tool.test.ts`

- [ ] **Step 1: 改 `run-agent.ts`**

import 行（第 13 行）替换：

```ts
import type { AgentDI } from './agent-di.js';
import type { AgentRuntimeConfig } from './agent-runtime-config.js';
```

`RunAgentParams`（第 32-41 行）中 `ctx: AgentContext;` 替换为：

```ts
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
```

函数体第 53 行 `const ctx = params.ctx;` 替换为：

```ts
    const di = params.di;
    const runtimeConfig = params.runtimeConfig;
```

然后将函数体内所有 `ctx.` 改为 `di.`，**除了以下 4 处**（属 runtimeConfig）：

- 第 132 行 `ctx.runtime.env` → `runtimeConfig.runtime.env`
- 第 207 行 `ctx.runtime.platform` → `runtimeConfig.runtime.platform`
- 第 208 行 `ctx.runtime.nodeVersion ?? ctx.runtime.platform` → `runtimeConfig.runtime.nodeVersion ?? runtimeConfig.runtime.platform`
- 第 257 行 `securityMode: ctx.securityMode,` → `securityMode: runtimeConfig.securityMode,`

第 183 行 delegate 工具注册改为：

```ts
      const delegateToolExecutor = createDelegateTaskToolExecutor(di, runtimeConfig, params.agentState, workspace);
```

- [ ] **Step 2: 改 `build-child-context.ts`**

import 替换（第 1 行）：

```ts
import type { AgentDI } from '../agent-di.js';
import type { AgentRuntimeConfig } from '../agent-runtime-config.js';
```

`buildChildContext`（第 62-83 行）整体替换为：

```ts
export function buildChildContext(
  di: AgentDI,
  runtimeConfig: AgentRuntimeConfig,
  options?: BuildChildContextOptions,
): { di: AgentDI; runtimeConfig: AgentRuntimeConfig } {
  const childConfigProvider = new ChildConfigProvider(di.configProvider, {
    maxTurns: options?.maxTurns,
  });
  const permissionEvaluator = createPermissionEvaluator(
    'auto' as SecurityMode,
    di.ruleEngine,
  );

  return {
    di: {
      ...di,
      configProvider: childConfigProvider,
      permissionEvaluator,
      systemPromptAssembler: options?.systemPrompt
        ? new StaticSystemPromptAssembler(options.systemPrompt)
        : di.systemPromptAssembler,
    },
    runtimeConfig: { ...runtimeConfig, securityMode: 'auto' },
  };
}
```

（`ChildConfigProvider`、`StaticSystemPromptAssembler` 保持不变。）

- [ ] **Step 3: 改 `delegate-task.ts`**

import（第 4 行）替换：

```ts
import type { AgentDI } from '../../../agent-di.js';
import type { AgentRuntimeConfig } from '../../../agent-runtime-config.js';
```

`createDelegateTaskToolExecutor` 签名（第 31-35 行）替换：

```ts
export function createDelegateTaskToolExecutor(
  di: AgentDI,
  runtimeConfig: AgentRuntimeConfig,
  agentState: AgentState,
  workspace: string,
): ToolExecutor<typeof delegateTaskSchema> {
```

函数体内：

- 第 42、48 行 `parentCtx.sessionProvider` → `di.sessionProvider`
- 第 50-53 行替换为：

```ts
    const child = buildChildContext(di, runtimeConfig, {
      maxTurns: input.maxTurns,
      systemPrompt: input.systemPrompt,
    });
```

- 第 55-63 行 `runAgent({...})` 中 `ctx: childCtx,` 替换为：

```ts
      di: child.di,
      runtimeConfig: child.runtimeConfig,
```

- [ ] **Step 4: 改 `tests/run-agent.test.ts`**

- 第 3 行 import 替换：`import type { AgentDI } from '../src/agent-di.js';`，并新增 `import type { AgentRuntimeConfig } from '../src/agent-runtime-config.js';`
- `createMockContextBase` 中删除第 54 行 `runtime: { platform: 'test', cwd: '/tmp', env: {} },`
- 在 `createMockContextBase` 后新增 helper：

```ts
const stubRuntimeConfig = (): AgentRuntimeConfig => ({
  securityMode: 'interactive',
  runtime: { platform: 'test', env: {} },
});
```

- 全部 6 处 `as unknown as AgentContext` → `as unknown as AgentDI`；对应局部变量 `mockCtx` 改名为 `mockDI`（含引用处）
- 全部 6 处 runAgent 调用中 `ctx: mockCtx,` → `di: mockDI, runtimeConfig: stubRuntimeConfig(),`

- [ ] **Step 5: 改 `tests/run-agent-custom.test.ts`**

- 第 2 行 import 替换为 `import type { AgentDI } from '../src/agent-di.js';`，新增 `import type { AgentRuntimeConfig } from '../src/agent-runtime-config.js';`
- `createMockContext` 中删除第 75 行 `runtime: { platform: 'test', cwd: '/tmp', env: {} },`，返回值 `as unknown as AgentContext` → `as unknown as AgentDI`
- 新增 helper（同 Task 2 Step 4 的 `stubRuntimeConfig`）
- 3 个用例中局部变量 `const ctx = createMockContext();` → `const di = createMockContext();`；runAgent 调用中 `ctx,` → `di, runtimeConfig: stubRuntimeConfig(),`；断言中 `ctx.systemPromptAssembler` / `ctx.models.complete` → `di.systemPromptAssembler` / `di.models.complete`

- [ ] **Step 6: 改 `tests/run-agent-workspace-root.test.ts`**

- import 同 Step 4 替换
- 每个用例对象字面量中的 `runtime: { platform: 'test', cwd: '/tmp', env: {} },`（第 60、100 行及第三处）删除；`as unknown as AgentContext` → `as unknown as AgentDI`；`mockCtx` → `mockDI`
- runAgent 调用中 `ctx: mockCtx,` → `di: mockDI, runtimeConfig: stubRuntimeConfig(),`
- 新增 `stubRuntimeConfig` helper（同 Step 4）

- [ ] **Step 7: 改 `tests/delegate-task-tool.test.ts`**

- 第 9 行 import 替换为 `import type { AgentDI } from '../src/agent-di.js';`，新增 `import type { AgentRuntimeConfig } from '../src/agent-runtime-config.js';`
- 新增 `stubRuntimeConfig` helper（同 Step 4）
- 每个 mock 对象中删除 `securityMode: 'interactive' as const,` 与 `runtime: { platform: 'test', cwd: '/tmp', env: {} },` 两行；`as unknown as AgentContext` → `as unknown as AgentDI`；`mockCtx` → `mockDI`
- executor 调用 `createDelegateTaskToolExecutor(mockCtx, agentState, 'default')` → `createDelegateTaskToolExecutor(mockDI, stubRuntimeConfig(), agentState, 'default')`

- [ ] **Step 8: 验证 core**

Run: `pnpm --filter rem-agent-core typecheck && pnpm --filter rem-agent-core test`
Expected: PASS（bridge 此时仍红，属预期）

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/run-agent.ts packages/core/src/sub-agent/build-child-context.ts packages/core/src/plugins/tool/builtin/delegate-task.ts packages/core/tests/run-agent.test.ts packages/core/tests/run-agent-custom.test.ts packages/core/tests/run-agent-workspace-root.test.ts packages/core/tests/delegate-task-tool.test.ts
git commit -m "refactor(core): 执行链路拆分 di + runtimeConfig"
```

---

### Task 3: core 装配链路改造 + 删除 agent-context.ts

**Files:**
- Modify: `packages/core/src/agent-context-assembler.ts`
- Modify: `packages/core/src/agent-context-builder.ts`
- Modify: `packages/core/src/agent-factory.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/browser.ts`
- Delete: `packages/core/src/agent-context.ts`
- Test: `packages/core/tests/agent-context-assembler.test.ts`
- Test: `packages/core/tests/agent-context-builder.test.ts`

- [ ] **Step 1: 改 `agent-context-assembler.ts`**

第 2 行 import 替换：

```ts
import type { AgentDI } from './agent-di.js';
import type { AgentRuntimeConfig, AgentRuntimeInfo } from './agent-runtime-config.js';
```

在 `AssembleAgentContextOptions` 定义前新增：

```ts
export interface AgentAssembly {
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
}
```

`assembleAgentContext` 签名改为 `Promise<AgentAssembly>`，return 语句（第 93-115 行）替换为：

```ts
  return {
    di: {
      configProvider,
      sessionProvider: options.sessionProvider ?? new DefaultSessionProvider(storageProvider.sessionStore),
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
      mcpManager: options.mcpManager ?? ({} as McpConnectionManager),
      fileMutationQueue: options.fileMutationQueue ?? (new NoopFileMutationQueue() as FileMutationQueue),
      systemPromptAssembler: options.systemPromptAssembler,
      ruleEngine,
      storage: storageProvider,
      permissionEvaluator,
      models,
    },
    runtimeConfig: { securityMode, runtime },
  };
```

（函数体前半部分 compressor/ruleEngine/permissionEvaluator 构建逻辑不变。）

- [ ] **Step 2: 改 `agent-context-builder.ts`**

- 第 29 行 `import type { AgentContext, AgentRuntimeInfo } from './agent-context.js';` 替换为：

```ts
import type { AgentAssembly } from './agent-context-assembler.js';
import type { AgentRuntimeInfo } from './agent-runtime-config.js';
```

- `buildAgentContext` 返回类型改为 `Promise<AgentAssembly>`（函数体不变）

- [ ] **Step 3: 改 `agent-factory.ts`**

```ts
import { buildAgentContext, type AgentContextBuildOptions } from './agent-context-builder.js';
import type { AgentAssembly } from './agent-context-assembler.js';

export interface CreateAgentOptions extends AgentContextBuildOptions {}

export async function createAgentFromEnv(options?: CreateAgentOptions): Promise<AgentAssembly> {
  return buildAgentContext(options);
}
```

- [ ] **Step 4: 删除 `agent-context.ts`，收尾导出**

```bash
git rm packages/core/src/agent-context.ts
```

`index.ts` 第 16 行 `export type { AgentContext } from './agent-context.js';` 替换为：

```ts
export type { AgentDI } from './agent-di.js';
export type { AgentRuntimeConfig, AgentRuntimeInfo } from './agent-runtime-config.js';
export type { AgentAssembly } from './agent-context-assembler.js';
```

`browser.ts` 第 7 行 `export type { AgentContext, AgentRuntimeInfo } from './agent-context.js';` 替换为：

```ts
export type { AgentDI } from './agent-di.js';
export type { AgentRuntimeConfig, AgentRuntimeInfo } from './agent-runtime-config.js';
export type { AgentAssembly } from './agent-context-assembler.js';
```

- [ ] **Step 5: 改 `tests/agent-context-assembler.test.ts`**

第 76-89 行的用例替换为：

```ts
  it('assembles AgentDI and AgentRuntimeConfig with pure defaults', async () => {
    const { di, runtimeConfig } = await assembleAgentContext(stubOptions());
    expect(di.configProvider).toBeDefined();
    expect(di.sessionProvider).toBeDefined();
    expect(di.toolProvider.getToolSet()).toEqual([]);
    expect(await di.skillProvider.loadSkills()).toEqual([]);
    expect(di.compressor).toBeDefined();
    expect(di.ruleEngine).toBeDefined();
    expect(di.storage).toBeDefined();
    expect(di.permissionEvaluator).toBeDefined();
    expect(runtimeConfig.securityMode).toBe('interactive');
    expect(runtimeConfig.runtime.platform).toBe('test');
    await expect(di.fileMutationQueue.withQueue('/x', async () => 42)).resolves.toBe(42);
  });
```

- [ ] **Step 6: 改 `tests/agent-context-builder.test.ts`**

第 15 行起替换为：

```ts
    const { di } = await buildAgentContext({ paths });

    expect(di.toolProvider).toBeDefined();
    expect(di.mcpProviders).toBeDefined();
    expect(di.mcpProviders).toBeInstanceOf(Array);
    expect(di.toolComposer).toBeDefined();
    expect(typeof di.toolComposer.compose).toBe('function');

    // read_skill should NOT be pre-registered on the raw toolProvider
    expect(di.toolProvider.getToolSet().some((t) => t.name === 'read_skill')).toBe(false);
```

- [ ] **Step 7: 验证 core**

Run: `pnpm --filter rem-agent-core typecheck && pnpm --filter rem-agent-core test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/agent-context-assembler.ts packages/core/src/agent-context-builder.ts packages/core/src/agent-factory.ts packages/core/src/index.ts packages/core/src/browser.ts packages/core/src/agent-context.ts packages/core/tests/agent-context-assembler.test.ts packages/core/tests/agent-context-builder.test.ts
git commit -m "refactor(core): 装配链路返回 AgentAssembly，删除 AgentContext"
```

---

### Task 4: bridge 改造（agent / agent-service-core / local service）

**Files:**
- Modify: `packages/bridge/src/agent.ts`
- Modify: `packages/bridge/src/agent-service-core.ts`
- Modify: `packages/bridge/src/local/agent-local-service.ts`
- Test: `packages/bridge/tests/agent-service/session.test.ts`
- Test: `packages/bridge/tests/agent-service/cache-refresh.test.ts`
- Test: `packages/bridge/tests/agent-service/init.test.ts`

- [ ] **Step 1: 改 `agent-service-core.ts`**

第 1 行 import 中 `AgentContext` 替换为 `AgentDI, AgentRuntimeConfig`（仍来自 `rem-agent-core/browser`）。

`AgentServiceCoreDeps`（第 9-12 行）替换：

```ts
export interface AgentServiceCoreDeps {
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
  agentState: AgentState;
}
```

字段与构造函数（第 16-24 行）替换：

```ts
  private di: AgentDI;
  private runtimeConfig: AgentRuntimeConfig;
  private agentState: AgentState;
  private sessionManager: AgentSessionManager;

  constructor(deps: AgentServiceCoreDeps) {
    this.di = deps.di;
    this.runtimeConfig = deps.runtimeConfig;
    this.agentState = deps.agentState;
    this.sessionManager = new AgentSessionManager(deps.di.sessionProvider, deps.agentState);
  }
```

其余 `this.ctx.` 全部改 `this.di.`（第 33、37、41、133、181、182 行）；`run` 方法中 `coreRunAgent({...})` 的 `ctx: this.ctx,`（第 60 行）替换为：

```ts
        di: this.di,
        runtimeConfig: this.runtimeConfig,
```

- [ ] **Step 2: 改 `agent.ts`**

第 3 行 import 中 `AgentContext` 替换为 `AgentDI, AgentRuntimeConfig`。

字段（第 15 行）替换：

```ts
  private _di: AgentDI | undefined;
  private _runtimeConfig: AgentRuntimeConfig | undefined;
```

`init()`（第 27-31 行）替换：

```ts
    const { di, runtimeConfig } = await buildAgentContext(this.options);
    this._di = di;
    this._runtimeConfig = runtimeConfig;
    this.core = new AgentServiceCore({
      di,
      runtimeConfig,
      agentState: this.agentState,
    });
```

`context` getter（第 36-38 行）替换为两个 getter：

```ts
  get di(): AgentDI | undefined {
    return this._di;
  }

  get runtimeConfig(): AgentRuntimeConfig | undefined {
    return this._runtimeConfig;
  }
```

- [ ] **Step 3: 改 `local/agent-local-service.ts`**

- 第 10 行 type import 中删除 `AgentContext`
- 第 79 行 `const ctx: AgentContext = await assembleAgentContext({...})` → `const { di, runtimeConfig } = await assembleAgentContext({...})`
- 第 92 行 `new AgentServiceCore({ ctx, agentState })` → `new AgentServiceCore({ di, runtimeConfig, agentState })`

- [ ] **Step 4: 改 bridge 测试**

- `session.test.ts`：第 125、168 行 `service.context!.sessionProvider` → `service.di!.sessionProvider`
- `cache-refresh.test.ts`：第 28 行 `const ctx = service.context!;` → `const di = service.di!;`，其后 `ctx.sessionProvider`（第 29、33 行）→ `di.sessionProvider`
- `init.test.ts`：第 33 行用例名 `'builds AgentContext on init'` → `'builds AgentDI and runtime config on init'`（断言语义不变）

- [ ] **Step 5: 验证 bridge**

Run: `pnpm --filter rem-agent-bridge typecheck && pnpm --filter rem-agent-bridge test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/bridge/src/agent.ts packages/bridge/src/agent-service-core.ts packages/bridge/src/local/agent-local-service.ts packages/bridge/tests/agent-service/session.test.ts packages/bridge/tests/agent-service/cache-refresh.test.ts packages/bridge/tests/agent-service/init.test.ts
git commit -m "refactor(bridge): AgentService 持有 di + runtimeConfig"
```

---

### Task 5: 文档更新与全仓验证

**Files:**
- Modify: `packages/core/README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: 更新 `packages/core/README.md`**

将 `AgentContext` 相关描述改为 `AgentDI` + `AgentRuntimeConfig`（保持英文）。关键替换：

- 第 9 行：`operating over an assembled `AgentContext`` → `operating over an assembled `AgentDI` + `AgentRuntimeConfig``
- 第 18 行：`AgentContext (models, providers, config, storage)` → `AgentDI (models, providers, storage) + AgentRuntimeConfig (securityMode, runtime)`
- 第 53 行：`builds the `AgentContext`` → `builds the `AgentAssembly` (`{ di, runtimeConfig }`)`
- 第 76 行 `createAgentFromEnv()` 描述中 `builds `AgentContext`` → `builds the `AgentAssembly``
- 第 328 行签名：`Promise<AgentContext>` → `Promise<AgentAssembly>`
- 第 331 行 `assembles a full `AgentContext` (models, session storage, ...)` → `assembles a full `AgentAssembly` (`AgentDI` + `AgentRuntimeConfig`)`
- 第 340 行 `ctx: AgentContext;` → `di: AgentDI;` 并在其下加一行 `runtimeConfig: AgentRuntimeConfig;`

- [ ] **Step 2: 更新 `AGENTS.md`**

"Core 在 `agent-factory.ts` 中通过 `createAgentFromEnv` 读取环境变量，并构造 `AgentContext`（含 `models`、`provider`、`model` 等）" 一句中 `AgentContext` 改为 `AgentAssembly`（`AgentDI` + `AgentRuntimeConfig`）。

- [ ] **Step 3: 确认零残留**

Run: `rg -n "AgentContext" packages/ AGENTS.md`
Expected: 仅剩 `AssembleAgentContextOptions` / `AgentContextBuildOptions` / `assembleAgentContext` / `buildAgentContext` / `agent-context-assembler` / `agent-context-builder` 这类命名（本次不改名），无任何 `AgentContext` 类型引用

- [ ] **Step 4: 全仓验证**

Run: `pnpm typecheck && pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/README.md AGENTS.md
git commit -m "docs: AgentContext 拆分后同步 README 与 AGENTS.md"
```

---

## Self-Review 记录

- Spec 覆盖：类型定义（Task 1）、装配入口（Task 3）、执行链路（Task 2）、bridge（Task 4）、README/测试（Task 2-5）均有对应 Task；`AgentAssembly` 仅作装配返回值与 bridge 持有载体，与 spec 一致。
- 命名一致性：全计划统一 `di` / `runtimeConfig` / `AgentDI` / `AgentRuntimeConfig` / `AgentAssembly`；`stubRuntimeConfig` helper 在 4 个测试文件中重复定义（测试间不共享 helper，符合各文件独立现状）。
- 中间态说明：Task 2/3 后 bridge 暂时红，已在头部"验证命令约定"中声明，Task 4 修复，Task 5 全仓兜底。
