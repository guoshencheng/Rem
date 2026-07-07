# Agent 执行流程与 Provider 集群治理设计

> 目标：梳理出一条干净的 `runAgent` → `LoopStrategy` → Provider 执行链路，建立职责明确、可快速切换的 Provider 集群，并明确 Agent 到前端的流式数据流。
>
> 设计日期：2026-07-07
> 治理范围：`packages/core`、`packages/bridge`、`packages/web`，`packages/tui` 视为废弃不处理。

---

## 1. 核心设计决策

### 1.1 runAgent 是流程抽象层

`runAgent` 不再直接调用 LLM、工具或控制 ReAct 循环细节。它的职责是：

- 加载/保存 Session
- 创建运行时资源（AgentState、AgentStreamController、EventBus）
- 预算检查
- 构建上下文（ContextProvider）
- 可选压缩（CompressProvider）
- fork 标题生成（TitleProvider）
- 启动 LoopStrategy Provider
- 错误处理
- 关闭流

`runAgent` 只定义"流程步骤的顺序"，不定义"每个步骤怎么实现"。

### 1.2 Turn 只包含 Reason 和 Execute

`LoopStrategy` 是 Turn 级别的 Provider，代表一个完整的 Agent 推理策略。默认实现 `ReactLoop` 内部只包含标准的 ReAct 循环：

```
while (step < maxSteps && !aborted) {
  reasonResult = ReasonProvider.reason(...)
  if (reasonResult.toolCalls.length === 0) break
  ExecuteProvider.execute(reasonResult.toolCalls, ...)
  step++
}
```

`LoopStrategy` 只负责流程控制：什么时候调用 Reason、什么时候调用 Execute、什么时候终止。它不关心 LLM 怎么调、stream 怎么发、工具怎么执行。

### 1.3 Provider 分层

| 层级 | Provider | 职责 |
|---|---|---|
| 流程编排层 | `runAgent` | 组装 Provider、管理生命周期 |
| Turn 流程层 | `LoopStrategy` | ReAct / Plan-and-Solve 等循环控制 |
| Turn 节点层 | `ReasonProvider`、`ExecuteProvider` | 单次推理 / 单次执行 |
| 上下文层 | `ContextProvider`、`CompressProvider` | 构建上下文 / 压缩上下文 |
| 基础设施层 | `LLMProvider`、`ToolProvider` | 具体 SDK 调用 / 工具注册执行 |

### 1.4 Bridge 与前端链路保持不变

当前 Bridge 层（`IAgentService` → `AgentService`/`AgentRemoteService` → `BroadcastBus` → SSE → `useAgentBus` → `useAgents`）已经符合目标，本次不做结构性改动。Core 的 chunk 类型和消费方式保持不变，Web 零改动。

---

## 2. runAgent 的职责边界

### 2.1 输入输出

```typescript
export interface RunAgentParams {
  input: UserInput;
  sessionId: string;
  signal?: AbortSignal;
  pm: ProviderManager;
}

export interface RunAgentResult {
  stream: AgentStream;
  output: Promise<AgentOutput>;
}
```

输入输出不变，保证 Bridge 层无需改动。

### 2.2 执行步骤

```
runAgent(params)
  1.  session = SessionProvider.load(sessionId)
  2.  state = new AgentState(session)
  3.  controller = new AgentStreamController()
  4.  events = new EventBus()
  5.  if !BudgetProvider.check(state, startTime) → finish("Budget exceeded")
  6.  state.addMessage(userMessage)
  7.  SessionProvider.save(state.session)
  8.  fork TitleProvider.generateTitle(...) // 异步旁路
  9.  { system, messages } = ContextProvider.build(state)
  10. if CompressProvider.shouldCompress(state)
        messages = CompressProvider.compress(messages)
  11. result = LoopStrategy.run({ state, system, messages, ... })
  12. 合并 result.newMessages 到 state
  13. state.status = 'idle'
  14. SessionProvider.save(state.session)
  15. controller.finish(output)
  16. catch error → ErrorProvider.classify → controller.fail(error)
```

### 2.3 不再做的事情

| 原职责 | 新归属 |
|---|---|
| 直接调用 LLM SDK | `ReasonProvider` |
| 直接执行工具 | `ExecuteProvider` |
| ReAct 循环控制 | `LoopStrategy` |
| 上下文构建 | `ContextProvider` |
| 重试逻辑 | `ReasonProvider` / `ErrorProvider` |
| thinking tag 拆分 | `ReasonProvider` |
| 工具结果格式化 | `ExecuteProvider` |

---

## 3. Provider 接口契约

### 3.1 LoopStrategy

```typescript
// sdk/loop-strategy.ts
export interface LoopStrategy {
  run(ctx: LoopContext): Promise<LoopResult>;
}

export interface LoopContext {
  state: AgentState;
  system: string;
  messages: ModelMessage[];
  budget: IterationBudget;
  signal?: AbortSignal;
  maxSteps?: number;
  workspaceRoot: string;
  readOnly?: boolean;
  agentName?: string;
  sessionId?: string;
}

export interface LoopResult {
  content: string;
  newMessages: ModelMessage[];
  usage: LanguageModelUsage;
}
```

`LoopStrategy` 是 Turn 级别的 Provider kind。默认实现为 `ReactLoop`。

### 3.2 ReasonProvider

```typescript
// sdk/reason-provider.ts
export interface ReasonProvider {
  reason(
    params: ReasonParams,
    ctx: ReasonContext,
    emit: (chunk: AgentStreamChunk) => void | Promise<void>,
  ): Promise<ReasonOutput>;
}

export interface ReasonParams {
  model: string;
  apiKey: string;
  baseURL?: string;
  system?: string;
  messages: ModelMessage[];
  tools?: ToolSet;
}

export interface ReasonContext {
  signal?: AbortSignal;
  sessionId?: string;
}

export interface ReasonOutput {
  text: string;
  toolCalls: ToolCall[];
  reasoning?: string;
  usage: LanguageModelUsage;
  finishReason: string;
}
```

`emit` 回调用于把流式 chunk 实时推送到 `AgentStreamController`。`ReasonProvider` 内部负责：

- 调用 `LLMProvider.stream()`
- 重试机制（配合 `ErrorProvider`）
- thinking / reasoning 拆分
- tool-call 解析
- 结果聚合

### 3.3 ExecuteProvider

```typescript
// sdk/execute-provider.ts
export interface ExecuteProvider {
  execute(
    toolCalls: ToolCall[],
    ctx: ExecuteContext,
    emit: (chunk: AgentStreamChunk) => void | Promise<void>,
  ): Promise<ToolResult[]>;
}

export interface ExecuteContext {
  cwd: string;
  workspaceRoot: string;
  signal?: AbortSignal;
  agentName?: string;
  readOnly?: boolean;
  sessionId: string;
}
```

`ExecuteProvider` 内部负责：

- 审批检查（ApprovalProvider）
- 工具策略过滤（ToolPolicy）
- 调用 `ToolProvider.execute()`
- 生成 `tool-result` chunk

### 3.4 ContextProvider

```typescript
// sdk/context-provider.ts
export interface ContextProvider {
  build(state: AgentState): Promise<{ system: string; messages: ModelMessage[] }>;
}
```

由当前 `MemoryProvider` 升级/重命名而来。内部可调用 `SkillProvider` 注入 skills。

### 3.5 CompressProvider

```typescript
// sdk/compressor.ts（已存在，保留接口）
export interface ContextCompressor {
  shouldCompress(state: AgentState): boolean;
  compress(messages: ModelMessage[]): Promise<ModelMessage[]>;
}
```

保留现有接口，作为可选流程节点。

### 3.6 LLMProvider

保持现有 `llm/api-registry.ts` 的接口：

```typescript
// llm/api-registry.ts
export interface LLMProvider {
  stream(params: StreamParams): AsyncIterable<StreamChunk>;
}
```

属于基础设施层，被 `ReasonProvider` 调用。

### 3.7 Provider 调用关系

```
runAgent
  ├── ContextProvider.build()
  ├── CompressProvider (optional)
  └── LoopStrategy.run()
        ├── ReasonProvider.reason()
        │     └── LLMProvider.stream()
        └── ExecuteProvider.execute()
              └── ToolProvider.execute()
```

---

## 4. LoopStrategy 默认实现（ReactLoop）

### 4.1 文件位置

`packages/core/src/plugins/loop/react/index.ts`

### 4.2 核心逻辑

```typescript
export class ReactLoop implements LoopStrategy {
  constructor(
    private reasonProvider: ReasonProvider,
    private executeProvider: ExecuteProvider,
  ) {}

  async run(ctx: LoopContext): Promise<LoopResult> {
    const state = ctx.state;
    const newMessages: ModelMessage[] = [];
    let content = '';
    let usage: LanguageModelUsage = zeroUsage();

    const assistantMsg = this.createAssistantMessage(state);
    newMessages.push(assistantMsg);

    let step = 1;
    const maxSteps = ctx.maxSteps ?? DEFAULT_MAX_STEPS;

    while (step <= maxSteps) {
      if (ctx.signal?.aborted) throw new Error('Aborted');

      const reasonResult = await this.reasonProvider.reason(
        this.buildReasonParams(ctx),
        this.buildReasonContext(ctx),
        (chunk) => this.controller.append(chunk),
      );

      this.appendToAssistantMessage(assistantMsg, reasonResult);
      content = reasonResult.text;
      usage = addUsage(usage, reasonResult.usage);

      if (reasonResult.toolCalls.length === 0) break;

      const toolResults = await this.executeProvider.execute(
        reasonResult.toolCalls,
        this.buildExecuteContext(ctx),
        (chunk) => this.controller.append(chunk),
      );

      const toolMsgs = this.buildToolMessages(reasonResult.toolCalls, toolResults);
      for (const msg of toolMsgs) {
        state.addMessage(msg);
        newMessages.push(msg);
      }

      step++;
    }

    return { content, newMessages, usage };
  }
}
```

### 4.3 关键变化

1. **删除 `ReactTurnRunner`**：循环逻辑完全内聚到 `ReactLoop.run()`，消除 `runAgent → ReactTurnRunner → ReactLoop` 三层嵌套。
2. **`ReactLoop` 只依赖 `ReasonProvider` + `ExecuteProvider`**：不直接依赖 LLM SDK 或 ToolProvider。
3. **Assistant message 由 `ReactLoop` 创建**：因为它掌握 ReAct 的语义。
4. **Step 计数内聚**：不再是外层 `TurnRunner` 控制。

### 4.4 可替换性

未来新增其他策略时，只需实现 `LoopStrategy` 接口并注册：

```typescript
// plugins/loop/plan-and-solve/index.ts
export class PlanAndSolveLoop implements LoopStrategy {
  async run(ctx: LoopContext): Promise<LoopResult> {
    // 1. Plan
    // 2. Execute
    // 3. Synthesize
  }
}
```

`runAgent` 无需改动。

---

## 5. Bridge 层与前端流程

### 5.1 保持现有架构

Bridge 层已经符合目标架构，本次治理不做结构性改动：

- `IAgentService` 作为统一服务接口
- `AgentService` 服务端直调 `core.runAgent()`
- `AgentRemoteService` 浏览器端 HTTP + SSE 客户端
- `BroadcastBus` 进程内事件广播
- `response.ts` / `sse.ts` 负责 SSE 编解码
- `stream-reducer.ts` 供前端复用

### 5.2 完整数据流

```
用户输入
  │
  ▼
[web] useAgents.send(content)
  │
  ▼
[web] AgentRemoteService.run(sessionId, content)
  │
  ▼ POST /api/agent/run
[web route] AgentService.run(sessionId, content)
  │
  ▼
[core] runAgent({ input, sessionId, signal, pm })
  │
  ▼ AgentStreamController.fullStream
[bridge] AgentService.drive()
  │
  ├── 消费 chunk
  │     ├── SessionActivityTracker.applyChunk() → 推导 activity
  │     ├── StreamingSnapshots.update()         → 重连快照
  │     └── BroadcastBus.publish({ type: 'chunk', chunk })
  │
  └── 完成/错误时
        ├── BroadcastBus.publish({ type: 'session-end' })
        └── BroadcastBus.publish({ type: 'session-error', error })
  │
  ▼ SSE
[web] useAgentBus
  │
  ▼
[web] useAgents 更新 sessionMapRef
  │
  ▼
React 渲染 MessageList / ReasoningBlock / ToolCallBlock
```

### 5.3 前端零改动

`packages/web` 在本次治理中不做修改。所有 chunk 类型、事件类型、SSE 协议保持当前契约。

---

## 6. 文件重组计划

### 6.1 Core 包新增文件

| 文件 | 职责 |
|---|---|
| `sdk/reason-provider.ts` | `ReasonProvider` 接口定义 |
| `sdk/execute-provider.ts` | `ExecuteProvider` 接口定义 |
| `sdk/context-provider.ts` | `ContextProvider` 接口定义 |
| `sdk/loop-strategy.ts` | `LoopStrategy` 接口定义（从 `loop-types.ts` 移入） |
| `plugins/loop/react/index.ts` | `ReactLoop` 默认实现 |
| `plugins/reason/default/index.ts` | `DefaultReasonProvider` |
| `plugins/execute/default/index.ts` | `DefaultExecuteProvider` |

### 6.2 Core 包修改文件

| 文件 | 修改内容 |
|---|---|
| `run-agent.ts` | 减薄，改为调用 `ContextProvider`、`CompressProvider`、`LoopStrategy` |
| `loop-types.ts` | 移除 `LoopStrategy` 接口，保留 `LoopContext`/`LoopResult` |
| `loop-strategy.ts` | 移除 `ReactLoop` 实现，保留兼容导出或作为 barrel |
| `turn.ts` | 删除 `ReactTurnRunner`，循环逻辑并入 `ReactLoop` |
| `provider-manager.ts` | 注册新的 Provider kinds：`reason`、`execute`、`loopStrategy` |
| `sdk/index.ts` | 导出新的 Provider 接口 |
| `plugins/memory/simple/index.ts` | 适配为 `ContextProvider` 实现 |
| `plugins/index.ts` | 内置 loader 映射新增 `reason/default`、`execute/default`、`loop/react` |

### 6.3 Core 包删除/合并文件

| 文件 | 处理 |
|---|---|
| `turn.ts` | 删除，`ReactTurnRunner` 逻辑合并入 `ReactLoop` |

### 6.4 Bridge 包

不做结构性改动。可选微调 `AgentService.drive()` 内部事件分类，但不是必须的。

### 6.5 Web 包

零改动。

---

## 7. ProviderManager 注册变更

### 7.1 新增 ProviderKind

```typescript
export type ProviderKind =
  | 'tool'
  | 'memory'       // 可逐步迁移为 'context'
  | 'context'      // 新增
  | 'skill'
  | 'session'
  | 'compressor'
  | 'budget'
  | 'error'
  | 'config'
  | 'loopStrategy'
  | 'turnRunner'   // 废弃，后续移除
  | 'title'
  | 'approval'
  | 'state'
  | 'reason'       // 新增
  | 'execute';     // 新增
```

### 7.2 默认注册映射

```typescript
{
  session: 'file',           // 或 local
  context: 'simple',         // 原 memory/simple
  compressor: 'no-op',
  budget: 'fixed',
  error: 'simple',
  skill: 'file',
  title: 'llm',
  state: 'in-memory',
  loopStrategy: 'react',
  reason: 'default',
  execute: 'default',
}
```

---

## 8. 测试策略

### 8.1 单元测试

| 目标 | 覆盖点 |
|---|---|
| `ReactLoop` | 循环终止条件、tool-call 触发 execute、maxSteps 限制、abort 响应 |
| `DefaultReasonProvider` | 调用 LLMProvider、重试逻辑、thinking 拆分、tool-call 解析 |
| `DefaultExecuteProvider` | 调用 ToolProvider、审批阻塞、错误 chunk 生成 |
| `runAgent` | 编排流程、session 保存、title fork、错误收尾 |

### 8.2 集成测试

- `AgentService` → `runAgent` → `BroadcastBus` 的端到端 chunk 流
- 替换 `LoopStrategy` 后 `runAgent` 仍正常工作

---

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| `MemoryProvider` 重命名为 `ContextProvider` 导致外部调用点改动 | 先保留 `memory` kind 别名，逐步迁移 |
| `ReactTurnRunner` 删除影响现有测试 | 同步重构测试到 `ReactLoop` |
| Provider 增加导致初始化复杂度上升 | `ProviderManager` 按 kind 默认加载，调用方无感知 |
| 流式 chunk 行为变化 | 保持 `AgentStreamChunk` 类型不变，逐个 chunk 对比测试 |

---

## 10. 实施优先级

### Phase 1：接口与默认实现

1. 新建 `sdk/reason-provider.ts`、`sdk/execute-provider.ts`、`sdk/context-provider.ts`、`sdk/loop-strategy.ts`
2. 新建 `plugins/reason/default/`、`plugins/execute/default/`、`plugins/loop/react/`
3. 实现 `DefaultReasonProvider`、`DefaultExecuteProvider`、`ReactLoop`

### Phase 2：重构 runAgent

1. 修改 `run-agent.ts`，调用新的 Provider
2. 删除 `turn.ts`，移除 `ReactTurnRunner`
3. 清理 `loop-strategy.ts`，移除旧的 `ReactLoop` 实现

### Phase 3：ProviderManager 与注册

1. 在 `ProviderKind` 中新增 `reason`、`execute`、`context`
2. 更新 `ProviderManager` 默认注册映射
3. 更新 `plugins/index.ts` 内置 loader

### Phase 4：测试与验证

1. 更新/新增单元测试
2. 运行 `pnpm typecheck && pnpm test`
3. 手动验证 Web UI 流式输出正常

---

## 11. 与现有 target-architecture.md 的关系

本设计基于 `docs/target-architecture.md` 中"`runAgent` 作为唯一执行入口"的决策，进一步细化：

- 明确 `LoopStrategy` 作为一等 Provider
- 新增 `ReasonProvider` / `ExecuteProvider` 作为 Turn 内部节点
- 明确 `runAgent` 的编排职责边界
- 明确 Bridge / Web 层在本次治理中不做结构性改动

---

*Design by: Claude Code*
