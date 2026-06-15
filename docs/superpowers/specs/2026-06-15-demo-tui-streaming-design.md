# Demo TUI 流式输出设计

## 背景

`packages/core` 的 `InferenceEngine.infer()` 已经支持通过 `onChunk` 回调消费 LLM 流式输出，并且已经把 `<think>` / `<thinking>` / `<thought>` 标签实时分区为 `text` 和 `reasoning` 两种 chunk。但 `ReactLoop` 目前没有把这个能力向上暴露，`CoreAgent.run()` 仍然只返回 `Promise<AgentOutput>`，Demo TUI 要等整个 turn 结束后才能拿到结果并显示。

当前 Demo 的交互机制也比较分裂：

- 通过 `createDemoAgent` 的 `AgentCallbacks` 监听生命周期事件（`turn:before`、`phase:reason:before` 等）。
- 通过 `await agent.run(...)` 拿最终结果。
- 没有统一入口消费流式内容。

## 目标

1. `CoreAgent` 直接支持把 LLM 流式输出暴露给外部 UI。
2. Demo TUI 能实时显示 assistant 正文和 reasoning 过程。
3. 支持未来多 iteration 的 ReAct 循环：多轮 loop iteration 最终合并成一次 `run()` 的**一条 assistant message**，内部用多个 part / step 表示。
4. `CoreAgent.run()` 同步返回 `AgentStreamResult`，包含 `stream`（可立即消费）和 `output`（最终结果的 Promise），参考 Vercel `streamText()` 的返回方式。
5. `AgentStream` 采用 **AsyncIterable** 增量 parts 模型，参考 Vercel AI SDK；不采用 snapshot / subscribe 模式，也不在 stream 中推送完整 conversation。

## 对标 Vercel AI SDK

Vercel AI SDK 解决同类问题的方式：

- `streamText()` 内部可以执行多步 tool-call loop，但对外只暴露**一个 stream**。
- stream 中的每条 assistant message 由多个 `parts` 组成：`text`、`reasoning`、`tool-invocation` 等。
- 多步之间通过 `step-start` / `step-finish` 等边界 chunk 区分，但最终仍属于**同一条 message**。
- UI 层通过 `useChat` 消费单一 stream，内部把 parts 组装成 message 列表。
- `streamText()` 返回 `StreamTextResult`，除 `fullStream`（`AsyncIterable<StreamPart>`）外，还提供 `text`、`usage`、`steps` 等聚合 Promise。

映射到我们的设计：

- 一次 `CoreAgent.run()` 对应 Vercel 的一次 `streamText()` 调用。
- 一次 `run()` 最终产出**一条 assistant message**。
- `AgentStreamChunk` 序列对应 Vercel 的 message `parts`。
- loop iteration 对应 Vercel 的 `step`，用 `step-start` / `step-finish` 边界标识。
- `CoreAgent.run()` 同步返回 `AgentStreamResult`，和 `streamText()` 返回 `StreamTextResult` 一致。
- `AgentStreamResult.stream` 可立即消费；`AgentStreamResult.output` 是最终聚合 Promise。

## 数据模型与分层

### 三层数据模型

| 层级 | 数据模型 | 说明 |
|---|---|---|
| **Core 内部 / 持久化** | `ModelMessage`（来自 `ai` 包） | 标准对话消息。assistant content 可以是 `string` 或 parts 数组，parts 包含 `text`、`reasoning`、`tool-call`、`tool-result`。 |
| **流式输出** | `AgentStreamChunk` / `AgentStream` | 一次 `run()` 对外暴露的流。`AgentStream` 是 `AsyncIterable<AgentStreamChunk>`，同时提供聚合 Promise。 |
| **Provider 输入/输出** | Provider-specific format | OpenAI SDK `ChatCompletionMessageParam[]`、Anthropic SDK `MessageParam[]` 等。 |

### 处理层职责

```
┌─────────────────────────────────────────────────────────────┐
│  CoreAgent.run(input)                                        │
│  - 创建 AgentStream 与 AgentStreamResult                     │
│  - 启动 ReactTurnRunner.run(ctx, hooks, stream) 异步任务     │
│  - 同步返回 AgentStreamResult                                │
│  - run() 内部异步任务结束后 resolve output Promise           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  ReactTurnRunner.run()                                       │
│  - 管理多 step（当前仅 1 步，未来可扩展）                      │
│  - 每个 step 前后推入 step-start / step-finish 边界            │
│  - 调用 ReactLoop.iterate(loopCtx, stream, step)             │
│  - 多 step 共用同一个 AgentStream                             │
│  - 把每个 step 的 parts 追加到该 run 的 assistant message     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  ReactLoop.iterate(ctx, stream, step)                        │
│  - 准备 system + messages                                    │
│  - 调用 InferenceEngine.infer({ ..., onChunk })              │
│  - 把 InferenceEngine 的 StreamChunk 转成 AgentStreamChunk   │
│  - 执行 tool calls，生成 tool-result chunk                   │
│  - 把当前 step 的 parts 追加到 assistant message             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  InferenceEngine.infer()                                     │
│  - 调用 provider.stream()                                    │
│  - partitionProviderStream() 把 raw text 中的 thinking tags  │
│    分区成 text / reasoning StreamChunk                       │
│  - 返回 provider-neutral 的 StreamChunk 序列                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  LLMProvider（openai / anthropic）                           │
│  - 把 GenerateOptions.messages（ModelMessage[]）              │
│    转成 provider-specific messages                           │
│  - 调用底层 SDK                                              │
│  - 把底层事件转成 StreamChunk                                │
└─────────────────────────────────────────────────────────────┘
```

### 各层转换规则

#### 1. `ModelMessage` → Provider-specific messages

**OpenAI provider**（当前只支持 string，需要改造）：

```ts
function convertAssistantContent(content: AssistantContent) {
  if (typeof content === 'string') return { content };

  const text = content
    .filter(p => p.type === 'text')
    .map(p => p.text)
    .join('');

  const toolCalls = content
    .filter(p => p.type === 'tool-call')
    .map(p => ({
      id: p.toolCallId,
      type: 'function' as const,
      function: { name: p.toolName, arguments: JSON.stringify(p.input) },
    }));

  // reasoning parts：OpenAI 输入不支持，丢弃
  // （不向模型发送 reasoning 内容，避免污染后续对话）

  return {
    role: 'assistant',
    content: text,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}
```

**Anthropic provider**（已支持 parts 数组）：

```ts
for (const part of content) {
  if (part.type === 'text') blocks.push({ type: 'text', text: part.text });
  if (part.type === 'tool-call') blocks.push({ type: 'tool_use', id, name, input });
  // reasoning parts：当前丢弃，未来可映射到 Anthropic reasoning
}
```

#### 2. Provider events → `StreamChunk`

`StreamChunk` 是 provider-neutral 的增量事件：

```ts
type StreamChunk =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'usage'; inputTokens: number; outputTokens: number; totalTokens: number }
  | { type: 'finish'; reason: string };
```

OpenAI provider：`delta.content` → `text`，`delta.tool_calls` → `tool-call`。  
Anthropic provider：`content_block_delta.text_delta` → `text`，`content_block_start.tool_use` → `tool-call`。

#### 3. `StreamChunk` → `AgentStreamChunk`

`ReactLoop` 在收到 `StreamChunk` 时，补充 `step` 编号并转成增量 parts：

```ts
// 收到第一个 text StreamChunk
stream.append({ type: 'step-start', step });
stream.append({ type: 'text-delta', step, text: chunk.text });

// 连续 text 继续追加到同一个 text-delta
// 收到 reasoning 时直接追加 reasoning-delta
```

#### 4. `AgentStreamChunk` → `ModelMessage` parts

一次 `run()` 在内部维护**一条** assistant message。每个 step 结束后，`ReactLoop` 把该 step 的 parts 追加到这条 message；多个 step 的 parts 最终合并成同一条 `ModelMessage`：

```ts
// ReactTurnRunner 在 run 开始时创建空 assistant message
const assistantMsg: ModelMessage = { role: 'assistant', content: [] };
state.addMessage(assistantMsg);

// 每个 step 结束后，ReactLoop 把该 step 的 parts 追加进去
const currentParts = assistantMsg.content as AssistantContent;
for (const chunk of stepChunks) {
  if (chunk.type === 'text-delta') currentParts.push({ type: 'text', text: chunk.text });
  if (chunk.type === 'reasoning-delta') currentParts.push({ type: 'reasoning', text: chunk.text });
  if (chunk.type === 'tool-call') currentParts.push({ type: 'tool-call', toolCallId, toolName, input });
  if (chunk.type === 'tool-result') currentParts.push({ type: 'tool-result', toolCallId, output, error });
}
```

`AssistantContent` 指 `ai` 包中 `assistant` role 的 content 类型（`string | Array<TextPart | ReasoningPart | ToolCallPart | ...>`）。

## 设计

### 对外 API

```ts
// packages/core/src/types.ts
export type AgentStreamChunk =
  | { type: 'step-start'; step: number }
  | { type: 'text-delta'; step: number; text: string }
  | { type: 'reasoning-delta'; step: number; text: string }
  | { type: 'tool-call'; step: number; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-result'; step: number; toolCallId: string; output: string; error?: string }
  | { type: 'step-finish'; step: number }
  | { type: 'finish'; output: AgentOutput }
  | { type: 'error'; error: Error };

export interface AgentStreamStepResult {
  step: number;
  text: string;
  reasoning: string;
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    input: unknown;
    output?: string;
    error?: string;
  }>;
}

export interface AgentStream {
  /** 增量 parts 流 */
  fullStream: AsyncIterable<AgentStreamChunk>;

  /** 当前 run 的 assistant message 完整文本 */
  text: Promise<string>;

  /** token 使用量 */
  usage: Promise<LanguageModelUsage>;

  /** 每个 step 的聚合结果 */
  steps: Promise<AgentStreamStepResult[]>;
}
```

```ts
// packages/core/src/core-agent.ts
export interface AgentStreamResult {
  /** 当前 run 的流式输出 */
  stream: AgentStream;

  /** 当前 run 的最终输出 Promise */
  output: Promise<AgentOutput>;
}

export class CoreAgent {
  get conversation(): ModelMessage[];
  run(input: UserInput): AgentStreamResult;
}
```

### `AgentStream` 实现要点

新增 `packages/core/src/stream/agent-stream.ts`：

```ts
export class AgentStreamController {
  private queue: AgentStreamChunk[] = [];
  private pending: Array<(chunk: AgentStreamChunk | undefined) => void> = [];
  private finished = false;
  private error?: Error;

  append(chunk: AgentStreamChunk): void {
    if (this.finished) return;
    this.queue.push(chunk);
    const resolve = this.pending.shift();
    if (resolve) resolve(chunk);
  }

  finish(output: AgentOutput): void {
    this.append({ type: 'finish', output });
    this.finished = true;
    for (const resolve of this.pending) resolve(undefined);
    this.pending = [];
  }

  fail(error: Error): void {
    this.append({ type: 'error', error });
    this.finished = true;
    this.error = error;
    for (const resolve of this.pending) resolve(undefined);
    this.pending = [];
  }

  get stream(): AgentStream {
    return {
      fullStream: this.createIterator(),
      text: this.aggregateText(),
      usage: this.aggregateUsage(),
      steps: this.aggregateSteps(),
    };
  }

  private createIterator(): AsyncIterable<AgentStreamChunk> { /* ... */ }
  private aggregateText(): Promise<string> { /* ... */ }
  private aggregateUsage(): Promise<LanguageModelUsage> { /* ... */ }
  private aggregateSteps(): Promise<...> { /* ... */ }
}
```

核心行为：

- `append()` 把 chunk 推入 queue，并唤醒正在等待的 consumer。
- `finish()` / `fail()` 标记结束，并产出 `finish` 或 `error` chunk。
- `fullStream` 支持单个 consumer 通过 `for await` 消费；若需多处订阅，由调用方自行广播。
- `text` / `usage` / `steps` 在 stream 结束时 resolve。

### 内部数据流

一次 `run()` 只创建并暴露一个 `AgentStream`，内部多轮 loop 都往同一个 stream 推 chunk：

```
UserInput
  └─ CoreAgent.run(input)
       ├─ 创建 AgentStream 与 AgentStreamResult
       ├─ 同步返回 AgentStreamResult                    // 调用方立即消费 stream
       ├─ emit core-agent:start
       ├─ 启动 ReactTurnRunner.run(ctx, hooks, stream) 异步任务
       │    ├─ step 1
       │    │    ├─ stream.append({ type: 'step-start', step: 1 })
       │    │    ├─ ReactLoop.iterate(loopCtx, stream, 1)
       │    │    │    ├─ 准备 system + messages
       │    │    │    ├─ InferenceEngine.infer({ ..., onChunk })
       │    │    │    │    ├─ text chunk → stream.append({ type: 'text-delta', step: 1, text: '...' })
       │    │    │    │    ├─ reasoning chunk → stream.append({ type: 'reasoning-delta', ... })
       │    │    │    │    ├─ tool-call chunk → stream.append({ type: 'tool-call', ... })
       │    │    │    │    └─ finish chunk → 结束 infer
       │    │    │    ├─ 执行 tool calls（如有）
       │    │    │    │    → stream.append({ type: 'tool-result', ... })
       │    │    │    └─ 把 step 1 的 parts 追加到 assistant message
       │    │    └─ stream.append({ type: 'step-finish', step: 1 })
       │    ├─ step 2 (if needed)
       │    │    └─ ...
       │    └─ return TurnResult
       ├─ stream.finish(output)
       ├─ emit core-agent:stop
       └─ resolve AgentStreamResult.output
```

注意：

- 没有 `messages` chunk；完整 conversation 不走 stream。
- `finish` chunk 之后 consumer 的 `for await` 自然结束。
- `ReactTurnRunner` 内多个 step 产生的 parts 追加到同一条 assistant message。

### Demo TUI 调用方式

```ts
const agent = createDemoAgent(config.agentName, config.maxTurns);

app.onSubmit((text) => {
  app.addUserMessage(text);

  const result = agent.run({ content: text });
  const message = app.startAssistantMessage();

  (async () => {
    for await (const chunk of result.stream.fullStream) {
      message.appendChunk(chunk);
    }
  })();

  result.stream.text.then((text) => {
    app.finalizeAssistantMessage(text);
  });

  result.output
    .then(() => {
      app.updateConversation(agent.conversation);
    })
    .catch((error) => {
      app.showError(error);
    });
});
```

### 历史对话同步

`AgentStream` 只表示当前 run 的 assistant message。历史 conversation 的刷新走 `output` Promise 结束后的同步路径：

- `CoreAgent` 暴露 `conversation` getter，返回当前会话的完整消息列表。
- `result.output` resolve 后，调用方从 `agent.conversation` 读取完整历史。
- Demo TUI 在 `result.output.then(...)` 中调用 `app.updateConversation(...)`。

### UI 组件调整

- `packages/demo/src/tui/chat-log.ts`：新增 `startAssistantMessage()` 返回可更新组件。
- `packages/demo/src/tui/message.ts`：新增 `StreamAssistantMessage`，内部按 parts 渲染：
  - `text-delta` 累积 → 正文 Markdown
  - `reasoning-delta` 累积 → 可折叠 reasoning 区域
  - `tool-call` / `tool-result` → 工具调用卡片
- `packages/demo/src/tui/app.ts`：新增 `startAssistantMessage` / `finalizeAssistantMessage` / `updateConversation` 方法。

### 错误处理

- 流内部错误通过 `{ type: 'error' }` chunk 推入 stream，并结束 stream。
- `InferenceEngine.infer()` 抛出的异常由 `ReactLoop` catch 后转成 error chunk 推入 stream，并继续向上抛给 `CoreAgent.run()`，由调用方 `try/catch` 决定是否退出或重试。

## 关键文件

- `packages/core/src/types.ts` — 新增 `AgentStreamChunk`、`AgentStream`、`AgentStreamResult`
- `packages/core/src/stream/agent-stream.ts` — `AgentStreamController` 与 `AgentStream` 实现
- `packages/core/src/core-agent.ts` — `AgentStreamResult` 与同步 `run()` 集成
- `packages/core/src/loop-strategy.ts` — `ReactLoop.iterate()` 接收 stream 并推入 chunk
- `packages/core/src/turn.ts` — `ReactTurnRunner.run()` 创建单一 stream，多轮 step 共用
- `packages/demo/src/agent.ts` — `createDemoAgent` 适配新的 `run()` 签名
- `packages/demo/src/tui/app.ts` / `chat-log.ts` / `message.ts` — 流式 UI 渲染

## 测试计划

- `packages/core/tests/stream/agent-stream.test.ts`
  - `AgentStreamResult` 同步返回
  - 增量 chunks 按顺序产出
  - 连续 `text-delta` 可由 consumer 自行累加
  - `text` / `usage` / `steps` Promise 在 stream 结束时 resolve
  - `error` chunk 后 stream 结束
  - 单个 consumer 通过 `for await` 完整消费
- `packages/core/tests/llm/engine.test.ts` 已覆盖流式 partition，无需重复
- `packages/core/tests/loop-strategy.test.ts`（新建或更新）
  - `ReactLoop.iterate()` 向 stream 推入 text / reasoning / tool-call / step-finish
  - 有 tool calls 时推入 tool-result
- `packages/core/tests/core-agent.test.ts`
  - `run()` 同步返回 `AgentStreamResult`
  - `result.stream` 可立即消费
  - `result.output` 在 run 结束后 resolve
  - 多 step 场景下只返回一个 stream
  - 最终 state 中只新增一条 assistant message
- `packages/demo` 测试
  - `StreamAssistantMessage.appendChunk` 正确渲染 parts

## Trade-offs

- **AsyncIterable vs snapshot/subscribe**：参考 Vercel AI SDK，调用方通过 `for await` 消费增量 parts，自己维护渲染状态；`AgentStream` 同时提供 `text` / `usage` / `steps` 聚合 Promise，减少 boilerplate。
- **单一 stream vs 每轮一个 stream**：一次 run 一个 stream 更简洁，UI 只需管理一个迭代器；step 边界通过 `step-start` / `step-finish` chunk 表达。
- **移除 `messages` chunk**：stream 语义更纯粹，只表示当前 assistant message；完整 history 刷新走 `run()` 结束后的同步路径。
- **`run()` 同步返回 `AgentStreamResult`**：和 Vercel `streamText()` 一致，调用方立即拿到 stream；代价是 `run()` 不再是 `Promise<AgentOutput>`，现有调用方需要调整。
