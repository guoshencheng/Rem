# CoreAgent Session 与 Turn/Loop 职责分离设计

> 状态：待实现评审
> 日期：2026-06-12

---

## 1. 背景与问题

当前 `CoreAgent.initialize()` 直接接收 `messages` 参数，由外部传入历史消息：

```ts
async initialize(options?: { sessionId?: string; messages?: ModelMessage[] }): Promise<void>
```

这导致 `CoreAgent` 与消息来源、持久化方式耦合，也模糊了“运行 Agent”和“管理对话历史”的边界。

本设计目标：

1. 让 `CoreAgent` 自己维护 Session（通过协议化接口）。
2. 将一次用户回复的完整 ReAct 过程抽成无状态纯函数（`TurnRunner`）。
3. 明确 `Agent`、`Turn`、`Loop` 三层职责。

---

## 2. 设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| Session 维护方式 | 协议化 `SessionProvider` | CoreAgent 管理 Session 生命周期，存储实现可替换 |
| 单次用户回复执行 | 无状态 `TurnRunner` | 易测试、易复用、不依赖外部状态 |
| ReAct 迭代 | `LoopStrategy` 策略接口 | 支持未来扩展 Plan-and-Solve、Reflexion 等模式 |
| 状态更新机制 | `TurnHooks` 回调 + `EventBus` 事件 | 回调处理必须同步的状态写入，事件处理观测/切面逻辑 |
| user 消息归属 | CoreAgent 在调用 Turn 前加入 Session | 职责清晰，Turn 只返回 assistant/tool 增量 |

---

## 3. 总体架构

```
┌─────────────────────────────────────────────────────────┐
│  Interface 层 (CLI / Gateway)                            │
│  ── 创建 CoreAgent，传入 SessionProvider                 │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│  CoreAgent                                              │
│  ── 生命周期、Session 管理、状态机、预算、事件总线         │
│  ── 调用 TurnRunner 执行一次用户回复                      │
│  ── 通过回调同步更新 Session                              │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│  SessionProvider (协议)                                  │
│  ── 默认 InMemorySessionProvider                        │
│  ── 未来可替换 SQLite / File / Remote                   │
└─────────────────────────────────────────────────────────┘

        ┌─────────────┴─────────────┐
        ▼                           ▼
┌───────────────┐         ┌─────────────────┐
│  EventBus     │         │  TurnRunner     │
│  (事件总线)    │         │  (无状态纯函数)  │
│  ── 切面逻辑   │         │  ── 单次用户回复 │
│  ── 日志/安全  │         │  ── 内部多轮 ReAct│
│  ── 预算检查   │         │  ── 调用回调/事件 │
└───────────────┘         └─────────────────┘
                                  │
                          ┌───────▼────────┐
                          │  LoopStrategy  │
                          │  ReAct 迭代策略 │
                          └────────────────┘
```

---

## 4. 核心接口

### 4.1 Session 与 SessionProvider

```ts
interface Session {
  sessionId: string;
  conversation: ModelMessage[];
  currentTurn: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface SessionProvider {
  create(): Promise<Session>;
  load(sessionId: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
}
```

**说明：**

- `Session` 是可序列化的 POJO，便于持久化。
- `CoreAgent` 内部维护当前 `Session` 实例，运行结束后调用 `sessionProvider.save()`。
- 默认提供 `InMemorySessionProvider`，测试和简单场景够用。

### 4.2 CoreAgent

```ts
interface CoreAgentConfig {
  name: string;
  model: LanguageModel;
  sessionProvider?: SessionProvider;
  turnRunner?: TurnRunner;
  budget?: IterationBudget;
  toolProvider?: ToolProvider;
  memoryProvider?: MemoryProvider;
  errorHandler?: ErrorHandler;
  budgetPolicy?: BudgetPolicy;
  compressor?: ContextCompressor;
}

class CoreAgent {
  constructor(config: CoreAgentConfig);

  async initialize(options?: { sessionId?: string }): Promise<void>;
  async run(input: UserInput): Promise<AgentOutput>;
  async pause(): Promise<void>;
  async resume(): Promise<void>;
  async reset(): Promise<void>;

  on(event: AgentEvent, handler: EventHandler): () => void;
  once(event: AgentEvent, handler: EventHandler): void;
}
```

**说明：**

- `initialize()` 不再接收 `messages`，而是根据 `sessionId` 加载已有 Session 或创建新 Session。
- `run()` 调用 `TurnRunner`，并通过回调把新增消息写回 Session。

### 4.3 TurnRunner

```ts
interface TurnContext {
  input: UserInput; // 原始用户输入，用于事件/日志；conversation 中已包含对应的 user message
  conversation: ModelMessage[]; // 已包含本次 user 输入的完整对话上下文
  systemPrompt: string;
  availableTools: ToolDefinition[];
  model: LanguageModel;
  budget: IterationBudget;
}

interface TurnResult {
  output: AgentOutput;
  newMessages: ModelMessage[];
  toolCallRecords: ToolCallRecord[];
  usage: LanguageModelUsage;
}

interface TurnHooks {
  // 必须由 CoreAgent 同步处理，用于更新 Session
  onMessageAdded(msg: ModelMessage): void;
  onToolCallRecorded(record: ToolCallRecord): void;
}

interface TurnRunner {
  run(ctx: TurnContext, hooks: TurnHooks): Promise<TurnResult>;
}
```

**说明：**

- `TurnRunner.run()` 是核心无状态函数：输入上下文，输出结果。
- `newMessages` 只包含本轮新增的 assistant/tool 消息，**不包含** input user 消息。
- `TurnHooks` 只保留“必须同步”的两个回调，其他走 EventBus。

### 4.4 LoopStrategy

```ts
interface LoopContext {
  conversation: ModelMessage[];
  systemPrompt: string;
  availableTools: ToolDefinition[];
  model: LanguageModel;
  budget: IterationBudget;
}

interface LoopResult {
  finalOutput: AgentOutput;
  newMessages: ModelMessage[];
  toolCallRecords: ToolCallRecord[];
  usage: LanguageModelUsage;
  iterations: number;
}

interface LoopStrategy {
  iterate(ctx: LoopContext, hooks: TurnHooks): Promise<LoopResult>;
}
```

**说明：**

- `LoopStrategy` 是 Turn 内部的 ReAct 迭代策略。
- 默认实现 `ReactLoop`。
- 未来可扩展 `PlanAndSolveLoop`、`ReflexionLoop` 等。

默认 TurnRunner 实现：

```ts
class ReactTurnRunner implements TurnRunner {
  constructor(private loopStrategy: LoopStrategy) {}

  async run(ctx: TurnContext, hooks: TurnHooks): Promise<TurnResult> {
    const loopResult = await this.loopStrategy.iterate(
      {
        conversation: ctx.conversation,
        systemPrompt: ctx.systemPrompt,
        availableTools: ctx.availableTools,
        model: ctx.model,
        budget: ctx.budget,
      },
      hooks,
    );

    return {
      output: loopResult.finalOutput,
      newMessages: loopResult.newMessages,
      toolCallRecords: loopResult.toolCallRecords,
      usage: loopResult.usage,
    };
  }
}
```

---

## 5. 职责划分

| 概念 | 职责 | 状态 | 类比 |
|------|------|------|------|
| **Agent（CoreAgent）** | 管理 Session 生命周期、维护 conversation、调用 Turn、处理事件/回调、持久化 | 有状态 | 操作系统进程管理器 |
| **Turn** | 处理一次用户输入到一次最终助手回复的完整过程 | 无状态 | 一次函数调用 |
| **Loop** | Turn 内部的 ReAct 迭代策略 | 策略/算法 | CPU 执行单元 |

**调用关系：**

```
CoreAgent.run(input)
  ├─ 从 SessionProvider 加载/创建 Session
  ├─ 把 input 加入 Session.conversation
  ├─ 调用 TurnRunner.run(ctx, hooks)
  │     ├─ LoopStrategy.iterate() 执行多轮 ReAct
  │     │   ├─ 调用 LLM
  │     │   ├─ 执行 tool
  │     │   └─ 观察结果，决定是否继续
  │     └─ 返回 TurnResult
  ├─ 把 TurnResult.newMessages 追加到 Session
  ├─ 保存 Session
  └─ 返回 AgentOutput
```

---

## 6. 数据流

一次 `CoreAgent.run(input)` 的完整流程：

1. **加载 Session**
   - 如果 `initialize()` 时传了 `sessionId`，调用 `sessionProvider.load(sessionId)`。
   - 否则调用 `sessionProvider.create()` 创建新 Session。

2. **加入 user 消息**
   - CoreAgent 把 `input` 转换成 `ModelMessage`。
   - 把 user 消息追加到 `session.conversation`。
   - 此步骤在调用 TurnRunner 之前完成，因此 TurnRunner 收到的 `conversation` 已包含 user 输入。

3. **调用 TurnRunner**
   - CoreAgent 构建 `TurnContext`，其中 `conversation` 是已包含 user 消息的 Session conversation 快照（TurnRunner 不应修改传入数组）。
   - CoreAgent 实现 `TurnHooks`，在 hooks 内部同步更新 `session.conversation` 和 `session.toolCalls`。
   - 调用 `turnRunner.run(ctx, hooks)`。
   - TurnRunner 内部通过 LoopStrategy 执行多轮 ReAct。
   - 每新增一条 assistant/tool 消息，TurnRunner 调用 `hooks.onMessageAdded()`，实际由 CoreAgent 追加到 Session。
   - 每执行一次 tool，TurnRunner 调用 `hooks.onToolCallRecorded()`，实际由 CoreAgent 追加到 Session。

4. **追加增量消息**
   - TurnRunner 返回 `TurnResult.newMessages`。
   - CoreAgent 把 `newMessages` 追加到 `session.conversation`。

5. **保存 Session**
   - CoreAgent 调用 `sessionProvider.save(session)`。

6. **返回结果**
   - CoreAgent 返回 `AgentOutput`。

---

## 7. 事件总线

TurnRunner 内部在以下时机 emit 事件：

| 事件 | 时机 | 用途 |
|------|------|------|
| `turn:before` | 开始执行本次用户回复 | 记忆注入、预算检查 |
| `llm:before` | 单次 LLM 调用前 | 日志、安全检查 |
| `llm:after` | 单次 LLM 调用后 | 日志、用量统计 |
| `tool:before` | 工具调用前 | 安全拦截 |
| `tool:after` | 工具调用后 | 日志、记录 |
| `tool:error` | 工具调用失败 | 错误处理 |
| `turn:after` | 本次用户回复结束 | 技能提醒、压缩 |

CoreAgent 和其他插件通过 `EventBus` 订阅，用于日志、安全、预算检查等观测/切面逻辑。

---

## 8. 错误处理

| 层级 | 错误类型 | 处理方式 |
|------|---------|---------|
| **Loop** | LLM 调用失败、tool 解析失败 | 抛出异常，交给 Turn 处理 |
| **Turn** | Loop 多次失败、budget 耗尽 | 封装成 `TurnError`，返回失败结果或抛出 |
| **CoreAgent** | Turn 失败、Session 加载/保存失败 | 进入 `error` 状态，emit `core-agent:error`，决定重试或停止 |
| **SessionProvider** | 存储失败 | 抛异常，CoreAgent 进入 error 状态 |

**关键原则：**

- Turn 内部如果某次 Loop 迭代失败，可以根据 `ErrorHandler` 决定是否重试本轮。
- 如果 Turn 最终失败，CoreAgent 可以选择：
  - 把错误信息作为 assistant 消息返回（优雅降级）
  - 进入 `error` 状态并抛出

---

## 9. 测试策略

| 测试对象 | 测试内容 |
|---------|---------|
| `TurnRunner` | 给定固定 conversation 和 mock LLM/tool，验证输出消息列表正确 |
| `LoopStrategy` | 验证 ReAct 迭代在 tool/no-tool 场景下停止条件正确 |
| `CoreAgent` | mock SessionProvider 和 TurnRunner，验证 Session 加载/保存/追加逻辑 |
| `SessionProvider` 实现 | 验证 create/load/save 语义 |

因为 Turn 是无状态纯函数，测试最简单：输入确定，输出就应该确定。

---

## 10. 实现范围

本次设计涉及的主要变更：

1. 新增 `Session`、`SessionProvider` 接口及默认实现。
2. 新增 `TurnRunner`、`TurnContext`、`TurnResult`、`TurnHooks` 接口。
3. 新增 `LoopStrategy`、`LoopContext`、`LoopResult` 接口。
4. 重构 `CoreAgent`：
   - 移除 `initialize({ messages })` 参数。
   - 增加对 `SessionProvider` 的依赖。
   - `run()` 中负责 Session 加载、user 消息追加、调用 TurnRunner、保存 Session。
5. 将现有 `AgentLoop` 拆分为：
   - `ReactLoop implements LoopStrategy`
   - `ReactTurnRunner implements TurnRunner`

---

## 11. 待确认问题

1. `SessionProvider.save()` 是否每次 `run()` 后都调用？还是提供批量/定时保存策略？
   - 建议：默认每次 `run()` 后保存，未来可扩展保存策略。

2. `Session.metadata` 的用途是否需要现在明确？
   - 建议：先保留为扩展字段，不强制使用。

3. 现有 `AgentState` 类是否被 `Session` 完全替代？
   - 建议：`AgentState` 保留为 CoreAgent 内部运行时状态（status、budget），`Session` 负责可持久化的对话状态。
