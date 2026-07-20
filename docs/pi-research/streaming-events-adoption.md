# 借鉴 pi-ai 流式事件粒度设计升级 REM 事件体系调研报告

## 目录

1. [执行摘要：结论与推荐方案](#执行摘要结论与推荐方案)
2. [REM 当前流式事件模型的问题与限制](#rem-当前流式事件模型的问题与限制)
3. [pi-ai 流式事件模型可借鉴的具体点](#pi-ai-流式事件模型可借鉴的具体点)
4. [推荐的新事件类型设计](#推荐的新事件类型设计)
5. [变更清单：core、bridge、web 三侧](#变更清单corebridgeweb-三侧)
6. [迁移步骤：逐步升级计划](#迁移步骤逐步升级计划)
7. [向后兼容性策略](#向后兼容性策略)
8. [风险与注意事项](#风险与注意事项)

---

## 1. 执行摘要：结论与推荐方案

### 核心结论

REM 当前的 `AgentStreamChunk`/`ProviderChunk` 事件体系已经初步覆盖了“文本 / 推理 / 工具调用 / 工具结果”四类内容，但在**事件粒度、跨 Provider 一致性、部分 JSON 流式、UI 状态绑定**等方面仍有明显不足。pi-ai 的 `AssistantMessageEvent` 体系采用了统一的三元事件组（`*_start` / `*_delta` / `*_end`）+ `contentIndex` + `partial` 快照的模型，正好补齐了 REM 的这些短板。

### 推荐方案

1. **Provider 层（ProviderChunk）**：保留现有“原始 Provider 事件”定位，但统一补齐三类事件组，并引入 **部分参数流式（tool-call-delta / tool-call-end）**、**内容索引（contentIndex）**、**消息快照（partial）** 三个关键字段。
2. **Agent 流层（AgentStreamChunk）**：在现有事件基础上，将 `tool-call` 单一事件拆分为 `tool-call-start / tool-call-delta / tool-call-end`，将 `text-delta / reasoning-delta` 与 `*_start / *_finish` 配对关系明确化，新增 `done`/`error` 语义以替代 `finish`/`error`，引入 `contentIndex` 以支持同一步内多内容块的并发/交错输出。
3. **UI 层**：`UIMessage` 不再依赖 `activePartType` 推定当前正在写入的 part，而是基于 `contentIndex` 维护可追加的内容块数组；实现部分 JSON 渲染的 `ToolCallBlock`，支持工具参数逐字显示。
4. **兼容性**：旧事件类型在短期内保留并自动由 core 的 `AgentStreamController` 发出，同时发出新事件；UI 优先消费新事件，旧事件通过兼容层转义为旧 `ContentPart` 结构。

---

## 2. REM 当前流式事件模型的问题与限制

### 2.1 类型定义现状

```ts
// packages/core/src/types.ts
export type AgentStreamChunk =
  | { type: 'step-start'; step: number }
  | { type: 'step-finish'; step: number }
  | { type: 'message-start'; step: number; messageId: string }
  | { type: 'text-start'; step: number; partId: string }
  | { type: 'text-delta'; step: number; partId: string; text: string }
  | { type: 'text-finish'; step: number; partId: string }
  | { type: 'reasoning-start'; step: number; partId: string }
  | { type: 'reasoning-delta'; step: number; partId: string; text: string }
  | { type: 'reasoning-finish'; step: number; partId: string }
  | { type: 'tool-call-start'; step: number; partId: string; toolCallId: string; toolName: string }
  | { type: 'tool-call'; step: number; partId: string; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-call-finish'; step: number; partId: string; toolCallId: string; toolName: string }
  | { type: 'tool-result-start'; ... }
  | { type: 'tool-result'; ... }
  | { type: 'tool-result-finish'; ... }
  | { type: 'finish'; output: AgentOutput }
  | { type: 'error'; error: Error }
  | { type: 'usage'; ... }
  | ...

export type ProviderChunk =
  | { type: 'text-delta'; step: number; text: string }
  | { type: 'reasoning-delta'; step: number; text: string }
  | { type: 'tool-call'; step: number; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-result'; ... }
  | ...
```

`packages/core/src/llm/types.ts` 中 LLM 原始层还有一层 `StreamChunk`：

```ts
export type StreamChunk =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'usage'; ... }
  | { type: 'finish'; reason: string };
```

### 2.2 问题清单

| 问题 | 说明 |
|------|------|
| **工具调用无部分参数流式** | `ProviderChunk` 中工具调用只有 `tool-call` 一个事件，参数一次性到达；OpenAI/Anthropic 实际都支持工具参数流式增量。`tool-call-start` 在 `AgentStreamController` 中由 core 自己合成，但 `input` 仍是完整的，UI 无法做“参数正在生成”的动画。 |
| **contentIndex 缺失** | 同一步（step）内多个文本块、推理块、工具调用可能交错出现。REM 仅靠 `partId` 区分，但 UI 必须依赖 `activePartType` 推断当前写入块；如果模型输出“text → tool call → text”，第二个 text 块会被追加到同一个 `text` part 中，而不是作为新块。 |
| **缺少统一的 `partial` 快照** | pi-ai 的每个事件都携带 `partial: AssistantMessage`，方便消费者在任何时刻知道当前消息累计状态。REM 的 `AgentStreamController` 仅在内部维护 `queue`，外部无法拿到中间快照。 |
| **finish/error 语义不够统一** | `finish` 既表示单次 LLM 调用结束，又表示整个 Agent 输出完成；`error` 直接抛 Error 对象，不利于跨网络序列化。pi-ai 的 `done`/`error` 明确区分“一次 assistant message 生成完成”与“失败”。 |
| **step 语义侵入内容事件** | 每个内容事件都带 `step`，但对 UI 来说真正重要的是“当前消息内容索引”。step 更适合用于生命周期事件（step-start/finish），内容块事件应使用 `contentIndex`。 |
| **聚合器基于 step 索引** | `aggregateSteps` 以 `step` 为 key，一旦同一步内出现多个文本块或工具调用，会合并到同一字段，丢失块级信息。 |
| **reduceStreamChunk 对交错事件脆弱** | 当 `text-delta` 在 `tool-call-start` 之后再次出现时，会被追加到同一个 `text` part 末尾，因为当前实现只判断 `last.type === 'text'`，没有 contentIndex 隔离。 |
| **LLM 原始层 `finish` 与 Agent 层 `finish` 同名** | `StreamChunk` 的 `finish` 与 `AgentStreamChunk` 的 `finish` 类型不同，容易在转换时混淆。 |

---

## 3. pi-ai 流式事件模型可借鉴的具体点

### 3.1 事件类型一览

pi-ai 在 `packages/ai/src/types.ts` 中定义了 `AssistantMessageEvent`：

```ts
export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: "done"; reason: Extract<StopReason, "stop" | "length" | "toolUse">; message: AssistantMessage }
  | { type: "error"; reason: Extract<StopReason, "aborted" | "error">; error: AssistantMessage };
```

### 3.2 可借鉴点详解

#### 1. 三元事件组 `*_start / *_delta / *_end`

每个内容块都有明确的开始、增量、结束事件。这带来的好处：

- UI 可以精确知道何时开始渲染新块、何时追加文本、何时锁定块。
- 结束事件可携带完整内容（`content` / `toolCall`），便于做最终校验或渲染。
- 流式工具参数可以独立为 `toolcall_delta`，实现“JSON 正在生成”的实时效果。

REM 现状：`text` 和 `reasoning` 已有 `*_start / *_delta / *_finish`，但 `tool-call` 缺少 `*_delta`；`tool-result` 虽然完整但通常是非流式的，可保留现状。

#### 2. `contentIndex` 内容索引

`contentIndex` 表示当前事件在 `AssistantMessage.content` 数组中的位置。README 中明确强调：

> Streaming events for different content blocks are not guaranteed to be contiguous... Consumers must use `contentIndex` to associate each delta/end event with its block and must not assume that a block's `*_start`/`*_delta`/`*_end` sequence is uninterrupted by events for other blocks.

这对 REM 尤为重要：当前 REM 的同一步内多个文本/工具块会被错误合并。引入 `contentIndex` 后，UI 可以按索引维护 `contentBlocks[contentIndex]`，而不是只看最后一个 part。

#### 3. `partial` 快照

每个事件都携带 `partial: AssistantMessage`，即当前已累积的完整消息对象。这相当于给 UI 提供了一个“随时可渲染的完整状态”，无需自己重新聚合。REM 可以考虑在 `AgentStreamChunk` 中增加可选的 `partial?: { content: ContentPart[] }` 字段，或在 bridge 层提供 `reduceStreamChunk` 的替代函数。

#### 4. 工具调用部分 JSON（`toolcall_delta`）

README 中 “Streaming Tool Calls with Partial JSON” 章节说明：

```ts
if (event.type === 'toolcall_delta') {
  const toolCall = event.partial.content[event.contentIndex];
  if (toolCall.type === 'toolCall' && toolCall.arguments) {
    // arguments 是最佳努力的 partial JSON
  }
}
```

在 `openai-completions.ts` 中，`block.arguments = parseStreamingJson(block.partialArgs)` 每次收到参数增量都会重新解析，`toolcall_delta` 的 `delta` 是原始 JSON 字符串，而 `partial` 中已包含可读取的部分参数。Anthropic 的 `input_json_delta` 同理。

REM 当前 `tool-call` 事件直接携带完整 `input: unknown`，UI 无法提前展示参数。升级后，UI 可显示“正在解析参数...” 并在参数完整后确认执行。

#### 5. `done` / `error` 终止事件

pi-ai 的终止事件明确：

- `done`：单次 assistant message 生成成功，携带 `reason` 和完整 `message`。
- `error`：生成失败或被中断，携带 `reason`（`error` 或 `aborted`）和带部分内容的 `error` 消息。

REM 的 `finish` 当前既表示一次 LLM 调用结束又表示整个 Agent 输出完成，建议引入：

- `message-done`：一次模型响应完成（可对应 `done`）。
- `agent-done`：最终 Agent 输出完成（对应现有 `finish`）。
- `error`：保持，但携带可序列化的 `errorInfo` 对象。

#### 6. 统一停止原因（StopReason）

pi-ai 的 `StopReason = "stop" | "length" | "toolUse" | "error" | "aborted"` 与 LLM 原生 `finish_reason` 对齐。REM 的 `GenerateResult` 已有 `finishReason?: string`，但 Agent 层没有透传，值得在 `message-done` / `done` 事件中暴露。

---

## 4. 推荐的新事件类型设计

### 4.1 设计原则

1. **三层事件清晰分离**：
   - **LLM 原始层**（`StreamChunk`）：面向 SDK 的最低粒度事件，保留 `text`/`reasoning`/`tool-call-delta`/`tool-call-end`/`usage`/`finish`。
   - **Provider 层**（`ProviderChunk`）：面向 Agent 循环，带 `step` 和 `contentIndex`，统一映射 LLM 事件。
   - **Agent 流层**（`AgentStreamChunk`）：面向 UI，带 `step`、`partId`、`contentIndex`，并可选 `partial` 快照。

2. **工具调用必须支持 `delta`**：在 Provider 层和 Agent 层都引入 `tool-call-delta`。

3. **内容事件使用 `contentIndex`**：`text-delta`、`reasoning-delta`、`tool-call-delta` 都携带 `contentIndex`，允许同一步内多内容块交错。

4. **终止事件语义化**：引入 `message-done` 和 `agent-done`。

5. **兼容旧类型**：新类型定义使用联合，不删除旧事件；旧事件通过转换函数继续支持。

### 4.2 推荐类型定义

```ts
// packages/core/src/types.ts

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; arguments: unknown }
  | { type: 'tool-result'; toolCallId: string; toolName?: string; output: string; error?: string };

export type MessageContent = ContentPart[];

// 新增：消息快照，用于事件携带中间完整状态
export interface MessageSnapshot {
  messageId: string;
  content: MessageContent;
  usage?: LanguageModelUsage;
}

export type AgentStreamChunk =
  | { type: 'step-start'; step: number }
  | { type: 'step-finish'; step: number }
  | { type: 'message-start'; step: number; messageId: string }
  | { type: 'message-done'; step: number; messageId: string; reason: 'stop' | 'length' | 'toolUse'; partial: MessageSnapshot }
  | { type: 'agent-done'; output: AgentOutput }
  | { type: 'text-start'; step: number; contentIndex: number; partId: string; partial?: MessageSnapshot }
  | { type: 'text-delta'; step: number; contentIndex: number; partId: string; text: string; partial?: MessageSnapshot }
  | { type: 'text-finish'; step: number; contentIndex: number; partId: string; text: string; partial?: MessageSnapshot }
  | { type: 'reasoning-start'; step: number; contentIndex: number; partId: string; partial?: MessageSnapshot }
  | { type: 'reasoning-delta'; step: number; contentIndex: number; partId: string; text: string; partial?: MessageSnapshot }
  | { type: 'reasoning-finish'; step: number; contentIndex: number; partId: string; text: string; partial?: MessageSnapshot }
  | { type: 'tool-call-start'; step: number; contentIndex: number; partId: string; toolCallId: string; toolName: string; partial?: MessageSnapshot }
  | { type: 'tool-call-delta'; step: number; contentIndex: number; partId: string; toolCallId: string; toolName: string; partialJson: string; partial?: MessageSnapshot }
  | { type: 'tool-call'; step: number; contentIndex: number; partId: string; toolCallId: string; toolName: string; input: unknown; partial?: MessageSnapshot }
  | { type: 'tool-call-end'; step: number; contentIndex: number; partId: string; toolCallId: string; toolName: string; input: unknown; partial?: MessageSnapshot }
  | { type: 'tool-call-finish'; step: number; contentIndex: number; partId: string; toolCallId: string; partial?: MessageSnapshot }
  | { type: 'tool-result-start'; ... }
  | { type: 'tool-result'; ... }
  | { type: 'tool-result-finish'; ... }
  | { type: 'error'; error: StreamErrorInfo }
  | { type: 'session-title'; title: string }
  | { type: 'approval-request'; ... }
  | { type: 'approval-resolved'; ... }
  | { type: 'compress-...'; ... }
  | { type: 'usage'; ... };

export interface StreamErrorInfo {
  name: string;
  message: string;
  reason?: 'error' | 'aborted';
  // 可序列化，便于跨网络传输
  stack?: string;
}

export type ProviderChunk =
  | { type: 'text-delta'; step: number; contentIndex: number; text: string }
  | { type: 'reasoning-delta'; step: number; contentIndex: number; text: string }
  | { type: 'tool-call-start'; step: number; contentIndex: number; toolCallId: string; toolName: string }
  | { type: 'tool-call-delta'; step: number; contentIndex: number; toolCallId: string; toolName: string; partialJson: string }
  | { type: 'tool-call'; step: number; contentIndex: number; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-result'; ... }
  | { type: 'step-start'; step: number }
  | { type: 'step-finish'; step: number }
  | { type: 'message-start'; step: number; messageId: string }
  | { type: 'message-done'; step: number; messageId: string; reason: 'stop' | 'length' | 'toolUse' }
  | { type: 'usage'; ... };
```

### 4.3 LLM 原始层演进

```ts
// packages/core/src/llm/types.ts
export type StreamChunk =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call-start'; toolCallId: string; toolName: string }
  | { type: 'tool-call-delta'; toolCallId: string; toolName: string; partialJson: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'usage'; ... }
  | { type: 'finish'; reason: string };
```

### 4.4 每个事件在 UI 层的使用

| 事件 | UI 行为 |
|------|---------|
| `step-start` | 显示“思考中”或步骤指示器；清空或重置步骤级状态。 |
| `message-start` | 创建新的 assistant 消息卡片，`status: 'streaming'`，绑定 `messageId`。 |
| `text-start` | 在 `contentBlocks[contentIndex]` 位置新建一个 `text` 块，初始文本为空。 |
| `text-delta` | 将 `text` 追加到 `contentBlocks[contentIndex]` 对应文本块。 |
| `text-finish` | 锁定该文本块，Markdown 最终渲染，可触发复制按钮显示。 |
| `reasoning-start` | 展开/显示 `ReasoningBlock`，状态为 `thinking`。 |
| `reasoning-delta` | 追加推理文本到 `ReasoningBlock` 内容区。 |
| `reasoning-finish` | 收起或标记“Thought”完成，可折叠。 |
| `tool-call-start` | 显示 `ToolCallBlock`，状态为 `执行中...`，无参数时只显示工具名。 |
| `tool-call-delta` | 实时解析 `partialJson`，将已解析字段（如 `path`、`content`）高亮显示，提示用户“参数正在生成”。 |
| `tool-call` | 保留兼容旧 UI：直接填入完整参数。新 UI 可忽略或用于最终确认。 |
| `tool-call-end` | 工具参数已完整，状态从“执行中”转为“等待执行/已执行”。 |
| `tool-call-finish` | 工具调用阶段结束（通常紧接着执行工具）。 |
| `tool-result-start` / `tool-result` / `tool-result-finish` | 同现有逻辑，显示工具结果或错误。 |
| `message-done` | 单次模型响应完成，若 `reason === 'toolUse'` 则保持 `calling-function` 状态等待结果；否则准备进入下一轮或结束。 |
| `agent-done` | 整个 Agent 输出完成，将消息状态置为 `done`，显示 token usage。 |
| `error` | 消息状态置为 `error`，显示错误信息，保留 `partial` 内容。 |
| `usage` | 更新当前消息的 `tokenUsage` 和全局状态。 |
| `session-title` | 更新会话标题。 |
| `approval-request` / `approval-resolved` | 同现有审批流程。 |

---

## 5. 变更清单：core、bridge、web 三侧

### 5.1 core 侧

| 文件 | 变更内容 |
|------|----------|
| `packages/core/src/types.ts` | 新增 `MessageSnapshot`、`StreamErrorInfo`；扩展 `AgentStreamChunk` 和 `ProviderChunk` 类型，新增 `contentIndex`、`partial`、`message-done`、`agent-done`、`tool-call-delta`、`tool-call-end` 等字段/事件；调整 `error` 事件 payload 为 `StreamErrorInfo`。 |
| `packages/core/src/llm/types.ts` | 扩展 `StreamChunk`，新增 `tool-call-start` / `tool-call-delta`。 |
| `packages/core/src/llm/stream-collector.ts` | 处理 `tool-call-start` / `tool-call-delta` / `tool-call`，累积 `partialJson` 并在 `result()` 中返回最终 `toolCalls`。 |
| `packages/core/src/llm/partition-stream.ts` | 保持对 `text` 分区的处理，新增透传 `tool-call-start` / `tool-call-delta`。 |
| `packages/core/src/llm/providers/openai.ts` | 在 stream 中解析 OpenAI `tool_calls` 增量，emit `tool-call-start` / `tool-call-delta` / `tool-call` / `finish`。 |
| `packages/core/src/llm/providers/anthropic.ts` | 在 stream 中解析 `content_block_start`/`content_block_delta` 的 `tool_use`/`input_json_delta`，emit 对应事件。 |
| `packages/core/src/llm/engine.ts` | 适配新的 `StreamChunk` 类型，处理 `tool-call-delta` 并累积参数。 |
| `packages/core/src/reason/reason.ts` | 在 `onChunk` 转换中映射新的 `tool-call-start`/`tool-call-delta`/`tool-call` 到 `ProviderChunk`；透传 `message-done` 的 `reason`。 |
| `packages/core/src/loop-strategy.ts` / `run-agent.ts` | 在 Agent 循环中生成 `message-done` 与 `agent-done`，区分单次模型响应结束与最终输出结束。 |
| `packages/core/src/stream/agent-stream.ts` | `AgentStreamController` 维护 `contentIndex` 和内容块数组；根据 `contentIndex` 正确生成 `*_start` / `*_delta` / `*_end`；对无 `contentIndex` 的旧 Provider 事件做兼容合成。 |
| `packages/core/src/stream/stream-aggregators.ts` | `aggregateText`、`aggregateSteps`、`reduceStreamChunk` 改为基于 `contentIndex` 和内容块类型；兼容旧事件。 |
| `packages/core/src/state.ts` | `applyChunk` 基于 `contentIndex` 判断活动块；`appendSnapshotParts` 使用新的 `reduceStreamChunk`。 |
| `packages/core/tests/*` | 更新单元测试，补充 `tool-call-delta` 和多内容块交错场景的测试。 |

### 5.2 bridge 侧

| 文件 | 变更内容 |
|------|----------|
| `packages/bridge/src/types.ts` | 若需要，可在 `UIMessage` 中新增 `contentBlocks?: { index: number; part: ContentPart }[]` 或保留 `parts` 但说明按顺序。 |
| `packages/bridge/src/sse.ts` | `parseAgentStreamEvent` 兼容新/旧 JSON；对旧 `error` 事件中的 Error 对象做 `StreamErrorInfo` 转换。 |
| `packages/bridge/src/response.ts` | 无需大幅改动，继续用 `JSON.stringify(chunk)` 发送 `AgentStreamChunk`。 |
| `packages/bridge/src/stream-reducer.ts` / `client.ts` | 导出新的 `reduceStreamChunk` 和类型守卫（如 `isToolCallDelta`）。 |
| `packages/bridge/tests/client.test.ts` | 补充新事件类型的 SSE 序列化/解析测试。 |

### 5.3 web 侧

| 文件 | 变更内容 |
|------|----------|
| `packages/web/src/lib/types.ts` | 新增 `isToolCallDelta`、`isToolCallEnd`、`isMessageDone` 等类型守卫；保留旧守卫以兼容。 |
| `packages/web/src/lib/use-agents.ts` | 重写 chunk 处理逻辑：基于 `contentIndex` 维护 `contentBlocks`；处理 `tool-call-delta` 实时更新参数；支持 `message-done`/`agent-done`。 |
| `packages/web/src/components/chat/message-item.tsx` | 按 `contentIndex` 渲染 `parts`；多文本块不再被错误合并。 |
| `packages/web/src/components/chat/reasoning-block.tsx` | 保持现状，但支持从 `contentIndex` 对应块读取文本。 |
| `packages/web/src/components/chat/tool-call-block.tsx` | 新增 `partialArguments?: unknown` 属性，支持实时渲染部分 JSON 参数；当 `isExecuting` 且存在 partialArguments 时显示“正在生成参数”。 |
| 新增 `packages/web/src/components/chat/streaming-content.tsx`（可选） | 封装基于 `contentIndex` 的流式内容渲染组件。 |
| `packages/web/src/components/chat/chat-panel.tsx` | 若消费 `activePartType`，改为基于 `contentIndex` 推导。 |

---

## 6. 迁移步骤：逐步升级计划

### 阶段 0：基线与兼容层（1-2 天）

1. 在 `packages/core/src/types.ts` 中新增类型定义，**不删除旧事件**。
2. 新增 `toNewAgentStreamChunk(chunk: OldAgentStreamChunk): NewAgentStreamChunk` 兼容转换函数，放在 `packages/core/src/stream/compat.ts`。
3. 运行 `pnpm typecheck && pnpm test`，确保现有测试全绿。

### 阶段 1：core 类型 + LLM 原始层（3-5 天）

1. 修改 `packages/core/src/llm/types.ts` 的 `StreamChunk`，让 OpenAI/Anthropic Provider 在流式工具调用时 emit `tool-call-start` / `tool-call-delta` / `tool-call`。
2. 更新 `StreamCollector` 以累积部分 JSON。
3. 在 `reason.ts` 的 `onChunk` 中将新的 `tool-call-delta` 映射到 `ProviderChunk`。
4. 更新 `agent-stream.ts` 的 `AgentStreamController`，内部维护 `contentIndex` 和内容块数组，对旧事件自动补齐 `contentIndex`。
5. 更新 `stream-aggregators.ts`，使其同时支持 `contentIndex` 聚合。
6. 补充单元测试：
   - 多文本块交错不合并。
   - 工具调用部分 JSON 流式累积。
   - 旧事件类型转换后仍有正确 `contentIndex`。

### 阶段 2：Agent 循环与生命周期事件（2-3 天）

1. 在 `run-agent.ts` / `loop-strategy.ts` 中区分 `message-done`（单次 LLM 响应结束）与 `agent-done`（最终结束）。
2. 将 `finish` 事件统一改为 `agent-done`，保留 `finish` 作为别名（兼容层）。
3. 将 `error` 事件 payload 改为 `StreamErrorInfo`，但保留旧 Error 对象的兼容转换。

### 阶段 3：bridge 序列化/解析（1-2 天）

1. 更新 `packages/bridge/src/sse.ts` 的 `parseAgentStreamEvent`，对旧格式事件调用兼容转换。
2. 在 `packages/bridge/src/client.ts` 导出新的类型守卫。
3. 更新 bridge 测试。

### 阶段 4：web UI 消费（3-5 天）

1. 新增 `contentIndex` 驱动的消息状态更新逻辑（建议先在 `use-agents.ts` 中实验性实现）。
2. 更新 `message-item.tsx` 以按 `contentIndex` 渲染。
3. 更新 `tool-call-block.tsx` 支持部分参数实时渲染。
4. 在 `reasoning-block.tsx` 中利用 `contentIndex` 读取对应块。
5. 保留旧类型守卫和旧 reduce 逻辑直到 UI 验证通过。

### 阶段 5：清理与全面回归（2-3 天）

1. 删除 core 内部对旧事件的依赖（如果 UI 已完全迁移）。
2. 保留公开兼容转换函数，但加 `/** @deprecated */` 标记。
3. 运行全量测试 `pnpm typecheck && pnpm test`。
4. 更新相关文档（`docs/core-design.md`、`packages/core/README.md`）。

### 推荐优先级

**先改 core 类型和兼容层，再改 Provider 工具流式，最后改 UI 消费。** 这样可以保证：

- bridge/web 在 core 稳定后对接新事件。
- 如果 UI 迁移周期较长，core 仍能输出旧事件，系统可用。
- 单元测试在每一阶段都能保护已有功能。

---

## 7. 向后兼容性策略

### 7.1 保留旧事件类型

在 `AgentStreamChunk` 和 `ProviderChunk` 中，旧事件类型（如 `tool-call`、不带 `contentIndex` 的 `text-delta`、旧的 `finish`）继续作为联合成员存在。Core 在转换时：

- 旧 Provider 事件 → `AgentStreamController` 自动补齐 `contentIndex`（按顺序分配）。
- 新 Provider 事件 → 直接透传 `contentIndex`。
- 旧 UI 只消费旧事件；新 UI 消费新事件。

### 7.2 提供兼容转换函数

```ts
// packages/core/src/stream/compat.ts
export function normalizeAgentStreamChunk(chunk: AgentStreamChunk): AgentStreamChunk {
  if ('contentIndex' in chunk && chunk.contentIndex === undefined) {
    // 旧事件：根据 partId 和类型分配 contentIndex
    return { ...chunk, contentIndex: allocateContentIndex(chunk) };
  }
  return chunk;
}

export function errorToStreamErrorInfo(error: Error): StreamErrorInfo {
  return { name: error.name, message: error.message, stack: error.stack };
}
```

### 7.3 SSE 解析兼容

`parseAgentStreamEvent` 在反序列化后调用 `normalizeAgentStreamChunk`：

```ts
export function parseAgentStreamEvent(event: SSEEvent): AgentStreamChunk {
  try {
    return normalizeAgentStreamChunk(JSON.parse(event.data));
  } catch {
    return { type: 'error', error: { name: 'ParseError', message: ... } };
  }
}
```

### 7.4 版本标记（可选）

若未来需要彻底切换，可在 SSE 中添加 `event: chunk-v2`，由 `parseSSEStream` 根据 `event` 字段选择解析器。当前阶段不需要，因为新/旧事件可在同一 JSON 中兼容。

### 7.5 测试保障

- 在 `packages/core/tests` 中保留旧事件测试用例，确保旧事件不会突然失效。
- 在 bridge/web 测试中覆盖“旧服务端 → 新客户端”和“新服务端 → 旧客户端”的交叉场景。

---

## 8. 风险与注意事项

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| **类型联合膨胀** | 新/旧事件同时存在会导致 `AgentStreamChunk` 类型变宽，TypeScript 的 `switch` 分支检查可能漏掉。 | 增加 `assertNever` 辅助函数；在 CI 中开启 `--noUncheckedIndexedAccess` 和严格模式；定期发布主版本移除旧类型。 |
| **部分 JSON 解析失败** | `parseStreamingJson` 对未完成的 JSON 做最佳努力解析，可能返回 `{}` 或部分对象，UI 需防御性读取字段。 | 在 `tool-call-block.tsx` 中对每个字段做 `??` 兜底；文档中明确“`partialArguments` 可能不完整”。 |
| **contentIndex 不一致** | 不同 Provider 对内容块的索引方式不同，OpenAI 的 `tool_calls[].index` 可能缺失，Anthropic 的 `event.index` 是块级索引。 | 在 Provider 实现中统一映射为 `contentIndex`；`AgentStreamController` 校验并补全。 |
| **UI 状态双写** | `use-agents.ts` 中同时维护 `parts` 和 `contentBlocks` 两套状态可能导致不一致。 | 迁移期内以 `contentBlocks` 为权威，`parts` 由 `contentBlocks` 派生；旧组件只读 `parts`。 |
| **网络序列化 Error 对象** | 旧 `error` 事件携带 `Error` 实例，JSON.stringify 会丢失部分字段。 | 新 `StreamErrorInfo` 仅含可序列化字段；bridge 层对旧 Error 做转换。 |
| **聚合器行为变更** | `aggregateText` 和 `aggregateSteps` 现在按 `contentIndex` 聚合，可能改变旧测试期望。 | 保留旧函数签名，内部先做兼容转换；补充新聚合函数并在新路径使用。 |
| **性能影响** | 每个事件都携带 `partial` 快照会增加网络/内存开销。 | `partial` 设为可选；core 本地流不发送，bridge 发送时可选开启；网络流默认不携带 `partial`。 |
| **多 Provider 维护成本** | 每个 Provider 都需要实现 `tool-call-start/delta/end`，新增 Provider 接入成本上升。 | 在 `InferenceEngine` 或 `api-registry` 中提供统一工具调用累积 helper，减少重复代码。 |

---

## 附录：参考源码位置

- REM 类型：`/Users/guoshencheng/Documents/work/rem/packages/core/src/types.ts`
- REM LLM 类型：`/Users/guoshencheng/Documents/work/rem/packages/core/src/llm/types.ts`
- REM AgentStreamController：`/Users/guoshencheng/Documents/work/rem/packages/core/src/stream/agent-stream.ts`
- REM 聚合器：`/Users/guoshencheng/Documents/work/rem/packages/core/src/stream/stream-aggregators.ts`
- REM 推理入口：`/Users/guoshencheng/Documents/work/rem/packages/core/src/reason/reason.ts`
- REM 流收集器：`/Users/guoshencheng/Documents/work/rem/packages/core/src/llm/stream-collector.ts`
- REM 流分区：`/Users/guoshencheng/Documents/work/rem/packages/core/src/llm/partition-stream.ts`
- REM SSE：`/Users/guoshencheng/Documents/work/rem/packages/bridge/src/sse.ts`
- REM UI 类型守卫：`/Users/guoshencheng/Documents/work/rem/packages/web/src/lib/types.ts`（注：用户原指定的 `packages/web/src/lib/stream-parser.ts` 在当前仓库中不存在）
- REM 消息组件：`/Users/guoshencheng/Documents/work/rem/packages/web/src/components/chat/message-item.tsx`
- REM 推理块：`/Users/guoshencheng/Documents/work/rem/packages/web/src/components/chat/reasoning-block.tsx`
- REM 工具调用块：`/Users/guoshencheng/Documents/work/rem/packages/web/src/components/chat/tool-call-block.tsx`
- pi-ai 类型：`/Users/guoshencheng/Documents/work/opensource/pi/packages/ai/src/types.ts`
- pi-ai 事件流：`/Users/guoshencheng/Documents/work/opensource/pi/packages/ai/src/utils/event-stream.ts`
- pi-ai OpenAI 实现：`/Users/guoshencheng/Documents/work/opensource/pi/packages/ai/src/api/openai-completions.ts`
- pi-ai Anthropic 实现：`/Users/guoshencheng/Documents/work/opensource/pi/packages/ai/src/api/anthropic-messages.ts`
- pi-ai README 事件参考：`/Users/guoshencheng/Documents/work/opensource/pi/packages/ai/README.md`（“Complete Event Reference” 与 “Streaming Tool Calls with Partial JSON” 章节）
