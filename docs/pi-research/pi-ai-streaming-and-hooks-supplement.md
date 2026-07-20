# pi-ai 切换补充：流式事件变化与自定义前后置操作兼容性

> 针对《pi-ai-adoption-report.md》中未充分展开的两个问题做细化：
> 1. 切换到 pi-ai 后，流式事件具体会变成什么样？
> 2. REM 当前在 AI 调用前后做的自定义检查/操作，能否在 pi-ai 上实现？

---

## 1. 执行摘要

- **流式事件会变得更多、更结构化**。pi-ai 把原来 REM 的 `text`/`reasoning`/`tool-call`/`usage`/`finish` 五种事件，扩展为带生命周期的 `text_start/delta/end`、`thinking_start/delta/end`、`toolcall_start/delta/end`、`done`/`error`，并附带 `contentIndex` 和 `partial` 状态。
- **REM 当前的所有前后置自定义操作都可以保留或映射到 pi-ai**。pi-ai 本身只负责“把请求发出去并把流式事件返回”，不干预调用前的 context 构建、压缩、预算检查、system prompt 组装；调用后的 usage 汇总、消息持久化、错误处理也仍然由 REM 控制。
- **pi-ai 原生提供了一些 REM 原本需要自己实现的 hook**：`onPayload`（请求前检查/修改 payload）、`onResponse`（响应后检查 HTTP 状态/头）、`signal`（abort）、`maxRetries`/`maxRetryDelayMs`。REM 可以按需复用，但建议把核心业务逻辑（如 retry、error 分类）留在 Core。
- **最需要注意的是错误处理形态变化**：pi-ai 把错误编码为流内的 `error` 事件，最终 `AssistantMessage.stopReason === 'error'`，而不是直接抛异常。REM 的 adapter 需要在流结尾把这个事件重新抛出，才能与现有 `reason.ts` 的 retry 逻辑兼容。

---

## 2. REM 当前 AI 调用全流程中的自定义操作点

REM 的调用链路大致如下（从 `run-agent.ts` 到 `reason.ts`）：

```
run-agent.ts
  ├─ 调用前：contextProvider.build() → 历史消息 + system prompt
  ├─ 调用前：compressor.shouldCompress() / compress() → 上下文压缩
  ├─ 调用前：budgetPolicy.checkTurn() / checkTimeout() → 预算检查
  ├─ 调用前：systemPromptAssembler.assemble() → 组装系统提示
  ├─ 调用前：toolComposer.compose() → 合并 toolProvider + MCP + skill
  ├─ 调用前：resolveProviderConfig() → 解析 apiKey/baseURL/model
  │
  ▼
reason.ts
  ├─ 调用中：resolveProvider() → 取 LLMProvider
  ├─ 调用中：llmProvider.stream() → 获取 StreamChunk
  ├─ 调用中：InferenceEngine.infer() → 聚合流
  ├─ 调用中：partitionProviderStream() → <thinking> 标签分区
  ├─ 调用中：onChunk 转换 → StreamChunk → ProviderChunk
  ├─ 调用中：3 次 retry（基于 errorHandler.classify/isRetryable）
  │
  ▼
stream-collector.ts
  ├─ 调用后：聚合 text/reasoning/tool-call/usage/finish
  ├─ 调用后：stripThinkingTags() → 从 text 中剥离 thinking 标签
  │
  ▼
run-agent.ts
  ├─ 调用后：liveState.addTokenUsage() → 累计 token
  ├─ 调用后：sessionProvider.save() → 持久化会话
  ├─ 调用后：publishUsageChange / publishSessionError → 事件总线
```

这些操作可以分成三类：

| 阶段 | REM 操作 | 是否在 pi-ai 中保留 |
|---|---|---|
| 调用前 | context 构建、压缩、budget、system prompt、tool 组装 | 在 pi-ai 外保留，pi-ai 不干预 |
| 调用中 | 流式解析、thinking 分区、onChunk 转换、retry | 部分由 pi-ai 替代，部分由 REM adapter 完成 |
| 调用后 | usage 汇总、消息持久化、事件发布、error 处理 | 在 pi-ai 外保留，由 REM 控制 |

---

## 3. 切换到 pi-ai 后的流式事件具体变化

### 3.1 事件类型对照表

| REM 当前 `StreamChunk` | pi-ai `AssistantMessageEvent` | 说明 |
|---|---|---|
| `{ type: 'text', text }` | `text_start` → 多次 `text_delta` → `text_end` | REM 只有 text delta；pi-ai 会明确告知 text 块开始/结束 |
| `{ type: 'reasoning', text }` | `thinking_start` → 多次 `thinking_delta` → `thinking_end` | pi-ai 直接给出 thinking 块，无需 REM 用 `<thinking>` 标签解析 |
| `{ type: 'tool-call', toolCallId, toolName, input }` | `toolcall_start` → 多次 `toolcall_delta` → `toolcall_end` | REM 只在完成时拿到完整 tool-call；pi-ai 在 argument 流式解析过程中也发送 delta |
| `{ type: 'usage', ... }` | 不单独 emit，但 `partial.usage` 会更新 | pi-ai 在底层 chunk 里更新 usage，最终 `AssistantMessage.usage` 包含完整数据 |
| `{ type: 'finish', reason }` | `done` 或 `error` | pi-ai 用 `done` 表示成功终止，`error` 表示失败/abort |
| 无 | `start` | pi-ai 流开始时会发送初始 `partial` 骨架 |
| 无 | `contentIndex` | 标识当前 delta 属于 `partial.content` 数组的哪个索引 |

### 3.2 pi-ai 流式事件完整序列示例

一次 OpenAI 的流式 tool-call 响应，pi-ai 可能这样 emit：

```text
start
  partial: { role: 'assistant', content: [], usage: {...}, stopReason: 'stop', ... }

text_start
  contentIndex: 0
  partial.content[0]: { type: 'text', text: '' }

text_delta
  contentIndex: 0
  delta: 'I will call the '
  partial.content[0].text: 'I will call the '

text_delta
  contentIndex: 0
  delta: 'weather tool.'
  partial.content[0].text: 'I will call the weather tool.'

text_end
  contentIndex: 0
  content: 'I will call the weather tool.'

toolcall_start
  contentIndex: 1
  partial.content[1]: { type: 'toolCall', id: '', name: '', arguments: {} }

toolcall_delta
  contentIndex: 1
  delta: '{"location": "Beijing"'
  partial.content[1].arguments: { location: 'Beijing' }   // partial JSON 已解析

toolcall_delta
  contentIndex: 1
  delta: '}'
  partial.content[1].arguments: { location: 'Beijing' }

toolcall_end
  contentIndex: 1
  toolCall: { type: 'toolCall', id: 'call_xxx', name: 'get_weather', arguments: { location: 'Beijing' } }

done
  reason: 'toolUse'
  message: { ... 最终 AssistantMessage ... }
```

### 3.3 关键变化点

#### 变化 1：每个 content block 都有开始/结束边界

REM 当前拿到 `{ type: 'text', text: 'Hello' }` 和 `{ type: 'text', text: ' world' }` 时，UI 层需要自己做拼接。pi-ai 会明确说：
- `text_start`：新的 text block 开始
- `text_delta`：block 内容追加
- `text_end`：block 结束

**对 REM 的好处**：Web UI 可以按 block 渲染，避免频繁 re-render 整个 message；未来如果要做“复制某一段文本”或“折叠某一段 reasoning”，有精确边界。

#### 变化 2：thinking 块由 pi-ai 直接识别

REM 当前依赖 `partition-stream.ts` 中的 `ThinkingTagPartitioner` 从 text 中解析 `<thinking>...</thinking>` 标签。pi-ai 的 OpenAI/Anthropic API 实现会：
- OpenAI：从 `choice.delta.reasoning_content` / `reasoning` / `reasoning_text` 字段提取，emit `thinking_delta`。
- Anthropic：从 `content_block_start` 的 `thinking` 类型和 `thinking_delta` 提取，emit `thinking_delta`。

**对 REM 的好处**：可以删除 `partition-stream.ts` 和 `strip-thinking-tags.ts` 中的部分逻辑， thinking/text 分离由 pi-ai 保证。

#### 变化 3：tool-call 参数支持流式增量解析

REM 当前的 OpenAI adapter 在 `finish_reason === 'tool_calls'` 时才一次性 yield 完整 tool-call。pi-ai 在 `toolcall_delta` 中会把 `partialArgs` 做 `parseStreamingJson()`，因此在参数未写完时，`partial.content[contentIndex].arguments` 就已经是“已解析部分”的 JSON 对象。

**对 REM 的好处**：如果 Web UI 想实现“参数填到 location 时就高亮显示”，pi-ai 可以直接提供；REM 当前实现需要重写 parser 才能做到。

#### 变化 4：错误不再抛异常，而是流内 `error` 事件

REM 当前底层 SDK 抛异常，`reason.ts` 用 `try/catch` 捕获。pi-ai 会把所有错误编码成流内的 `error` 事件，最终 `AssistantMessage.stopReason` 为 `'error'` 或 `'aborted'`。

**对 REM 的适配要求**：在 `convert-pi-to-rem.ts` 中，遍历完事件后调用 `await stream.result()`，检查 `message.stopReason`，如果是 `error`/`aborted` 则 `throw new Error(message.errorMessage)`。这样才能让 REM 上层的 retry/budget/error 处理继续工作。

---

## 4. 每条自定义操作在 pi-ai 中能否实现

### 4.1 调用前操作：全部可以保留

| REM 操作 | pi-ai 中的位置 | 说明 |
|---|---|---|
| `contextProvider.build()` | 在调用 `models.stream()` 之前 | pi-ai 只消费 `Context`，不干预构建 |
| `compressor.compress()` | 在调用 `models.stream()` 之前 | REM 把压缩后的 messages 传给 pi-ai |
| `budgetPolicy.checkTurn()` | 在调用 `models.stream()` 之前 | 完全由 REM 控制 |
| `systemPromptAssembler.assemble()` | 转成 `Context.systemPrompt` | pi-ai 只接收字符串 |
| `toolComposer.compose()` | 转成 `Context.tools` | 需要把 REM 的 `ToolSet` 转成 pi-ai 的 `Tool[]` |
| `resolveProviderConfig()` | 转成 `Models.stream()` 的 `options.apiKey/baseURL` | 仍由 Core 解析配置 |

**结论**：调用前的所有自定义逻辑都在 pi-ai 之外，pi-ai 只是“被调用方”。REM 需要做的只是把最终结果（`Context` + `options`）传给 pi-ai。

### 4.2 调用中操作：部分由 pi-ai 替代，部分由 adapter 完成

| REM 操作 | pi-ai 替代/映射 | 说明 |
|---|---|---|
| `resolveProvider()` → 取 LLMProvider | `models.getModel(provider, model)` | 从 `Models` 集合查找 model |
| `llmProvider.stream()` | `models.stream(model, context, options)` | 统一入口 |
| `InferenceEngine.infer()` 聚合流 | 仍可保留，但输入变成 `AssistantMessageEvent` | 需要把 pi-ai 事件转成 REM 的 `StreamChunk` |
| `partitionProviderStream()` 解析 `<thinking>` | 可删除 | pi-ai 直接 emit thinking 事件 |
| `onChunk` 转换 StreamChunk → ProviderChunk | 改造为 `piEvent → StreamChunk → ProviderChunk` | 需要新增 `convert-pi-to-rem.ts` |
| 3 次 retry | 建议保留在 REM 的 `reason.ts` | pi-ai 内部 `maxRetries` 建议设为 0，避免两层 retry |
| 错误分类 `errorHandler.classify()` | 仍可保留，但输入从 SDK 异常变成 `errorMessage` | 需要 adapter 把 `error` 事件转成 Error 抛出 |

### 4.3 调用后操作：全部可以保留

| REM 操作 | pi-ai 后的做法 | 说明 |
|---|---|---|
| `liveState.addTokenUsage()` | 从 `AssistantMessage.usage` 转换 | 可增加 `cost` 字段 |
| `sessionProvider.save()` | 把 `AssistantMessage` 转成 `ModelMessage` 后保存 | 需要转换函数 |
| `publishUsageChange` / `publishSessionError` | 与现在一致 | 由 REM 事件系统处理 |
| `stripThinkingTags()` | 可简化 | thinking 已从 text 中分离，但仍需处理历史数据中可能存在的标签 |

---

## 5. pi-ai 原生支持的前后向 hooks

pi-ai 在 `StreamOptions` 中提供了两个关键 hook，正好覆盖 REM 可能需要的“调用前检查 payload”和“调用后检查响应”：

```typescript
export interface StreamOptions {
  // ...
  onPayload?: (payload: unknown, model: Model<Api>) => unknown | undefined | Promise<unknown | undefined>;
  onResponse?: (response: ProviderResponse, model: Model<Api>) => void | Promise<void>;
  // ...
}
```

### 5.1 `onPayload`：请求发送前的检查/修改

REM 当前没有直接检查 provider payload 的能力。如果 REM 想：
- 审计实际发送给 provider 的请求体；
- 在测试时注入错误 payload；
- 对某些 provider 做参数裁剪；

可以直接通过 `options.onPayload` 实现。例如：

```typescript
const s = models.stream(model, context, {
  apiKey: options.apiKey,
  onPayload: (payload) => {
    log('llm', 'provider payload', payload);
    // 可以修改 payload，返回修改后的对象
    // return modifiedPayload;
  },
});
```

**注意**：`onPayload` 接收的是具体 provider 的 payload（如 OpenAI ChatCompletionCreateParamsStreaming），类型是 `unknown`，需要按需断言。

### 5.2 `onResponse`：HTTP 响应后的检查

REM 当前也拿不到 HTTP 响应状态码。如果 REM 想：
- 记录 provider 响应头；
- 根据状态码做特定处理（如 429 触发退避）；
- 做可观测性埋点；

可以通过 `onResponse` 实现：

```typescript
const s = models.stream(model, context, {
  onResponse: (response) => {
    log('llm', 'provider response', { status: response.status });
  },
});
```

### 5.3 `signal`：abort

REM 当前通过 `signal` 传递给 SDK。pi-ai 同样支持 `options.signal`，行为是：流终止时 emit `error` 事件，`stopReason === 'aborted'`。

### 5.4 `maxRetries` / `maxRetryDelayMs`：内置重试

pi-ai 会把这个值传给底层 SDK（如 OpenAI/Anthropic SDK 的 `maxRetries`）。REM 已经实现了自己的 retry 逻辑，建议：
- 把 pi-ai 的 `maxRetries` 设为 `0`；
- 保留 REM 的 `reason.ts` 3 次 retry，因为 REM 的 retry 是基于 `errorHandler.classify()` 的，更可控。

---

## 6. 具体的适配映射：把 REM 操作嫁接到 pi-ai

### 6.1 最小改动路径（保留 REM 现有协议）

REM 不需要让上层立即改用 pi-ai 的事件协议。可以在 `llm/pi/` 里做一个 adapter：

```typescript
// packages/core/src/llm/pi/convert-pi-to-rem.ts
import type { AssistantMessageEvent, AssistantMessage } from '@earendil-works/pi-ai';
import type { StreamChunk } from '../types.js';

export function* piEventToStreamChunks(event: AssistantMessageEvent): Generator<StreamChunk> {
  switch (event.type) {
    case 'text_start':
    case 'text_end':
      // 当前 REM 不消费开始/结束，只消费 delta，可以忽略或未来扩展
      break;
    case 'text_delta':
      yield { type: 'text', text: event.delta };
      break;
    case 'thinking_start':
    case 'thinking_end':
      break;
    case 'thinking_delta':
      yield { type: 'reasoning', text: event.delta };
      break;
    case 'toolcall_start':
    case 'toolcall_delta':
      // 当前 REM 不消费 tool-call delta，可以忽略或未来扩展
      break;
    case 'toolcall_end':
      yield {
        type: 'tool-call',
        toolCallId: event.toolCall.id,
        toolName: event.toolCall.name,
        input: event.toolCall.arguments,
      };
      break;
    case 'done':
    case 'error':
      // 终止事件不转成 StreamChunk，由调用方检查 stream.result()
      break;
  }
}

export function piMessageToGenerateResult(message: AssistantMessage): GenerateResult {
  const text = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const reasoning = message.content
    .filter((b) => b.type === 'thinking')
    .map((b) => b.thinking)
    .join('\n') || undefined;

  const toolCalls = message.content
    .filter((b) => b.type === 'toolCall')
    .map((b) => ({
      toolCallId: b.id,
      toolName: b.name,
      input: b.arguments,
    }));

  return {
    text,
    reasoning,
    toolCalls,
    usage: {
      inputTokens: message.usage.input,
      outputTokens: message.usage.output,
      totalTokens: message.usage.totalTokens,
      inputTokenDetails: {
        noCacheTokens: message.usage.input - message.usage.cacheRead - message.usage.cacheWrite,
        cacheReadTokens: message.usage.cacheRead,
        cacheWriteTokens: message.usage.cacheWrite,
      },
      outputTokenDetails: {
        textTokens: message.usage.output - (message.usage.reasoning ?? 0),
        reasoningTokens: message.usage.reasoning,
      },
    },
    finishReason: message.stopReason,
  };
}
```

这样上层 `InferenceEngine`、`StreamCollector`、`reason.ts` 几乎不用改。

### 6.2 如果想利用 pi-ai 的细粒度事件

未来升级 REM 的 `ProviderChunk` / `AgentStreamChunk` 时，可以直接把 pi-ai 事件透传或轻微包装：

```typescript
export function* piEventToProviderChunks(event: AssistantMessageEvent): Generator<ProviderChunk> {
  switch (event.type) {
    case 'text_delta':
      yield { type: 'text-delta', step: 0, text: event.delta };
      break;
    case 'thinking_delta':
      yield { type: 'reasoning-delta', step: 0, text: event.delta };
      break;
    case 'toolcall_end':
      yield {
        type: 'tool-call',
        step: 0,
        toolCallId: event.toolCall.id,
        toolName: event.toolCall.name,
        input: event.toolCall.arguments,
      };
      break;
    // 未来还可以加 text-start/end、toolcall-start 等
  }
}
```

---

## 7. 需要变更的文件清单

| 文件 | 变更内容 |
|---|---|
| `packages/core/src/llm/pi/convert-pi-to-rem.ts` | 新增：pi-ai 事件 → REM `StreamChunk` / `GenerateResult` |
| `packages/core/src/llm/pi/convert-rem-to-pi.ts` | 新增：REM `ModelMessage`/`ToolSet` → pi-ai `Context`/`Tool[]` |
| `packages/core/src/llm/pi/pi-llm-provider.ts` | 新增：实现 `LLMProvider`，内部调用 `models.stream()`/`complete()` |
| `packages/core/src/llm/pi/error-adapter.ts` | 新增：把 pi-ai `error`/`aborted` 事件转成 Error 抛出 |
| `packages/core/src/llm/providers/index.ts` | 修改：增加 pi-ai 路径的注册 |
| `packages/core/src/reason/reason.ts` | 可选：保持 retry 逻辑；确认 error 抛出后能被 catch |
| `packages/core/src/llm/partition-stream.ts` | 可选：可简化，因为 pi-ai 已分离 thinking/text |
| `packages/core/src/types.ts` | 可选：在 `LanguageModelUsage` 中增加 `cost` 字段 |
| `packages/core/src/token-usage.ts` | 可选：增加 cost 累加 |

---

## 8. 风险与注意事项

1. **错误事件不抛异常**：如果 adapter 没有检查 `stream.result().stopReason`，REM 上层会以为请求成功。这是 MVP 必须验证的点。
2. **工具参数流式解析的 partial JSON 不可靠**：`toolcall_delta` 中的 `partial.content[contentIndex].arguments` 是 best-effort 解析，字段可能缺失或值被截断。只有在 `toolcall_end` 时参数才是完整的。
3. **thinking 块不一定所有 provider 都支持**：pi-ai 会尽可能提取，但某些 OpenAI-compatible  provider 的 reasoning 字段名各异。如果 pi-ai 没识别到，reasoning 会作为 text 返回，REM 可能需要保留 `stripThinkingTags` 作为兜底。
4. **usage 的语义差异**：pi-ai 的 `usage.input` 是“非缓存输入 token”，`totalTokens = input + output + cacheRead + cacheWrite`。REM 的 `inputTokens` 当前也是非缓存输入，可以直接映射。
5. **`onPayload` 修改 payload 要谨慎**：不同 provider 的 payload 结构不同，修改后可能导致请求失败。建议先做只读审计，确认安全后再启用修改。

---

## 9. 总结

- **流式事件变化**：从 5 种无边界事件，变成 12+ 种带生命周期、带 `contentIndex` 的细粒度事件。REM 可以先用 adapter 把 pi-ai 事件映射回现有 `StreamChunk`，未来再升级 `ProviderChunk`/`AgentStreamChunk` 协议以利用细粒度能力。
- **前后置自定义操作**：REM 当前的所有调用前检查、调用后处理、retry、error 分类、消息持久化都可以保留。pi-ai 只是替换了“发送请求并解析流”这一小段。
- **pi-ai 新增能力**：`onPayload`、`onResponse`、`toolcall_delta` 参数流式解析、`Usage.cost`、`thinking` 自动分离、跨 provider message 转换。这些能力可以在 adapter 中逐步暴露给上层。
