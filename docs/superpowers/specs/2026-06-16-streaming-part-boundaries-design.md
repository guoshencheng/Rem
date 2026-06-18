# Streaming Part Boundaries & Multi-Step Turn Design

## Status

Approved for implementation planning.

## Context

当前 `rem-agent-core` 的流式输出已经支持 `text-delta`、`reasoning-delta`、`tool-call`、`tool-result` 等 chunk 类型，并通过 `partIndex` 把同类型连续 delta 聚合为同一个 part。但存在两个问题：

1. 缺少 part 边界：参考 Vercel/AI SDK，每个流式 part 应该有明确的 `*-start` 和 `*-finish` 事件，方便消费端渲染骨架、切换样式、做折叠动画。
2. parts 的归属不对：当前 parts 在 step 内编号，但一个 turn 对应一个 assistant message，parts 应该是这个 message 的属性，因此需要提升到 turn 级别。
3. Turn 目前只执行单步：一个 turn 内只调用一次 LLM，无法支持 reason → tool → observe → reason again 的多步 ReAct 流程。

## Goals

1. 为每个流式 part 引入 `*-start` / `*-finish` 边界 chunk。
2. 用 `partId` 取代 `partIndex`，并让 part 的标识符合 Vercel/AI SDK 语义（text/reasoning 生成 id，tool 复用 `toolCallId`）。
3. 把 parts 提升到 turn/message 级别，跨 step 保持唯一 id。
4. 让一个 turn 内部可以执行多步，默认 `maxSteps = 50`。
5. 保持 `stream.steps` API（兼容 Vercel/AI 形状），当前一个 turn 返回一个 `StepResult`。

## Non-Goals

- 本次不涉及“thinking 状态”的顶层 stream status 设计（用户明确推迟）。
- 不改动机模型、Provider 配置、事件总线事件类型。
- 不引入新的 UI 组件，只更新现有 `StreamAssistantMessage`。

## Chunk Protocol

### `AgentStreamChunk`

```ts
export type AgentStreamChunk =
  // 阶段边界
  | { type: 'step-start'; step: number }
  | { type: 'step-finish'; step: number }

  // text part
  | { type: 'text-start'; step: number; partId: string }
  | { type: 'text-delta'; step: number; partId: string; text: string }
  | { type: 'text-finish'; step: number; partId: string }

  // reasoning part
  | { type: 'reasoning-start'; step: number; partId: string }
  | { type: 'reasoning-delta'; step: number; partId: string; text: string }
  | { type: 'reasoning-finish'; step: number; partId: string }

  // tool-call part
  | { type: 'tool-call-start'; step: number; partId: string; toolCallId: string; toolName: string }
  | { type: 'tool-call'; step: number; partId: string; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-call-finish'; step: number; partId: string; toolCallId: string; toolName: string }

  // tool-result part
  | { type: 'tool-result-start'; step: number; partId: string; toolCallId: string; toolName?: string }
  | { type: 'tool-result'; step: number; partId: string; toolCallId: string; output: string; error?: string }
  | { type: 'tool-result-finish'; step: number; partId: string; toolCallId: string }

  // 整体边界
  | { type: 'finish'; output: AgentOutput }
  | { type: 'error'; error: Error };
```

### 边界规则

- 每个 part 由 `*-start` 开始，由 `*-finish` 结束。
- `text` / `reasoning` 之间切换时，先 finish 旧 part，再 start 新 part。
- `tool-call` 和 `tool-result` 是原子性的：一次事件会连续发出 start、payload、finish 三个 chunk。
- `partId` 生成规则：
  - text / reasoning：使用 `ai` 包的 `generateId()`。
  - tool-call / tool-result：`partId = toolCallId`。
- turn 结束时如果还有未关闭的 part，由 `AgentStreamController` 自动补发 `*-finish`。

## Part 归属：Turn/Message 级别

- `AgentStreamController` 的生命周期和单个 turn 一致（由 `ReactTurnRunner.run` 创建）。
- `partId` 在整个 turn 内唯一，跨 step 连续。
- `step` 字段仍保留在 chunk 中，用于调试和 `aggregateSteps` 分组，但不再是 part 的作用域边界。

## AgentStreamController 职责

`AgentStreamController` 成为流协议的唯一管理者：

1. 接收 loop strategy 发来的“语义事件”（无 `partId`）：
   - `{ type: 'text-delta'; step: number; text: string }`
   - `{ type: 'reasoning-delta'; step: number; text: string }`
   - `{ type: 'tool-call'; step: number; toolCallId: string; toolName: string; input: unknown }`
   - `{ type: 'tool-result'; step: number; toolCallId: string; output: string; error?: string }`
2. 根据当前打开 part 的类型，自动合成 `*-start` / `*-finish` 边界，并分配 `partId`。
3. 对外暴露的 `fullStream` 包含完整边界 chunk。
4. `aggregateText` 只累加 `text-delta`。
5. `aggregateSteps` 按 `step` 分组，聚合 `text-delta`、`reasoning-delta`、`tool-call`、`tool-result`。
6. `finish()` / `fail()` 时关闭未完成的 part，再发出 `finish` / `error`。

## Multi-Step Turn 架构

### 职责划分

- **Turn (`ReactTurnRunner.run`)**：管理 assistant message 生命周期，循环调用 Loop，执行 `maxSteps` 检查，聚合结果。
- **Loop (`LoopStrategy.iterate`)**：只执行一次 model call + 可选的 tool execution，返回单步结果。

### `ReactTurnRunner.run` 流程

1. 创建内部 `Session` 和 `AgentState`。
2. 创建并添加一个空的 assistant message（整个 turn 只创建一个）。
3. 调用 `hooks.onMessageAdded(assistantMsg)` 一次。
4. 初始化 `step = 1`，`allNewMessages = [assistantMsg]`，`allToolCalls = []`。
5. While true：
   - 发出 `step-start`。
   - 调用 `loopStrategy.iterate(loopCtx, hooks, controller, step)`。
   - 发出 `step-finish`。
   - 合并 `newMessages`（去重）和 `toolCalls`。
   - 如果 `result.completed` 为 true，break。
   - `step++`，如果 `step > maxSteps`，break（`output.completed = false`）。
6. 返回 `TurnResult`，包含 `steps`（实际执行步数）。

### `ReactLoop.iterate` 调整

- 删除 `LoopResult.iterations` 字段。
- 返回的 `newMessages` 只包含本 step 新增的 tool messages，不再包含 assistantMsg。
- 不再调用 `hooks.onMessageAdded(assistantMsg)`。
- `getCurrentAssistantMessage` 改为只读取 state 中已有的 assistant message，不创建新的。
- `mapToAgentStreamChunk` 返回的 raw chunk 不带 `partId`。
- tool 执行完成后，通过 `controller.append({ type: 'tool-result', ... })` 让 controller 自动补边界。

### `maxSteps` 配置

- 默认值为 `50`。
- 配置位置：`TurnContext.maxSteps` 和 `LoopContext.maxSteps`。
- 注意和 `IterationBudget.maxTurns` 区分：后者是 agent 级 turn 数量上限，前者是单个 turn 内 step 数量上限。

## 数据结构变化

### `LoopResult`

```ts
export interface LoopResult {
  finalOutput: AgentOutput;
  newMessages: ModelMessage[];
  toolCalls: ToolCall[];
  usage: LanguageModelUsage;
}
```

删除 `iterations`。

### `TurnResult`

```ts
export interface TurnResult {
  output: AgentOutput;
  newMessages: ModelMessage[];
  toolCalls: { toolCallId: string; toolName: string; input: unknown }[];
  usage: LanguageModelUsage;
  steps: number;
}
```

新增 `steps`。

### `AgentStream`

保持：

```ts
export interface AgentStream {
  fullStream: AsyncIterable<AgentStreamChunk>;
  text: Promise<string>;
  usage: Promise<LanguageModelUsage>;
  steps: Promise<AgentStreamStepResult[]>;
}
```

`steps` 当前返回一个元素的数组；未来多 turn 或多 agent step 场景可扩展。

## UI 消费端（Demo）

`packages/demo/src/tui/message.ts` 中的 `StreamAssistantMessage` 更新：

- 用 `partId` 作为 `Map` 的 key。
- `text-start` / `reasoning-start`：创建 `UIPart` 容器。
- `text-delta` / `reasoning-delta`：按 `partId` 追加文本。
- `text-finish` / `reasoning-finish`：可追加结束样式（如 reasoning 块底线）。
- `tool-call-start` / `tool-call` / `tool-call-finish`：显示工具调用骨架，回填 input，标记完成。
- `tool-result-start` / `tool-result` / `tool-result-finish`：显示结果或错误。

## 错误处理

- **单 step 模型调用失败**：走 `errorHandler` 重试，最终失败抛错，turn 结束。
- **Tool 执行失败**：错误放在 `tool-result.error` 中，不中断 turn，继续下一步。
- **`maxSteps` 超限**：`output.completed` 设为 false，返回当前聚合结果，不抛错。
- **AbortSignal**：`ReactTurnRunner` 的循环每次迭代前检查 `signal.aborted`，中止时立即 break 并触发 controller `fail`。

## 测试计划

1. `packages/core/tests/agent-stream.test.ts`（新增）：
   - text / reasoning 自动 start/finish。
   - tool-call / tool-result 三联事件顺序。
   - 类型切换时先 finish 旧 part。
   - turn 结束自动关闭未完成的 part。
   - `partId` 生成规则（tool partId === toolCallId）。
2. `packages/core/tests/turn.test.ts`（更新）：
   - 多 step 循环在 tool 调用后触发第二步。
   - `maxSteps` 限制生效。
   - `TurnResult.steps` 正确。
3. `packages/core/tests/loop-strategy.test.ts`（更新）：
   - 单 step 返回 completed=true/false。
   - 不重复添加 assistantMsg。
4. `packages/demo/src/tui/message.ts`（ widget test 如已有基础设施）：
   - 模拟完整 text part 序列，验证 Markdown 创建和文本更新。

## 改动文件清单

| 文件 | 改动 |
|---|---|
| `packages/core/src/types.ts` | 重写 `AgentStreamChunk`，删除 `partIndex`，新增 `partId`；`TurnResult` 加 `steps`。 |
| `packages/core/src/stream/agent-stream.ts` | `append` 接收 raw chunk，自动管理边界和 `partId`；更新聚合逻辑。 |
| `packages/core/src/turn.ts` | `ReactTurnRunner.run` 实现多 step 循环，`maxSteps` 默认 50。 |
| `packages/core/src/loop-strategy.ts` | `ReactLoop.iterate` 只负责单步；删除 `iterations`；不管理 assistantMsg 生命周期。 |
| `packages/demo/src/tui/message.ts` | 改用 `partId`，响应 start/delta/finish 事件。 |
| `packages/core/tests/*.test.ts` | 新增/更新测试。 |

## 兼容性

- `AgentStreamChunk` 的 `partIndex` 字段被删除，这是破坏性变更。但 `partIndex` 只在 demo 内部使用，core 外部没有公开消费。
- `LoopResult.iterations` 被删除，当前无消费方。
- `AgentStream` 的 `steps` API 保留，语义不变（仍返回 `Promise<AgentStreamStepResult[]>`）。

## 后续可扩展

- 当需要“thinking 状态”顶层 status 时，可以在 `AgentStreamController` 上维护 `status` 字段，并发出 `stream:status-changed` 事件。
- 当需要 step 级 usage 或 request/response 元数据时，可扩展 `AgentStreamStepResult` 以匹配 Vercel/AI 的 `StepResult`。
