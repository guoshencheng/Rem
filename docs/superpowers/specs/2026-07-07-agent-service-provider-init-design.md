# AgentService 自包含 Provider 初始化设计

**日期**: 2026-07-07  
**主题**: 将 Provider 初始化从调用方收拢到 `AgentService` 内部  
**范围**: `packages/core`、`packages/bridge`、`packages/web`  
**状态**: 已评审，待实施

---

## 1. 背景与动机

当前服务端使用 Agent 时，调用方必须显式执行两步：

```ts
import { createAgentFromEnv } from 'rem-agent-core';
import { AgentService } from 'rem-agent-bridge';

const ctx = await createAgentFromEnv({ workspaceRoot: process.cwd() });
const service = new AgentService(ctx);
```

`AgentContext` 的构建散落在调用方（web 容器）中，导致：

- `AgentService` 不是自包含的，调用方需要了解 `AgentContext` 的存在。
- Provider 初始化（LLM、tools、MCP、memory 等）的触发点不在 `AgentService` 内，职责划分不够自然。

本设计目标是将 Provider 初始化收拢到 `AgentService` 内部，同时守住「Provider 配置由 Core 拥有」的红线。

---

## 2. 目标与非目标

### 目标

- `AgentService` 成为服务端自包含入口：调用方只需 `new AgentService(options)` 并 `await service.init()`。
- Core 新增 `AgentContextBuilder`，统一负责 `AgentContext` 的异步构建。
- `createAgentFromEnv` 保留为 `AgentContextBuilder` 的薄封装，维持向后兼容。
- `packages/bridge` 不直接读取 `OPENAI_API_KEY` 等环境变量，配置解析仍由 Core 负责。

### 非目标

- 不改动 `packages/tui`（已作废，排除在本次范围外）。
- 不改动机运行时推理循环（`runAgent`、`ReactLoop`、`reason` 等）的逻辑。
- 不引入新的 Provider 类型或配置格式。

---

## 3. 架构

```text
┌─────────────────────────────────────┐
│  packages/web/src/lib/container.ts  │
│  const service = new AgentService(opts)
│  await service.init()               │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  packages/bridge/src/agent.ts       │
│  AgentService                       │
│  - constructor(opts)                │
│  - async init()                     │
│     └─▶ buildAgentContext(opts)     │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  packages/core/src/                 │
│  agent-context-builder.ts           │
│  - registerBuiltInProviders()       │
│  - configProvider.init()            │
│  - 创建 tools / MCP / memory / ...  │
│  - 返回 AgentContext                │
└─────────────────────────────────────┘
```

---

## 4. 组件与接口

### 4.1 Core 新增 `AgentContextBuilder`

文件：`packages/core/src/agent-context-builder.ts`

```ts
export interface AgentContextBuildOptions {
  name?: string;
  workspaceRoot?: string;
  maxTurns?: number;
  // 继承现有 CreateAgentOptions 的合法字段
}

export async function buildAgentContext(
  options?: AgentContextBuildOptions
): Promise<AgentContext> {
  // 1. 注册内置 LLM Provider
  // 2. 初始化 DefaultConfigProvider，读取 env / 配置文件
  // 3. 创建 session、tool、memory、skill、budget、compressor 等 Provider
  // 4. 组装并返回 AgentContext
}
```

### 4.2 改造 `createAgentFromEnv`

文件：`packages/core/src/agent-factory.ts`

```ts
export async function createAgentFromEnv(
  options?: CreateAgentOptions
): Promise<AgentContext> {
  return buildAgentContext(options);
}
```

### 4.3 Bridge 改造 `AgentService`

文件：`packages/bridge/src/agent.ts`

```ts
export class AgentService implements IAgentService {
  private ctx: AgentContext | undefined;

  constructor(private options: AgentServiceOptions) {}

  async init(): Promise<void> {
    this.ctx = await buildAgentContext(this.options);
  }

  async run(sessionId: string, input: string): Promise<void> {
    if (!this.ctx) throw new Error('AgentService not initialized');
    // 现有逻辑
  }

  // interrupt、reset、stream 等同理
}
```

### 4.4 更新 `IAgentService` 接口

文件：`packages/bridge/src/agent-service.interface.ts`

加入 `init(): Promise<void>`。

### 4.5 Web 容器简化

文件：`packages/web/src/lib/container.ts`

```ts
const service = new AgentService({ workspaceRoot: process.cwd() });
await service.init();
```

---

## 5. 数据流

1. Web 容器创建 `AgentService` 实例。
2. 调用 `await service.init()`。
3. `AgentService` 调用 Core 的 `buildAgentContext(options)`。
4. `buildAgentContext` 完成 Provider 注册、配置加载、Provider 实例化、AgentContext 组装。
5. `AgentService` 保存 `AgentContext`。
6. 后续 `service.run(sessionId, input)` 直接使用已构建的 `ctx`。
7. 运行时链路保持不变：`runAgent(ctx, ...)` → loop strategy → `reason()` → `resolveProvider()` → `InferenceEngine`。

---

## 6. 错误处理

- **构建期错误**：`buildAgentContext` 抛出的错误（如缺少 API key、配置非法）在 `await service.init()` 时直接向上传播。Web 容器应在启动时捕获并给出明确提示。
- **重复 init**：`init()` 应幂等。若已初始化，第二次调用直接返回。
- **未初始化调用 run()**：`run()` 等操作在 `ctx` 未就绪时抛出 `AgentService not initialized` 错误。
- **配置错误归属**：所有与 Provider 配置相关的错误信息由 Core 生成，AgentService 只透传。

---

## 7. 测试策略

### Core

- `AgentContextBuilder` 单元测试：验证 Provider 注册、配置加载、AgentContext 组装。
- mock 配置提供者或环境变量，验证缺失配置时抛出合理错误。

### Bridge

- 注入已构建的 `AgentContext`，测试 `run/interrupt/reset/stream` 行为。
- 新增测试：验证 `init()` 调用 `buildAgentContext` 并保存结果。
- 验证未 `init()` 时调用 `run()` 抛出明确错误。
- 验证 `init()` 幂等性。

### Web

- 容器集成测试：验证容器只创建 `AgentService` 并调用 `init()`，不再直接调用 `createAgentFromEnv`。

### 红线

- 确认 `packages/bridge` 不直接读取 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY` 等环境变量。

---

## 8. 红线与边界

- **Provider 配置由 Core 拥有**：环境变量读取、模型选择、baseURL 解析仍必须在 `packages/core` 内完成。
- **`AgentService` 不直接读取 env**：`AgentService` 仅通过 `buildAgentContext` 获取已解析的配置和 Provider 实例。
- **模块拆分**：新增文件应遵循 module-separation-convention，保持文件精简、职责单一。`AgentService` 不应因承担构建逻辑而过度膨胀。

---

## 9. 迁移步骤

1. 在 Core 中创建 `agent-context-builder.ts`，实现 `buildAgentContext`。
2. 将 `createAgentFromEnv` 改为 `buildAgentContext` 的薄封装。
3. 更新 `IAgentService` 接口，加入 `init()`。
4. 改造 `AgentService`：构造函数接收 options，新增 `init()`，内部调用 `buildAgentContext`。
5. 更新 Web 容器，移除显式的 `createAgentFromEnv` 调用。
6. 添加/更新单元测试与集成测试。
7. 运行 `pnpm typecheck && pnpm test`。

---

## 10. 决策记录

- **方案选择**：方案 B（Core 暴露 `AgentContextBuilder`，`AgentService` 负责编排）。
- **初始化方式**：仅暴露 `init()` 实例方法，不采用静态工厂或懒加载。
- **TUI 处理**：排除在本次设计与实施范围外。
- **红线处理**：遵守「Provider 配置由 Core 拥有」的红线，`AgentService` 不直接读取环境变量。
