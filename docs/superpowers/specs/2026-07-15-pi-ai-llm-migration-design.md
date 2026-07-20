# REM 项目 LLM 调用迁移至 pi-ai 设计方案

> 日期：2026-07-15  
> 主题：将 `packages/core` 的 LLM 调用从自建 `LLMProvider` 体系迁移到 `@earendil-works/pi-ai`，并同步替换内部消息、流式事件、工具、Usage 等核心数据类型。

---

## 1. 设计目标

1. 让 REM Core 内部直接使用 pi-ai 的 `Models` / `Context` / `Message` / `AssistantMessageEvent` / `Usage` / `Tool` 等类型。
2. 删除自建的 `LLMProvider` 注册表、`InferenceEngine`、`StreamCollector`、自建 provider（OpenAI / Anthropic）及流式 parser。
3. 保留 REM 的 Agent 循环、审批、预算、压缩、会话持久化等自有业务逻辑。
4. 将 `AgentStreamChunk` 替换为 `AgentStreamEvent = AssistantMessageEvent | RemMetaEvent`。
5. 会话持久化格式从 `ModelMessage[]` 迁移到 `pi.Message[]`，引入 `schemaVersion` 做旧数据迁移。
6. 升级运行时至 Node 22.x，满足 pi-ai 的引擎要求。

---

## 2. 关键决策

| 决策项 | 选择 | 理由 |
|---|---|---|
| 迁移深度 | 全量直接集成 | 用户选择方案 C，充分复用 pi-ai 的抽象能力 |
| 兼容策略 | 无 fallback | 删除旧模块，不保留 `LLMProvider` 兼容层 |
| Node 版本 | 升级到 Node 22.x | pi-ai 要求 `>= 22.19.0` |
| OpenAI API | 使用 pi-ai 默认的 Responses API | 与 pi-ai 默认行为一致，未来跟随上游 |
| Provider 范围 | pi-ai 全部内置 provider | 获得 20+ 家 provider 的一站式支持 |
| 消息 ID | `RemMessage` 包装 | pi-ai `Message` 无 id，REM 需要稳定消息标识 |
| 生命周期事件 | 本次不引入 | 避免范围膨胀，作为后续独立项目 |

---

## 3. 目标架构与数据流

迁移完成后，Core 的 LLM 入口从 `resolveProvider(provider) → LLMProvider.stream/generate` 变为：

```
createAgentFromEnv()
  │
  ▼
buildAgentContext()
  │  ├─ createCoreModels({ providers: 'all' })  ← pi-ai builtinModels()
  │  └─ 其它 provider 照旧注入
  │
  ▼
runAgent()
  │  ├─ 从 ctx.models.getModel(provider, model) 取 Model 对象
  │  ├─ 用 pi-ai Context 包装 systemPrompt + messages + tools
  │  ├─ 调用 ctx.models.stream(model, context, options)
  │  └─ 遍历 AssistantMessageEvent，同时发出 RemMetaEvent
  │
  ▼
ReactLoop / executeTools
  │  ├─ 工具结果组装成 pi.ToolResultMessage
  │  └─ 追加到 context.messages
  │
  ▼
AgentStreamController → AgentState → BroadcastBus → Bridge SSE → Web UI
```

### 3.1 核心变化点

- **Models 集合由 `AgentContext` 持有**：`AgentContext` 新增 `models: Models`，在 `buildAgentContext()` 中通过 `createCoreModels({ providers: 'all' })` 初始化。
- **配置仍由 Core 解析**：`DefaultConfigProvider` 继续读取 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` 等环境变量，然后把 `apiKey` / `baseURL` 显式传给 `models.stream/complete`，保留“Provider 配置由 Core 拥有”的红线。
- **流式事件直接消费 pi-ai 事件**：`reason()` 不再经过 `InferenceEngine`，而是拿到 `AssistantMessageEventStream` 后遍历事件，并同步 emit `RemMetaEvent`（如 `step-start/finish`、`session-title`、`approval-*`、`compress-*`）。
- **会话持久化格式迁移**：`Session.conversation` 从 `ModelMessage[]` 改为 `pi.Message[]`，每条消息用 `RemMessage` 包装以保留 `messageId` 和 `tokenUsage` 等 REM 元数据。
- **工具结果直接进消息**：`executeTools` 不再 emit `tool-result` ContentPart，而是生成 `pi.ToolResultMessage` 追加到 `context.messages`。

### 3.2 包间依赖变化

- `packages/core` 新增依赖 `@earendil-works/pi-ai`。
- `packages/bridge` 透传新的事件类型（`AgentStreamEvent`），SSE 编码/解码保持通用 JSON。
- `packages/web` 按 pi-ai 事件类型渲染内容块（`text` / `thinking` / `toolCall`）。

---

## 4. 核心类型迁移映射

| REM 当前类型 | pi-ai 目标类型 | 说明 |
|---|---|---|
| `ModelMessage` | `pi.Message` | REM 额外包一层 `RemMessage` 保存 `messageId` |
| `ContentPart` | `TextContent` / `ThinkingContent` / `ToolCall` / `ImageContent` | `tool-result` 不再作为 part，而是独立成 `ToolResultMessage` |
| `AgentStreamChunk` / `ProviderChunk` | `pi.AssistantMessageEvent` + `RemMetaEvent` | LLM 事件直接复用 pi-ai；REM 自定义事件作为并集 |
| `LanguageModelUsage` | `pi.Usage` | 包含 `cost` 字段；保留旧 UI 兼容转换 |
| `ToolSet` | `pi.Tool[]` | 工具定义直接用 TypeBox schema，pi-ai 原生支持 |

### 4.1 `ModelMessage` → `RemMessage` + `pi.Message`

```ts
import type { Message } from '@earendil-works/pi-ai';

export interface RemMessage {
  messageId: string;
  message: Message;
  tokenUsage?: Usage;
}
```

> `RemMessage` 是运行时的包装概念；持久化时 `Session.conversation` 只存 `Message[]`，`messageId` 通过 `metadata.messageMeta` 维护。"

| REM role | pi-ai 形式 | 说明 |
|---|---|---|
| `system` | 放入 `Context.systemPrompt` | 压缩后的摘要也写回 `systemPrompt` |
| `user` | `UserMessage` | 内容 `string` 或 `TextContent/ImageContent[]` |
| `assistant` | `AssistantMessage` | 内容块为 `TextContent` / `ThinkingContent` / `ToolCall` |
| `tool` | `ToolResultMessage` | 一个 tool 调用对应一条 `ToolResultMessage` |

### 4.2 `ContentPart` → pi-ai content blocks

| REM part | pi-ai block | 映射 |
|---|---|---|
| `text` | `TextContent` | `{ type: 'text', text }` |
| `reasoning` | `ThinkingContent` | `{ type: 'thinking', thinking }` |
| `tool-call` | `ToolCall` | `{ type: 'toolCall', id, name, arguments }` |
| `tool-result` | `ToolResultMessage` | `{ role: 'toolResult', toolCallId, toolName, content, isError }` |

UI 渲染时保留一个 UI 层概念：

```ts
export type UiContentBlock = TextContent | ThinkingContent | ToolCall;
```

`tool-result` 不直接渲染，而是挂在对应 `ToolCall` 旁边展示。

### 4.3 `AgentStreamChunk` → `AgentStreamEvent`

```ts
export interface StreamErrorInfo {
  name: string;
  message: string;
  reason?: 'error' | 'aborted';
  stack?: string;
}

export type RemMetaEvent =
  | { type: 'step-start'; step: number }
  | { type: 'step-finish'; step: number }
  | { type: 'session-title'; title: string }
  | { type: 'approval-request'; sessionId: string; request: ApprovalRequest }
  | { type: 'approval-resolved'; sessionId: string; approvalId: string; decision: ApprovalDecision | null }
  | { type: 'compress-start'; sessionId: string; estimatedTokens: number; threshold: number }
  | { type: 'compress-end'; sessionId: string; archiveId: string; removedMessageCount: number }
  | { type: 'compress-error'; sessionId: string; error: string }
  | { type: 'finish'; output: AgentOutput }
  | { type: 'error'; error: StreamErrorInfo };

export type AgentStreamEvent = AssistantMessageEvent | RemMetaEvent;
```

`lifecycle:*` 事件在本次迁移中暂不引入，作为后续独立项目处理。

### 4.4 `LanguageModelUsage` → `pi.Usage`

```ts
// pi.Usage
{
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: { input, output, cacheRead, cacheWrite, total };
}
```

| REM | pi-ai |
|---|---|
| `inputTokens` | `input` |
| `outputTokens` | `output` |
| `totalTokens` | `totalTokens` |
| `inputTokenDetails.cacheReadTokens` | `cacheRead` |
| `inputTokenDetails.cacheWriteTokens` | `cacheWrite` |
| `outputTokenDetails.reasoningTokens` | `reasoning` |

`token-usage.ts` 改为对 `pi.Usage` 做累加；Bridge 旧 UI 可保留一个兼容转换函数。

### 4.5 `ToolSet` → `pi.Tool[]`

当前 `ToolSet = Record<string, ToolSchema>` 是对象，目标改为数组：

```ts
import type { Tool } from '@earendil-works/pi-ai';

function toPiTool(name: string, schema: ToolSchema): Tool {
  return {
    name,
    description: schema.description,
    parameters: schema.parameters,
  };
}
```

pi-ai 的 tool schema 也是 TypeBox，字段名与 REM 一致，转换基本直接透传。

---

## 5. Phase 1：消息与模型层迁移

**目标**：把 Core 内部使用 pi-ai 的 `Models` / `Context` / `Message` / `Usage` / `Tool`，同时保持对外 `AgentStreamChunk` 接口不变，让 Bridge / Web 在 Phase 1 无需改动。

### 5.1 新增文件

| 新增文件 | 职责 |
|---|---|
| `packages/core/src/llm/models.ts` | 创建 pi-ai `Models` 集合：`createCoreModels({ providers: 'all' })` |
| `packages/core/src/pi-adapter.ts` | REM ↔ pi-ai 转换函数：`toPiMessage` / `fromPiMessage` / `toPiTool` / `toPiToolResultMessage` / `toLegacyChunk` |
| `packages/core/tests/llm/pi-adapter.test.ts` | 转换函数 round-trip 测试 |
| `packages/core/tests/llm/models.test.ts` | `createCoreModels` 与模型查找测试 |

### 5.2 修改文件

| 文件 | 修改内容 |
|---|---|
| `packages/core/package.json` | 新增依赖 `@earendil-works/pi-ai` |
| `packages/core/src/types.ts` | 新增 `RemMessage`、`AgentStreamEvent`；保留旧 `AgentStreamChunk` |
| `packages/core/src/session.ts` | `Session.conversation` 改为 `Message[]`；metadata 增加 `schemaVersion` |
| `packages/core/src/sdk/session-provider.ts` | `addMessage` / `appendContent` 签名改为 pi-ai 类型；加载旧 session 时迁移 |
| `packages/core/src/plugins/session/*` | 存储/读取 pi-ai 消息 |
| `packages/core/src/agent-context.ts` | 增加 `models: Models` |
| `packages/core/src/agent-context-builder.ts` | 初始化 `Models`；移除 `registerBuiltInProviders()` |
| `packages/core/src/reason/reason.ts` | `reason()` 使用 `models.stream` / `models.complete`，内部把 pi-ai 事件转成旧 `ProviderChunk` |
| `packages/core/src/run-agent.ts` | 构建 `pi.Context`；调用 `ctx.models`；处理 `Usage` |
| `packages/core/src/sdk/tool-provider.ts` / `tool-composer.ts` | `getToolSet()` 返回 `pi.Tool[]` |
| `packages/core/src/execute/execute-tools.ts` | 生成 `ToolResultMessage` 并追加到会话 |
| `packages/core/src/plugins/loop/react/index.ts` | 消费 `reason()` 返回的 `toolCalls`，工具结果写入 `ToolResultMessage` |
| `packages/core/src/token-usage.ts` | 基于 `pi.Usage` 累加；新增 `addCost` |

### 5.3 删除文件

| 删除文件 | 说明 |
|---|---|
| `packages/core/src/llm/api-registry.ts` | 由 pi-ai `Models` 承担注册/路由 |
| `packages/core/src/llm/engine.ts` | `InferenceEngine` 不再需要 |
| `packages/core/src/llm/stream-collector.ts` | pi-ai 自带收集 |
| `packages/core/src/llm/partition-stream.ts` | pi-ai 已处理 thinking 分块 |
| `packages/core/src/llm/providers/*` | pi-ai 提供对应 API 实现 |

> 删除采用“先移动再删除”：Phase 1 先把这些文件移到 `deprecated/` 目录或注释引用，Phase 3 彻底删除，避免破坏其它包的 import。

### 5.4 关键实现细节

#### `createCoreModels`

```ts
import { builtinModels } from '@earendil-works/pi-ai/providers/all';

export function createCoreModels(options?: { customProviders?: Provider[] }): Models {
  const models = builtinModels();
  for (const p of options?.customProviders ?? []) {
    models.setProvider(p);
  }
  return models;
}
```

#### `reason()` 在 Phase 1 的写法

```ts
export async function reason(
  params: ReasonParams,
  emit: (chunk: ProviderChunk) => void,
): Promise<ReasonResult> {
  const model = params.models.getModel(params.provider, params.model);
  if (!model) throw new Error(`Unknown model: ${params.provider}/${params.model}`);

  const context: Context = {
    systemPrompt: params.system,
    messages: params.messages.map(toPiMessage),
    tools: params.tools ? params.tools.map(toPiTool) : undefined,
  };

  const stream = params.models.stream(model, context, {
    apiKey: params.apiKey,
    baseURL: params.baseURL,
    signal: params.signal,
    maxRetries: 0, // REM 自己控制 retry
  });

  for await (const event of stream) {
    for (const chunk of toLegacyProviderChunks(event)) {
      emit(chunk);
    }
  }

  const message = await stream.result();
  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    throw new Error(message.errorMessage ?? `LLM stopped: ${message.stopReason}`);
  }

  return fromPiAssistantMessage(message);
}
```

`toLegacyProviderChunks` 把 `text_delta` / `thinking_delta` / `toolcall_end` 映射为旧 `ProviderChunk` 里的 `text-delta` / `reasoning-delta` / `tool-call`，并忽略 `*_start` / `*_end` 事件。

#### `execute-tools.ts` 工具结果写入

```ts
for (const result of results) {
  const toolResultMessage: ToolResultMessage = {
    role: 'toolResult',
    toolCallId: result.toolCallId,
    toolName: result.toolName,
    content: [{ type: 'text', text: result.output ?? '' }],
    isError: !!result.error,
    timestamp: Date.now(),
  };
  context.messages.push(toolResultMessage);
}
```

### 5.5 Phase 1 验证方式

- `pnpm typecheck` 通过；
- `pnpm test` 通过；
- 用任意内置 provider（openai / anthropic）运行一次完整对话：用户输入 → assistant 回复 → 工具调用 → 工具结果 → assistant 最终回复；
- 检查 session 文件是否正确保存为 pi-ai 消息格式且 `schemaVersion >= 2`。

---

## 6. Phase 2：流式事件与循环迁移

**目标**：将 `AgentStreamChunk` / `ProviderChunk` 替换为 `AgentStreamEvent = AssistantMessageEvent | RemMetaEvent`，重写流式侧状态管理，让 Web UI 能直接消费 pi-ai 事件。

### 6.1 类型变更

`packages/core/src/types.ts`：

```ts
export type AgentStreamEvent = AssistantMessageEvent | RemMetaEvent;

export interface AgentStream {
  fullStream: AsyncIterable<AgentStreamEvent>;
  text: Promise<string>;
  usage: Promise<Usage>;
  steps: Promise<AgentStreamStepResult[]>;
}
```

删除旧的 `AgentStreamChunk` / `ProviderChunk` 里的 LLM 事件部分，只保留 `RemMetaEvent`。

### 6.2 重写 `AgentStreamController`

`packages/core/src/stream/agent-stream.ts` 改为 `AgentEventStreamController`：

- 接受 `AssistantMessageEvent` 和 `RemMetaEvent`；
- `messageStart()` 映射到 pi-ai `start` 事件；
- `stepStart/Finish` 保持为 `RemMetaEvent`；
- `finish()` 映射为 `RemMetaEvent<'finish'>`；
- 提供 `text` / `usage` / `steps` promise 聚合。

### 6.3 重写 `ReactLoop`

`packages/core/src/plugins/loop/react/index.ts`：

- 调用 `ctx.stream()` 获取 `AssistantMessageEventStream`；
- 在事件循环中直接追加 content block 到当前 assistant message；
- `toolcall_end` 时收集完整 `ToolCall`，调用 `ctx.execute()`；
- 当 `stopReason === 'toolUse'` 时继续循环，否则 break；
- 返回 `{ content, usage }`，`usage` 来自最终 `AssistantMessage.usage`。

`LoopContext` 更新为：

```ts
export interface LoopContext {
  liveState: AgentLiveState;
  system: string;
  messages: Message[];

  stream: (options?: StreamOptions) => AssistantMessageEventStream;
  generate: (options?: StreamOptions) => Promise<AssistantMessage>;
  execute: (calls: ToolCall[]) => Promise<ToolResult[]>;
  emit: (event: AgentStreamEvent) => void | Promise<void>;

  addMessage: (role: 'assistant' | 'tool') => RemMessage;
  appendContent: (msg: RemMessage, block: TextContent | ThinkingContent | ToolCall) => void;

  signal?: AbortSignal;
  maxSteps?: number;
  workspaceRoot: string;
  readOnly?: boolean;
  agentName?: string;
  sessionId?: string;
}
```

### 6.4 状态与桥接

| 文件 | 变更 |
|---|---|
| `packages/core/src/state.ts` | `AgentLiveState.applyChunk` 改为处理 `AgentStreamEvent`；`activity` 从 `text_delta` / `thinking_delta` / `toolcall_delta` 推导 |
| `packages/core/src/agent-state.ts` | `applyChunk` 处理 `AgentStreamEvent` |
| `packages/core/src/bus-events.ts` | snapshot 的 `parts` 改为 pi-ai content blocks；`chunk` 类型改为 `AgentStreamEvent` |
| `packages/bridge/src/types.ts` | `UIMessage.parts` 改为 `UiContentBlock[]` |
| `packages/bridge/src/sse.ts` | `parseAgentStreamEvent` 改为解析 `AgentStreamEvent` |
| `packages/bridge/src/stream-reducer.ts` | 从 pi-ai 事件更新 UI 状态 |
| `packages/web/src/lib/types.ts` | pi-ai 类型守卫 |
| `packages/web/src/components/chat/message-item.tsx` | 按 content blocks 渲染 |
| `packages/web/src/components/chat/tool-call-block.tsx` | 使用 `tool.arguments` / `tool.id` |

### 6.5 Phase 2 验证方式

- 流式对话时，Web UI 能正常显示 text / thinking / tool-call 的增量更新；
- 工具调用时能看到 `toolcall_delta` 的参数进度；
- 审批、压缩、session-title 事件仍正常展示；
- 中断/重连后 snapshot 能恢复当前 assistant 消息的内容块。

---

## 7. Phase 3：清理与数据迁移

**目标**：删除旧类型与文件，给 session 持久化加 `schemaVersion`，旧会话自动迁移。

### 7.1 删除遗留代码

| 文件 | 动作 |
|---|---|
| `packages/core/src/types.ts` | 删除 `LanguageModelUsage` 兼容别名、`AgentStreamChunk` 兼容别名 |
| `packages/core/src/llm/types.ts` | 如果已无其它引用，删除 |
| `packages/core/src/pi-adapter.ts` | 删除 `toLegacyChunk` 等过渡函数；保留迁移函数 |
| `packages/core/src/llm/providers/` | 彻底删除 |
| `packages/core/src/llm/api-registry.ts` | 彻底删除 |
| `packages/core/src/llm/engine.ts` | 彻底删除 |
| `packages/core/src/llm/stream-collector.ts` | 彻底删除 |
| `packages/core/src/llm/partition-stream.ts` | 彻底删除 |

### 7.2 Session 数据迁移

在 `Session` metadata 加入 `schemaVersion`：

```ts
interface Session {
  sessionId: string;
  conversation: Message[];
  currentTurn: number;
  metadata: Record<string, unknown> & { schemaVersion?: number };
  createdAt: Date;
  updatedAt: Date;
}
```

- `schemaVersion = 1`：旧 REM `ModelMessage[]` 格式；
- `schemaVersion = 2`：pi-ai `Message[]` 格式。

迁移函数示例（具体实现随代码落地）：

```ts
export function migrateConversationToPiAi(
  legacy: LegacyModelMessage[],
): { messages: Message[]; messageIds: Map<string, string> } {
  const messageIds = new Map<string, string>();
  const messages: Message[] = [];

  for (const m of legacy) {
    const remId = m.id;

    if (m.role === 'system') {
      // system 消息在 pi-ai 中进入 Context.systemPrompt，迁移时忽略
      continue;
    }

    if (m.role === 'user') {
      const text = m.content
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
      const message: UserMessage = { role: 'user', content: text, timestamp: Date.now() };
      messageIds.set(remId, message.timestamp.toString());
      messages.push(message);
    } else if (m.role === 'assistant') {
      const content: AssistantMessage['content'] = [];
      for (const p of m.content) {
        if (p.type === 'text') content.push({ type: 'text', text: p.text });
        else if (p.type === 'reasoning') content.push({ type: 'thinking', thinking: p.text });
        else if (p.type === 'tool-call') {
          content.push({ type: 'toolCall', id: p.toolCallId, name: p.toolName, arguments: p.arguments });
        }
      }
      const message: AssistantMessage = {
        role: 'assistant',
        content,
        api: 'openai-completions',
        provider: 'unknown',
        model: 'unknown',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'stop',
        timestamp: Date.now(),
      };
      messageIds.set(remId, message.timestamp.toString());
      messages.push(message);
    } else if (m.role === 'tool') {
      for (const p of m.content) {
        if (p.type === 'tool-result') {
          messages.push({
            role: 'toolResult',
            toolCallId: p.toolCallId,
            toolName: p.toolName ?? '',
            content: [{ type: 'text', text: p.output }],
            isError: !!p.error,
            timestamp: Date.now(),
          });
        }
      }
    }
  }

  return { messages, messageIds };
}
```

加载流程：

1. `SessionProvider.load(sessionId)` 读取原始 JSON；
2. 如果 `metadata.schemaVersion === 1`（或不存在），调用 `migrateConversationToPiAi()`；
3. 迁移后写回 store，设置 `schemaVersion = 2`；
4. 迁移失败时记录错误，返回空 session，避免崩溃。

### 7.3 消息元数据持久化

由于 pi-ai `Message` 没有 `id`，REM 的 `messageId` 与 `tokenUsage` 通过 session metadata 维护。`Session.conversation` 本身只存 `pi.Message[]`，`RemMessage` 是运行时的包装概念；持久化时把 `messageId` 等信息写在 `metadata.messageMeta` 中：

```ts
metadata.messageMeta = {
  [messageIndexOrTimestamp]: { messageId: string, tokenUsage?: Usage }
};
```

在 `BaseSessionProvider.addMessage` 时生成 `messageId` 并写入 `messageMeta`。key 的选取策略：优先使用消息在 `conversation` 数组中的 index；如果消息尚未加入数组，可临时使用 `timestamp` 并在加入后同步更新。

### 7.4 Phase 3 验证方式

- `pnpm typecheck && pnpm test` 全绿；
- 启动旧版本创建的 session，能正常加载历史消息并继续对话；
- 新创建的 session 文件格式为 pi-ai `Message[]`，`schemaVersion: 2`；
- 旧会话迁移后再次加载不再重复迁移。

> 2026-07-16 后续清理：本阶段已彻底删除 `packages/core/src/pi-adapter.ts`，移除 `ModelMessage` / `ContentPart` 自建类型、`migrateConversationToPiAi` 等旧 schema 迁移逻辑，并把 `ToolSet` 统一为 `pi.Tool[]`。详细实施计划见 `docs/superpowers/plans/2026-07-16-remove-pi-adapter-conversion-layer.md`。

---

## 8. 错误处理与重试

pi-ai 把错误编码为流内 `error` 事件，最终 `AssistantMessage.stopReason` 为 `'error'` 或 `'aborted'`，而不是直接抛异常。REM 适配策略：

1. **流末尾检查**：`reason()` 在遍历完 `AssistantMessageEventStream` 后调用 `await stream.result()`，检查 `message.stopReason`；
2. **重新抛异常**：如果是 `'error'` 或 `'aborted'`，抛出 `Error(message.errorMessage)`；
3. **REM retry 保留**：`reason.ts` 和 `generate.ts` 保持 3 次 retry，基于 `errorHandler.classify()`；
4. **pi-ai 内部 retry 关闭**：`models.stream/complete` 的 `maxRetries` 设为 `0`，避免两层 retry 叠加；
5. **AbortSignal**：`options.signal` 直接传给 pi-ai，触发后 `stopReason === 'aborted'`。

---

## 9. 测试策略

| 测试类型 | 覆盖内容 |
|---|---|
| `packages/core/tests/llm/pi-adapter.test.ts` | `ModelMessage` ↔ `pi.Message` round-trip、`ToolSet` → `pi.Tool[]` |
| `packages/core/tests/llm/models.test.ts` | `createCoreModels`、模型查找、未知模型错误 |
| `packages/core/tests/reason/reason.test.ts` | 使用 pi-ai `fauxProvider` 测试 text / reasoning / tool-call / usage / error |
| `packages/core/tests/execute/execute-tools.test.ts` | 工具结果生成 `ToolResultMessage` |
| `packages/core/tests/session-migration.test.ts` | 旧 `schemaVersion=1` 会话迁移到 `schemaVersion=2` |
| `packages/bridge/tests/client.test.ts` | 新 `AgentStreamEvent` 的 SSE 序列化/解析 |
| `packages/web/tests/`（如有） | 按 content blocks 渲染 |

`fauxProvider` 直接使用 pi-ai 内置的，因为它在直接集成后类型天然对齐。

---

## 10. 依赖与构建调整

### 10.1 `packages/core/package.json`

新增：

```json
"dependencies": {
  "@earendil-works/pi-ai": "^0.80.7"
}
```

### 10.2 根 `package.json`

升级 Node 版本约束：

```json
"engines": {
  "node": ">=22.19.0"
}
```

并更新 `@types/node`：

```json
"devDependencies": {
  "@types/node": "^22.0.0"
}
```

### 10.3 SDK 版本统一策略

pi-ai 固定了较低版本的 `openai` 和 `@anthropic-ai/sdk`，REM 当前版本较新。迁移策略：

1. **第一步**：先不加 `pnpm.overrides`，让 pnpm 安装各自版本，跑 `pnpm typecheck && pnpm test` 验证；
2. **第二步**：如果发现两套 SDK 版本导致运行时类型/行为不一致（例如 Anthropic 0.91 与 0.104 差异较大），在根 `package.json` 加 `pnpm.overrides` 统一版本；
3. **如果 overrides 后 pi-ai 在新 SDK 上 break**：回滚 overrides，让 pi-ai 使用自己的 pinned 版本，REM 在代码里隔离两套 SDK 的使用，或给 pi-ai 提 issue/PR。

### 10.4 `tsconfig.json`

`target` 保持 `ES2022` 即可；`lib` 确保包含 `ES2022` 或 `ESNext` 以支持 `ReadableStream` 等。

---

## 11. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| pi-ai 版本升级导致 breaking change | Web / Bridge 类型编译失败 | 锁住 pi-ai 版本；升级前跑全量测试 |
| 自建 provider 删除后某些边缘 provider 不支持 | 无法使用特定模型 | 通过 pi-ai `createProvider` 自定义 provider；保留 REM 自定义 provider 注册入口 |
| 工具 schema 转换不兼容 | 工具调用失败 | 在 `toPiTool` 中加单元测试；对旧工具做兼容校验 |
| 旧 session 数据迁移失败 | 历史会话无法打开 | 迁移函数加 try/catch；失败时返回空会话并记录错误；保留旧格式备份 |
| 流式事件顺序/快照恢复异常 | 重连后 UI 状态不一致 | 用 pi-ai 的 `partial` 维护 snapshot；重连时重放完整 `AssistantMessage` partial |
| 成本/usage 显示不一致 | 用户看到错误 token 数 | 统一使用 `pi.Usage`；在 UI 增加 cost 展示；对旧 `LanguageModelUsage` 做转换测试 |
| 删除 `api-registry` 后外部依赖者编译失败 | Demo / CLI 可能 import `resolveProvider` | 一次性修复所有 Demo / CLI；或在 `index.ts` 保留 deprecated 重定向一个版本周期 |

---

## 12. 参考文档

- `docs/pi-research/pi-ai-adoption-report.md`
- `docs/pi-research/pi-ai-direct-integration-plan.md`
- `docs/pi-research/pi-ai-streaming-and-hooks-supplement.md`
- `docs/pi-research/token-cost-tracking-adoption.md`
- `docs/architecture.md`
- `docs/core-design.md`
