# Tool 整合职责迁移设计

## 背景

当前 `createAgentFromEnv` 不仅是创建和连接各类 provider 的工厂，还承担了 tool 整合的职责：

- 创建本地 filesystem tools；
- 连接 MCP servers；
- 用 `CompositeToolProvider` 把本地 tools 与 MCP tools 合并；
- 注册 `read_skill` 工具。

这导致 factory 做了两件不同层次的事：**生命周期管理** 和 **工具整合**。当需要调整整合规则（命名空间、冲突处理、`read_skill` 注册时机）时，必须改动工厂。我们希望把整合逻辑收敛到一处，由 `runAgent` 在运行时统一完成。

## 目标

1. `createAgentFromEnv` 只负责创建/连接 raw providers：
   - `toolProvider`（本地 filesystem tools）
   - `mcpProviders`（已连接的 MCP tool providers）
   - `skillProvider`
2. `runAgent` 在启动时统一调用整合器，得到最终可用的 `ToolProvider`。
3. `read_skill` 的注册延迟到 `runAgent` 里，和 skill catalog 加载处于同一生命周期阶段。
4. 每次运行产生新的合并实例，避免污染原始 provider。

## 非目标

- 不替换现有 `ToolProvider` 接口。
- 不改变 LLM reason / execute 的调用方式。
- 本次不统一调整 `toolPolicy` 的作用范围（本地 vs MCP），但新架构让这类调整有清晰落点。

## 架构

```text
createAgentFromEnv
  ├─ create raw toolProvider (filesystem tools)
  ├─ create skillProvider
  ├─ connect MCPs → mcpProviders
  └─ create ToolComposer
        ↓
AgentContext(toolProvider, mcpProviders, skillProvider, toolComposer)
        ↓
runAgent
  ├─ skillProvider.loadSkills() → system prompt
  ├─ toolComposer.compose(...) → effectiveToolProvider
  └─ LLM reason(toolSet) / execute(toolCalls)
```

## 组件与接口

### `ToolComposer`

位置：`packages/core/src/sdk/tool-composer.ts`

```typescript
export interface ToolComposer {
  compose(params: {
    toolProvider: ToolProvider;
    mcpProviders: ToolProvider[];
    skillProvider: SkillProvider;
  }): ToolProvider;
}
```

设计为接收参数对象而非整个 `AgentContext`，降低耦合，便于单元测试。

### `DefaultToolComposer`

位置：`packages/core/src/tool-composer.ts`

```typescript
export class DefaultToolComposer implements ToolComposer {
  compose({ toolProvider, mcpProviders, skillProvider }): ToolProvider {
    // 1. 合并本地与 MCP tools
    const base = mcpProviders.length > 0
      ? new CompositeToolProvider(toolProvider, mcpProviders)
      : toolProvider;

    // 2. 在 overlay 上注册 read_skill，不修改原始 provider
    const overlay = new OverlayToolProvider(base);
    const readSkillTool = createReadSkillTool(skillProvider);
    overlay.register(readSkillTool.definition, readSkillTool.executor);

    return overlay;
  }
}
```

说明：
- 复用现有 `CompositeToolProvider` 处理本地与 MCP 的合并；
- 若不存在 MCP，直接以原始 `toolProvider` 为基础；
- 新增 `OverlayToolProvider`（或等效机制），在不修改原始 provider 的前提下叠加 `read_skill`；
- 每次 `compose()` 都产生新的 `OverlayToolProvider` 实例，保证多次调用互不污染。

### `AgentContext` 调整

位置：`packages/core/src/agent-context.ts`

```typescript
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
  compressor?: MessageCompressor;
  errorHandler: ErrorHandler;
  titleProvider: TitleProvider;
  loopStrategy: LoopStrategy;
  mcpManager: McpConnectionManager;
}
```

### `runAgent` 调整

位置：`packages/core/src/run-agent.ts`

启动阶段：

```typescript
const { skillProvider, toolComposer, toolProvider, mcpProviders } = ctx;
const skills = await skillProvider.loadSkills();
// ... 把 skill catalog 拼进 system prompt

const effectiveToolProvider = toolComposer.compose({
  toolProvider,
  mcpProviders,
  skillProvider,
});

const tools = effectiveToolProvider.getToolSet();
```

后续 `reason()` 和 `executeTools()` 均使用 `effectiveToolProvider`。

## 数据流

### 启动阶段（`createAgentFromEnv`）

1. 创建 `DefaultConfigProvider`、`InMemorySessionProvider`、`InMemoryAgentLiveProvider`。
2. 创建 raw `toolProvider = createFileSystemTools(configProvider)`。
3. 创建 `skillProvider = new FileSkillProvider(...)`。
4. 读取 `mcpServers` 配置，连接 MCP：`mcpProviders = await mcpManager.connectAll(mcpConfig)`。
5. 创建 `toolComposer = new DefaultToolComposer()`。
6. 组装 `AgentContext`：
   - `toolProvider` 为未合并的原始本地工具；
   - `mcpProviders` 为连接成功的 MCP 工具列表；
   - `skillProvider` 不变；
   - `toolComposer` 为新的整合器。

### 运行阶段（`runAgent`）

1. 从 `ctx` 取出 `skillProvider` 加载 skills，拼入 system prompt。
2. 调用 `toolComposer.compose({ toolProvider, mcpProviders, skillProvider })`：
   - 构造新的 `CompositeToolProvider`（如有 MCP）；
   - 或直接以 `toolProvider` 为基础（如无 MCP）；
   - 用 `OverlayToolProvider` 包裹基础 provider，并在其上注册 `read_skill`；
   - 返回新的 overlay 实例。
3. 把 `effectiveToolProvider.getToolSet()` 传给 LLM `reason()`。
4. LLM 返回 tool calls 后，通过 `executeTools(effectiveToolProvider, ...)` 执行。

## 错误处理

- **MCP 连接错误**：沿用 `McpConnectionManager` 现有机制。`connectAll()` 会跳过失败连接，只返回成功的 providers，并在内部 `states` Map 中记录每个 server 的状态（`connected` / `error`）。`createAgentFromEnv` 不因此失败。
- **工具名冲突**：沿用 `CompositeToolProvider` 逻辑。MCP 工具以 `{serverKey}__{name}` 前缀命名；若仍冲突，MCP 覆盖本地并打印 warning。
- **`read_skill` 注册失败**：`compose()` 直接抛出，让 `runAgent` 启动失败。
- **多次 `compose()` 安全性**：每次返回新实例，原始 providers 不被修改，无状态污染。

## 测试策略

- **`DefaultToolComposer` 单元测试**：
  - 无 MCP 时，直接基于 `toolProvider` 注册 `read_skill`；
  - 有 MCP 时，正确构造 `CompositeToolProvider`；
  - 多次调用 `compose()` 返回不同实例，原始 provider 不被污染；
  - 最终 `ToolSet` 包含 `read_skill`。
- **`runAgent` 测试**：mock `toolComposer.compose()` 返回固定 provider，验证 runAgent 正确调用并传给 LLM/execute。
- **`createAgentFromEnv` 测试**：验证返回的 `AgentContext` 包含 raw `toolProvider`、`mcpProviders`、`skillProvider`、`toolComposer`，不再持有预合并的 `CompositeToolProvider`。
- **集成测试**：带 MCP mock 走完整流程，确认 tool 整合后可用。

## 影响范围

- `packages/core/src/agent-factory.ts`
- `packages/core/src/agent-context.ts`
- `packages/core/src/run-agent.ts`
- 新增 `packages/core/src/sdk/tool-composer.ts`
- 新增 `packages/core/src/tool-composer.ts`
- 可能新增 `OverlayToolProvider`（位置待定，建议放在 `packages/core/src/overlay-tool-provider.ts` 或并入 `tool-composer.ts` 内部）
- 相关测试文件

## 后续可扩展点

- 统一 `toolPolicy` 对本地 tools 和 MCP tools 的应用：可在 `DefaultToolComposer` 中集中处理。
- 动态重新加载 MCP 或 skills：由于合并发生在 `runAgent` 启动时，未来可以在每次新对话前重新 `compose()`。
