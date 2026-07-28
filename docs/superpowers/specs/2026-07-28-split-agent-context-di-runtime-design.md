# 拆分 AgentContext 为 AgentDI + AgentRuntimeConfig

## 目标

删除 `AgentContext` 类型，将其字段按性质拆成两个独立类型：

- `AgentDI` —— 注入的依赖（装配期一次构建、运行期只读的全部 provider）
- `AgentRuntimeConfig` —— 运行时配置（`securityMode` + `runtime`）

下游传参字段名统一为 `di` 和 `runtimeConfig`（DI 内已有 `configProvider`，避免叫 `config` 混淆）。

## 类型定义

```ts
// packages/core/src/agent-di.ts（新建）
export interface AgentDI {
  configProvider: ConfigProvider;
  sessionProvider: SessionProvider;
  budgetPolicy: BudgetPolicy;
  systemPromptAssembler: SystemPromptAssembler;
  contextProvider: ContextProvider;
  compressor: ContextCompressor;
  errorHandler: ErrorHandler;
  titleProvider: TitleProvider;
  loopStrategy: LoopStrategy;
  mcpManager: McpConnectionManager;
  toolProvider: ToolProvider;
  mcpProviders: ToolProvider[];
  skillProvider: SkillProvider;
  toolComposer: ToolComposer;
  storage: StorageProvider;
  fileMutationQueue: FileMutationQueue;
  ruleEngine: RuleEngine;
  permissionEvaluator: ToolPermissionEvaluator;
  models: Models;
}

// packages/core/src/agent-runtime-config.ts（新建）
export interface AgentRuntimeInfo {
  platform: string;
  nodeVersion?: string;
  env: Record<string, string | undefined>;
}

export interface AgentRuntimeConfig {
  securityMode: SecurityMode;
  runtime: AgentRuntimeInfo;
}
```

`agent-context.ts` 删除。`AgentRuntimeInfo` 的 TODO（env 是否应传入）保留注释，不在本次处理。

## 装配入口

`assembleAgentContext` / `buildAgentContext` / `createAgentFromEnv` 返回类型改为：

```ts
// packages/core/src/agent-context-assembler.ts 中导出
export interface AgentAssembly {
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
}
```

`AgentAssembly` 仅作为装配函数返回值与 bridge 持有载体，不向下游执行链路传递（执行链路一律拆成 `di` + `runtimeConfig` 两个独立参数/字段）。

## 改动范围

| 文件 | 操作 | 说明 |
|---|---|---|
| `packages/core/src/agent-di.ts` | NEW | `AgentDI`（18 个 provider 字段） |
| `packages/core/src/agent-runtime-config.ts` | NEW | `AgentRuntimeConfig` + `AgentRuntimeInfo` |
| `packages/core/src/agent-context.ts` | DELETE | 类型迁至上述两文件 |
| `packages/core/src/agent-context-assembler.ts` | MODIFY | 返回 `AgentAssembly`；导出 `AgentAssembly` 类型 |
| `packages/core/src/agent-context-builder.ts` | MODIFY | `buildAgentContext` 返回 `AgentAssembly` |
| `packages/core/src/agent-factory.ts` | MODIFY | `createAgentFromEnv` 返回 `AgentAssembly` |
| `packages/core/src/run-agent.ts` | MODIFY | `RunAgentParams.ctx` → `di` + `runtimeConfig`；内部 `ctx.xxx` → `di.xxx`，`ctx.securityMode`/`ctx.runtime` → `runtimeConfig.xxx` |
| `packages/core/src/sub-agent/build-child-context.ts` | MODIFY | `buildChildContext(di, runtimeConfig, options)`，返回 `{ di, runtimeConfig }`；子 agent 覆盖逻辑（ChildConfigProvider、`securityMode: 'auto'`、重建 permissionEvaluator）不变 |
| `packages/core/src/plugins/tool/builtin/delegate-task.ts` | MODIFY | `createDelegateTaskToolExecutor(parentCtx, ...)` → `(di, runtimeConfig, ...)` |
| `packages/core/src/index.ts` / `browser.ts` | MODIFY | 导出 `AgentDI` / `AgentRuntimeConfig` / `AgentRuntimeInfo` / `AgentAssembly`，移除 `AgentContext` |
| `packages/bridge/src/agent.ts` | MODIFY | `AgentService` 持有 `assembly: AgentAssembly`（或 `di` + `runtimeConfig` 两字段）；`context` getter 同步调整 |
| `packages/bridge/src/agent-service-core.ts` | MODIFY | 构造参数 `ctx: AgentContext` → `di` + `runtimeConfig`；消费点（`sessionProvider`、`storage.*`、`ruleEngine`）改走 `di` |
| `packages/bridge/src/local/agent-local-service.ts` | MODIFY | `assembleAgentContext` 返回值解构为 `di` + `runtimeConfig` |
| `packages/core/README.md` | MODIFY | `AgentContext` 相关描述与 API 签名更新 |
| `packages/core/tests/agent-context-assembler.test.ts` | MODIFY | 断言改对 `{ di, runtimeConfig }` |
| `packages/core/tests/agent-context-builder.test.ts` | MODIFY | 同上 |
| `packages/core/tests/run-agent.test.ts` / `run-agent-workspace-root.test.ts` / `run-agent-custom.test.ts` | MODIFY | stub 对象拆成 `di` + `runtimeConfig` 两个 |
| `packages/core/tests/delegate-task-tool.test.ts` | MODIFY | 同上 |
| `packages/bridge/tests/agent-service/init.test.ts` | MODIFY | 断言语义不变，适配新结构 |

## 不改的

- `LoopContext`、`ToolContext`、`ExecuteParams`、`ReasonParams` 等其他 ctx 保持现状，不在本次范围。
- `AgentContext` 内三处既有 TODO（`toolComposer`、`fileMutationQueue`、`runtime.env` 的归属）保留注释，不随迁移动字段。
- provider 的行为与装配顺序不变，纯类型与传参形态重构。

## 验证

`pnpm typecheck && pnpm test` 全绿。
