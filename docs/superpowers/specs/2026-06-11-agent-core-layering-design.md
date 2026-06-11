# Agent Core 分层设计 — 接口驱动架构

> 基于 OpenClaw 和 Hermes Agent 外围编排调研，采用纯接口驱动方案。
> 先定义接口契约 + 核心流程，接口实现渐进式补齐。

---

## 1. 背景与目标

### 1.1 当前状态

`packages/core` 是一个极简 Agent 框架（8 个文件，约 300 行），核心代码：

- `core-agent.ts` — 外层 `while` 循环，调用 `loop.executeTurn()`
- `loop.ts` — 调用 `generateText()`，检测到 `toolCalls` 但不执行工具
- `state.ts` — 会话状态（消息历史、预算、状态机）
- `budget.ts` — 轮次/错误预算管理
- `events.ts` — 事件总线

**关键缺口**：
- 没有工具执行引擎
- 没有 API 错误恢复
- 没有上下文压缩
- 没有超时处理
- 没有不完整轮次检测

### 1.2 设计目标

构建 **Agent-first 的通用 Agent Harness 系统**，`packages/core` 作为不可替换的核心引擎。

核心原则：
1. **Core 最小化但完整** — 只包含 Agent 生命周期、ReAct 循环编排、事件系统
2. **SDK 定义契约** — 所有可扩展点通过接口抽象，先定义后实现
3. **Plugin 可替换** — 所有能力通过插件实现，包括默认能力
4. **渐进式实现** — P0 用内存版实现让核心跑起来，后续逐步替换为生产级实现

---

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        Core 层（编排骨架）                        │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │
│  │  harness.ts │ │   loop.ts   │ │   state.ts  │               │
│  │  生命周期    │ │  ReAct 循环  │ │  会话状态    │               │
│  │  +外层循环   │ │  +消息组装   │ │  +检查点    │               │
│  │             │ │  +工具执行   │ │             │               │
│  └─────────────┘ └─────────────┘ └─────────────┘               │
│  ┌─────────────┐                                               │
│  │  events.ts  │  ← 事件总线                                    │
│  └─────────────┘                                               │
├─────────────────────────────────────────────────────────────────┤
│                      SDK 层（策略接口）                           │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │ToolProvider  │ │MemoryProvider│ │ContextCompres│            │
│  │ 工具注册/执行 │ │ 上下文构建    │ │   压缩策略    │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│  ┌──────────────┐ ┌──────────────┐                             │
│  │ ErrorHandler │ │ BudgetPolicy  │                             │
│  │ 错误分类/恢复 │ │ 预算/超时     │                             │
│  └──────────────┘ └──────────────┘                             │
├─────────────────────────────────────────────────────────────────┤
│                    默认实现层（P0 内存版）                        │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐      │
│  │InMemoryToolProv│ │SimpleMemoryProv│ │ NoOpCompressor │      │
│  │  (Map 注册表)   │ │ (消息列表)      │ │   (占位)        │      │
│  └────────────────┘ └────────────────┘ └────────────────┘      │
│  ┌────────────────┐ ┌────────────────┐                         │
│  │SimpleErrorHandl│ │FixedBudgetPoli │                         │
│  │ (基础分类)      │ │ (固定轮次)      │                         │
│  └────────────────┘ └────────────────┘                         │
└─────────────────────────────────────────────────────────────────┘
```

**关键设计决策**：

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 架构模式 | 纯接口驱动 | Core 只保留编排骨架，所有"怎么做"委托给策略接口 |
| LLM 调用 | 直接依赖 `vercel/ai` | SDK 已封装多 Provider、Tool Calling、Streaming，再包一层无意义 |
| 消息组装 | Core 负责 | 参考 OpenClaw，message 组装涉及清理/验证/格式转换，是循环的核心步骤 |
| 接口实现 | 先定义后实现 | P0 用内存版占位，后续逐步替换 |

---

## 3. Core 层设计

### 3.1 harness.ts — 生命周期管理 + 外层循环

职责：
- Agent 生命周期：创建、运行、暂停、恢复、停止、重置
- 外层 `while` 循环：驱动 attempt 执行 → 结果分类 → 重试/终止决策
- 持有所有策略接口的引用（通过构造函数注入）

外层循环伪代码：

```typescript
while (state.canContinue() && !interrupted) {
  // 1. 预算检查
  if (!budgetPolicy.checkTurn(state)) break;

  // 2. 执行一轮
  const result = await loop.executeTurn(ctx, state);

  // 3. 结果分类与决策
  if (result.completed) {
    return result.output;
  }

  // 4. 错误处理
  if (result.error) {
    const category = errorHandler.classify(result.error);
    if (!errorHandler.isRetryable(category)) break;
    // 注入重试指令到下一轮
    ctx.retryInstruction = errorHandler.getRetryInstruction(category);
  }

  turnNumber++;
}
```

### 3.2 loop.ts — ReAct 循环 + 消息组装

职责：
- 定义 ReAct 各阶段：prepare → reason → execute → observe
- **消息组装（PREPARE）** — 核心步骤，内聚在 loop 中
- 直接调用 `generateText()`（vercel/ai）
- 工具执行委托给 ToolProvider

Loop 阶段伪代码：

```typescript
async executeTurn(ctx, state) {
  emit('turn:before');

  // === 1. PREPARE: 消息组装 ===
  // 1.1 从 State 获取原始消息历史
  const rawMessages = state.conversation;

  // 1.2 清理/验证消息格式（tool use/result 配对检查）
  const sanitized = sanitizeMessages(rawMessages);

  // 1.3 委托 MemoryProvider 构建系统提示 + 上下文
  const { systemPrompt, contextMessages } = await memoryProvider.buildContext(state);

  // 1.4 组装最终 messages
  const messages = [
    ...contextMessages,
    { role: 'user', content: ctx.input.content },
  ];

  // 1.5 委托 ContextCompressor 处理溢出（如需要）
  if (compressor.shouldCompress(state)) {
    messages = await compressor.compress(messages);
  }

  // === 2. REASON: 调用 LLM ===
  emit('phase:reason:before');
  const response = await generateText({
    model: this.model,
    system: systemPrompt,
    messages,
    tools: toolProvider.getToolSet(),
  });
  emit('phase:reason:after');

  // === 3. EXECUTE: 工具执行 ===
  if (response.toolCalls.length > 0) {
    emit('phase:execute:before');
    const results = await toolProvider.execute(response.toolCalls);
    emit('phase:execute:after');

    // tool results 追加为 message
    for (const result of results) {
      state.addMessage({
        role: 'tool',
        toolCallId: result.toolCallId,
        content: result.output,
      });
    }
  }

  // === 4. OBSERVE: 状态更新 ===
  state.addMessage({
    role: 'assistant',
    content: response.text || response.toolCalls,
  });

  emit('turn:after');

  return {
    output: { content: response.text, completed: response.toolCalls.length === 0 },
    toolCalls: response.toolCalls,
    completed: response.toolCalls.length === 0,
  };
}
```

**消息组装是 loop 的核心职责**，参考 OpenClaw 的做法，包含：
- 消息历史清理（格式修复、配对检查）
- Provider 特定适配（thinking blocks、tool call IDs 等）
- 上下文压缩决策

### 3.3 state.ts — 会话状态

职责：
- 会话级数据：消息历史、当前 turn、预算引用、运行状态
- 检查点机制（未来支持会话恢复）

```typescript
class AgentState {
  readonly sessionId: string;
  conversation: ModelMessage[] = [];
  currentTurn = 0;
  budget: IterationBudget;
  status: AgentStatus = 'idle';

  addMessage(msg: ModelMessage): void;
  canContinue(): boolean;
  reset(): void;
  // 未来: saveCheckpoint(), loadCheckpoint()
}
```

### 3.4 events.ts — 事件总线

基本不变，现有实现已满足需求。保留优先级管理和钩子机制。

---

## 4. SDK 层接口定义

### 4.1 ToolProvider

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  // 未来: executionMode?: 'serial' | 'parallel' | 'readonly-parallel'
}

interface ToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

interface ToolResult {
  toolCallId: string;
  toolName: string;
  output: string;
  error?: string;
}

interface ToolProvider {
  /** 注册一个工具 */
  register(tool: ToolDefinition): void;

  /** 获取当前可用的工具集合（传给 generateText 的 tools 参数） */
  getToolSet(): ToolSet;

  /** 执行工具调用 */
  execute(calls: ToolCall[]): Promise<ToolResult[]>;
}
```

**设计说明**：
- `getToolSet()` 返回 `ai` SDK 的 `ToolSet` 类型，与 `generateText` 直接兼容
- `execute()` 内部自行决定串行/并行调度策略（P0 串行，P1 增加只读工具并行）

### 4.2 MemoryProvider

```typescript
interface MemoryProvider {
  /**
   * 构建系统提示 + 上下文消息列表
   * 返回的 messages 不包含当前用户输入（由 loop 组装）
   */
  buildContext(state: AgentState): Promise<{
    systemPrompt: string;
    messages: ModelMessage[];
  }>;

  /** 添加消息到记忆（P0 直接操作内存，未来可能触发持久化） */
  addMessage(msg: ModelMessage): void;
}
```

**设计说明**：
- P0 `SimpleMemoryProvider`：直接返回 `state.conversation` 作为 messages，系统提示固定为 `You are ${name}.`
- P1 可扩展为三层记忆（Working/Episodic/Semantic）

### 4.3 ContextCompressor

```typescript
interface ContextCompressor {
  /** 判断是否需要压缩 */
  shouldCompress(state: AgentState): boolean;

  /** 执行压缩，返回压缩后的消息列表 */
  compress(messages: ModelMessage[]): Promise<ModelMessage[]>;
}
```

**设计说明**：
- P0 `NoOpCompressor`：始终返回 `false`，占位用
- P1 实现滑动窗口或摘要压缩

### 4.4 ErrorHandler

```typescript
type ErrorCategory =
  | 'api_error'        // API 调用失败（网络/速率限制/Provider 错误）
  | 'invalid_response' // 模型返回格式错误
  | 'planning_only'    // 只给计划不行动
  | 'reasoning_only'   // 只推理不给答案
  | 'empty_response'   // 空响应
  | 'tool_error'       // 工具执行失败
  | 'timeout'          // 超时
  | 'unknown';         // 未知错误

interface ErrorHandler {
  /** 分类错误 */
  classify(error: unknown): ErrorCategory;

  /** 判断是否可重试 */
  isRetryable(category: ErrorCategory): boolean;

  /** 获取针对性重试指令（注入下一轮） */
  getRetryInstruction(category: ErrorCategory): string | undefined;
}
```

**设计说明**：
- 参考 OpenClaw 的针对性重试指令：`PLANNING_ONLY_RETRY_INSTRUCTION`、`REASONING_ONLY_RETRY_INSTRUCTION`、`EMPTY_RESPONSE_RETRY_INSTRUCTION`
- P0 `SimpleErrorHandler`：基础分类，无重试指令
- P1 增加不完整轮次检测和针对性指令

### 4.5 BudgetPolicy

```typescript
interface BudgetStatus {
  turnsRemaining: number;
  consecutiveErrors: number;
  atRisk: boolean;
  reason?: string;
}

interface BudgetPolicy {
  /** 检查本轮是否可继续 */
  checkTurn(state: AgentState): boolean;

  /** 检查是否超时 */
  checkTimeout(startTime: number): boolean;

  /** 检查是否触发断路器（连续空闲超时等） */
  shouldCircuitBreak(state: AgentState): boolean;

  /** 获取预算状态 */
  getStatus(state: AgentState): BudgetStatus;
}
```

**设计说明**：
- P0 `FixedBudgetPolicy`：固定轮次上限（默认 60）+ 单次调用超时
- P1 增加空闲超时断路器（参考 OpenClaw `MAX_CONSECUTIVE_IDLE_TIMEOUTS_BEFORE_OUTPUT`）

---

## 5. 默认实现层（P0）

### 5.1 InMemoryToolProvider

```typescript
class InMemoryToolProvider implements ToolProvider {
  private tools = new Map<string, ToolDefinition>();
  private executors = new Map<string, (input: unknown) => Promise<string>>();

  register(tool: ToolDefinition, executor: (input: unknown) => Promise<string>): void;
  getToolSet(): ToolSet;
  execute(calls: ToolCall[]): Promise<ToolResult[]>; // 串行执行
}
```

### 5.2 SimpleMemoryProvider

```typescript
class SimpleMemoryProvider implements MemoryProvider {
  private agentName: string;

  async buildContext(state: AgentState): Promise<{
    systemPrompt: string;
    messages: ModelMessage[];
  }> {
    return {
      systemPrompt: `You are ${this.agentName}.`,
      messages: state.conversation,
    };
  }

  addMessage(msg: ModelMessage): void {
    // P0: 无操作，loop 直接操作 state.conversation
  }
}
```

### 5.3 NoOpCompressor

```typescript
class NoOpCompressor implements ContextCompressor {
  shouldCompress(): boolean { return false; }
  async compress(messages: ModelMessage[]): Promise<ModelMessage[]> {
    return messages;
  }
}
```

### 5.4 SimpleErrorHandler

```typescript
class SimpleErrorHandler implements ErrorHandler {
  classify(error: unknown): ErrorCategory {
    if (error instanceof APICallError) return 'api_error';
    if (error instanceof ToolExecutionError) return 'tool_error';
    return 'unknown';
  }

  isRetryable(category: ErrorCategory): boolean {
    return category === 'api_error';
  }

  getRetryInstruction(): string | undefined {
    return undefined; // P0 无重试指令
  }
}
```

### 5.5 FixedBudgetPolicy

```typescript
class FixedBudgetPolicy implements BudgetPolicy {
  private maxTurns: number;
  private timeoutMs: number;

  checkTurn(state: AgentState): boolean {
    return state.currentTurn < this.maxTurns;
  }

  checkTimeout(startTime: number): boolean {
    return Date.now() - startTime < this.timeoutMs;
  }

  shouldCircuitBreak(): boolean {
    return false; // P0 无断路器
  }

  getStatus(state: AgentState): BudgetStatus {
    const turnsRemaining = this.maxTurns - state.currentTurn;
    return { turnsRemaining, consecutiveErrors: 0, atRisk: turnsRemaining <= 3 };
  }
}
```

---

## 6. 数据流

```
用户输入
   │
   ▼
┌─────────────┐
│   harness   │ ──外层 while 循环──
└──────┬──────┘                    │
       ▼                           │
┌─────────────┐                   │
│   loop.ts   │                   │
│             │                   │
│ 1. PREPARE  │ ◄── MemoryProvider.buildContext()
│    消息组装  │ ◄── ContextCompressor.compress()
│             │                   │
│ 2. REASON   │ ──► generateText() ──► LLM
│    LLM 调用  │ ◄── toolCalls + text   │
│             │                   │
│ 3. EXECUTE  │ ◄── ToolProvider.execute()
│    工具执行  │                   │
│             │                   │
│ 4. OBSERVE  │ ──► state.addMessage()
│    状态更新  │                   │
└──────┬──────┘                   │
       │                          │
       ▼                          │
  本轮结果 ────────────────────────┘
       │
       ▼
  终止/继续
```

---

## 7. 错误处理策略

### 7.1 错误分类

参考 OpenClaw 的错误分类体系：

| 错误类型 | 处理策略 | 说明 |
|----------|----------|------|
| `api_error` | 指数退避重试 | 网络/速率限制/Provider 故障 |
| `invalid_response` | 重试 + 降级 | 格式错误 |
| `planning_only` | 注入重试指令 | 只给计划不行动 |
| `reasoning_only` | 注入重试指令 | 只推理不给答案 |
| `empty_response` | 注入重试指令 | 空响应 |
| `tool_error` | 记录 + 继续 | 单个工具失败不影响整体 |
| `timeout` | 检查断路器 | 超时次数过多时强制终止 |
| `unknown` | 记录 + 终止 | 未知错误不盲目重试 |

### 7.2 重试指令

参考 OpenClaw 的针对性指令（P1 实现）：

```typescript
const PLANNING_ONLY_RETRY_INSTRUCTION =
  "The previous assistant turn only described the plan. Do not restate the plan. Act now: take the first concrete tool action you can.";

const REASONING_ONLY_RETRY_INSTRUCTION =
  "The previous assistant turn recorded reasoning but did not produce a user-visible answer. Continue from that partial turn and produce the visible answer now.";

const EMPTY_RESPONSE_RETRY_INSTRUCTION =
  "The previous attempt did not produce a user-visible answer. Continue from the current state and produce the visible answer now.";
```

---

## 8. 渐进式实现路线图

### P0: Core 可运行（当前重点）

目标：**一条请求能走完 输入→推理→工具执行→输出的完整链路**

| 模块 | 工作项 | 状态 |
|------|--------|------|
| loop.ts | 消息组装（sanitize + buildContext + compress 决策） | 待实现 |
| loop.ts | 集成 ToolProvider.execute() | 待实现 |
| ToolProvider | InMemoryToolProvider（Map 注册表，串行执行） | 待实现 |
| MemoryProvider | SimpleMemoryProvider（消息列表 + 固定系统提示） | 待实现 |
| ErrorHandler | SimpleErrorHandler（基础分类） | 待实现 |
| BudgetPolicy | FixedBudgetPolicy（固定轮次 + 超时） | 待实现 |
| ContextCompressor | NoOpCompressor（占位） | 待实现 |
| harness.ts | 外层循环 + 错误分类决策 | 待实现 |

### P1: 稳定性增强

| 模块 | 工作项 | 参考来源 |
|------|--------|----------|
| ErrorHandler | 不完整轮次检测 + 针对性重试指令 | OpenClaw |
| BudgetPolicy | 空闲超时断路器 | OpenClaw |
| ToolProvider | 只读工具并行执行 | Hermes |
| State | Session 持久化（SQLite） | Hermes |
| loop.ts | API 错误指数退避重试 | Hermes |

### P2: 扩展能力

| 模块 | 工作项 | 参考来源 |
|------|--------|----------|
| MemoryProvider | 三层记忆（Working/Episodic/Semantic） | Hermes |
| ContextCompressor | 滑动窗口/摘要压缩 | OpenClaw |
| ChannelProvider | CLI / Telegram / Discord | OpenClaw |
| SkillProvider | SKILL.md 技能系统 | Hermes |

---

## 9. 与现有架构文档的关系

本设计是对 `docs/architecture.md` 中 Core 层的细化实现方案：

| 架构文档 | 本设计 | 关系 |
|----------|--------|------|
| `core/harness.ts` | `harness.ts` + `loop.ts` | 对应 |
| `core/state.ts` | `state.ts` | 对应 |
| `core/events.ts` | `events.ts` | 对应 |
| `sdk/tool-provider.ts` | `ToolProvider` 接口 | 对应 |
| `sdk/memory-provider.ts` | `MemoryProvider` 接口 | 对应 |
| — | `ContextCompressor` 接口 | 新增 |
| — | `ErrorHandler` 接口 | 新增 |
| — | `BudgetPolicy` 接口 | 新增（替代 budget.ts） |
| `state/session-store.ts` | P1 实现 | 延后 |

---

*设计日期：2026-06-11*
*参考文档：`docs/research/agent-loop-orchestration-comparison.md`、`docs/architecture.md`*
