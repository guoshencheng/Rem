# 彻底移除 pi-adapter 转换层设计方案

> 日期：2026-07-16
> 主题：删除 `packages/core` 中 REM 自建的 `ModelMessage` / `ContentPart` 表示层及 `pi-adapter.ts` 转换层，让 Core 内部完全直接使用 `@earendil-works/pi-ai` 的数据类型。

---

## 1. 背景与上下文

2026-07-15 的设计方案已将 Core 的 LLM 调用迁移到 `@earendil-works/pi-ai`，并完成了以下改动：

- `Session.conversation` 改为 `pi.Message[]`。
- `reason()` / `generate()` 改为调用 `models.stream()` / `models.complete()`。
- 流式事件改为 `AgentStreamEvent = AssistantMessageEvent | RemMetaEvent`。

但该方案 Phase 3 只要求删除 `pi-adapter.ts` 中的“过渡函数”，仍保留了 `migrateConversationToPiAi` 和 `LegacyModelMessage` 等旧格式转换逻辑。实际代码中仍然存在 `ModelMessage`、`ContentPart` 类型以及 `toPiMessage`、`fromPiMessage`、`toPiTool`、`fromPiAssistantMessage`、`toPiToolResultMessage` 等转换函数。

本次设计目标是在 Phase 3 基础上进一步收尾：彻底移除这层转换，让 Core 内部任何数据传递都不再经过 REM 自建的消息格式。

---

## 2. 设计目标

1. 删除 `packages/core/src/pi-adapter.ts` 文件。
2. 删除 `packages/core/src/types.ts` 中的 `ModelMessage`、`ContentPart`、`MessageContent`。
3. 让 `ToolSet` 直接对齐 `pi-ai.Tool[]`，贯通整个 ToolProvider 栈。
4. 让 `generate()` 直接返回 `pi.AssistantMessage`。
5. 在 `execute-tools.ts` 内直接构造 `ToolResultMessage`，不再通过 adapter。
6. 删除 `LocalSessionProvider` 中已无人使用的 `cueMessages()` / `pullMessages()` 缓存方法。
7. 删除 schema v1 旧会话迁移逻辑，不再兼容旧 `ModelMessage[]` 数据格式；统一在所有 provider 中抛出 `UnsupportedSessionSchemaError`。
8. 同步更新 `bridge` 导出、测试和文档。

---

## 3. 关键决策（用户确认）

| 问题 | 选择 | 说明 |
|---|---|---|
| 旧 schema v1 session 迁移 | B. 删除迁移 | 不再支持加载旧 `ModelMessage[]` 数据 |
| 工具定义层 | A. 直接改用 `pi.Tool[]` | `ToolSet` 改为 `Tool[]`，贯通 registry / MCP / overlay / composite / run-agent |
| `generate()` 返回值 | A. 直接返回 `pi.AssistantMessage` | 调用方自行读取 content / usage / stopReason；影响 title 和 compressor |
| `LocalSessionProvider` 缓存方法 | A. 删除 | `cueMessages` / `pullMessages` 为死代码，直接删除 |
| 执行策略 | A. 一次性完整清理 | 一个 PR 内完成所有改动，无中间状态 |

---

## 4. 详细设计

### 4.1 核心类型清理

**文件：`packages/core/src/types.ts`**

删除以下类型：

```ts
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; arguments: unknown }
  | { type: 'tool-result'; toolCallId: string; toolName?: string; output: string; error?: string };

export type MessageContent = ContentPart[];

export interface ModelMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: MessageContent;
}
```

保留以下自有类型（它们不是格式转换层）：

- `RemMessage`：运行时包装，给 `pi.Message` 附加 `messageId` 和 `tokenUsage`。
- `AgentStreamEvent`：`pi.AssistantMessageEvent` 与 REM 元事件的并集。
- `StreamErrorInfo`、`RemMetaEvent`、`AgentStreamStepResult`、`TurnResult` 等。

`TurnResult.newMessages` 从 `ModelMessage[]` 改为 `Message[]`（来自 `pi-ai`）。

### 4.2 删除 `pi-adapter.ts`

**文件：`packages/core/src/pi-adapter.ts`**

整文件删除，包含以下函数和类型：

- `toPiMessage`
- `fromPiMessage`
- `toPiTool`
- `toPiToolResultMessage`
- `fromPiAssistantMessage`
- `LegacyModelMessage`
- `migrateConversationToPiAi`
- `resolveMessageIdFromMeta`

### 4.3 工具层直接对齐 `pi-ai`（全栈改造）

**核心类型变更：文件 `packages/core/src/sdk/tool-provider.ts`**

```ts
import type { Tool } from '@earendil-works/pi-ai';

export interface ToolSchema {
  description: string;
  parameters: Record<string, unknown>;
}

export type ToolSet = Tool[];
```

- `ToolSchema` 保留，用于“只定义 description 和 parameters、不含 name”的场景（如 title/compressor 的静态工具定义）。
- `ToolSet` 改为 `pi.Tool[]`；`ToolProvider.getToolSet()` 直接返回可传给 `pi-ai.Context.tools` 的数组。

**各 provider 改造：**

| 文件 | 变更 |
|---|---|
| `packages/core/src/registry/tool-registry.ts` | `getToolSet()` 直接返回 `Tool[]`；从 `ToolDefinition` 映射 `{ name, description, parameters }` |
| `packages/core/src/plugins/tool/in-memory/index.ts` | `getToolSet()` 直接返回 `Tool[]` |
| `packages/core/src/mcp/tool-provider.ts` | `getToolSet()` 直接返回 `Tool[]` |
| `packages/core/src/mcp/composite-tool-provider.ts` | `getToolSet()` 合并多个 `Tool[]`；按 `tool.name` 处理冲突 |
| `packages/core/src/overlay-tool-provider.ts` | `getToolSet()` 合并 base `Tool[]` 与 overlay `Tool[]`；按 `tool.name` 处理冲突 |
| `packages/core/src/tool-composer.ts` | 删除 `composeToolSet()` 或改为恒等函数；`DefaultToolComposer.compose()` 返回的 `ToolProvider` 已经直接提供 `Tool[]` |
| `packages/core/src/run-agent.ts` | 移除 `composeToolSet` import；`const piTools = toolProviderWithDelegate.getToolSet()` 直接可用 |
| `packages/core/src/reason/reason.ts` | `tools?: ToolSet` 即 `Tool[]`；构造 `Context` 时直接透传 |
| `packages/core/src/reason/generate.ts` | `tools?: ToolSet` 即 `Tool[]`；直接透传 |

**组合冲突规则：**

- 当多个 provider 返回同名 tool 时，后写入的覆盖先写入的（保持现有行为）。
- `CompositeToolProvider` 和 `OverlayToolProvider` 都需要改为基于 `tool.name` 而不是对象 key 来做合并与覆盖。

### 4.4 `reason()` 与 `generate()` 调整

**文件：`packages/core/src/reason/reason.ts`**

`reason()` 已经直接消费 `pi.AssistantMessageEvent`，本次只需调整 `tools` 参数类型：

```ts
export interface ReasonParams {
  // ...
  tools?: ToolSet; // 现在等于 Tool[]
  // ...
}

const context: Context = {
  systemPrompt: params.system,
  messages: params.messages,
  tools: params.tools, // 直接透传
};
```

**文件：`packages/core/src/reason/generate.ts`**

改动：

1. `tools` 参数改为 `Tool[]`。
2. `generate()` 直接返回 `pi.AssistantMessage`。
3. 删除 `fromPiAssistantMessage` 调用与 import。

```ts
export interface GenerateParams {
  // ...
  messages: Message[];
  tools?: ToolSet; // 现在等于 Tool[]
  // ...
}

export async function generate(params: GenerateParams): Promise<AssistantMessage> {
  // ...
  const message = await models.complete(model, context, options);
  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    throw new Error(message.errorMessage ?? `LLM stopped: ${message.stopReason}`);
  }
  return message;
}
```

**调用方改造：**

- `LLMTitleProvider` 和 `LLMSummarizingCompressor` 都需要从 `AssistantMessage.content` 提取 tool call 与文本。
- 静态工具定义（`TITLE_TOOL`、`SUMMARY_TOOL_SCHEMA`）需补充 `name` 字段，成为真正的 `pi.Tool`。

### 4.5 Title Provider 直接构造 `pi.Message[]` 与 `pi.Tool[]`

**文件：`packages/core/src/plugins/title/llm/index.ts`**

```ts
import type { Tool } from '@earendil-works/pi-ai';

const TITLE_TOOL: Tool = {
  name: 'set_title',
  description: 'Set the title for this conversation',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'A brief, concise title (≤50 chars) summarizing the conversation topic',
      },
    },
    required: ['title'],
    additionalProperties: false,
  },
};

// 直接构造 pi.Message[]
const messages: Message[] = userMessages.map(m => ({
  role: 'user',
  content: typeof m.content === 'string'
    ? m.content
    : m.content.filter(b => b.type === 'text').map(b => b.text).join(' '),
  timestamp: Date.now(),
}));

const result = await generate({
  // ...
  messages,
  tools: [TITLE_TOOL], // pi.Tool[]
});

// 从 AssistantMessage.content 提取 tool call
const titleCall = result.content
  .filter((b): b is ToolCall => b.type === 'toolCall')
  .find((b) => b.name === 'set_title');
```

### 4.6 Compressor 适配 `AssistantMessage` 返回

**文件：`packages/core/src/plugins/compressor/llm-summary/index.ts`**

```ts
const SUMMARY_TOOL: Tool = {
  name: SUMMARY_TOOL_NAME,
  description: SUMMARY_TOOL_SCHEMA.description,
  parameters: SUMMARY_TOOL_SCHEMA.parameters,
};

const result = await generate({
  // ...
  tools: [SUMMARY_TOOL], // pi.Tool[]
});

const summaryCall = result.content
  .filter((b): b is ToolCall => b.type === 'toolCall')
  .find((b) => b.name === SUMMARY_TOOL_NAME);

const summaryText = summaryCall
  ? formatSummaryAsMarkdown(summaryCall.arguments as SummaryData)
  : result.content
      .filter((b): b is TextContent => b.type === 'text')
      .map((b) => b.text)
      .join('');
```

### 4.7 `execute-tools.ts` 直接构造 `ToolResultMessage`

**文件：`packages/core/src/execute/execute-tools.ts`**

删除 `toPiToolResultMessage` 的 import，在循环内直接构造：

```ts
import type { ToolResultMessage } from '@earendil-works/pi-ai';

for (const result of results) {
  const toolResultMessage: ToolResultMessage = {
    role: 'toolResult',
    toolCallId: result.toolCallId,
    toolName: result.toolName,
    content: [{ type: 'text', text: result.output ?? '' }],
    isError: !!result.error,
    timestamp: Date.now(),
  };
  messages.push(toolResultMessage);
}
```

### 4.8 Session Provider 清理与错误统一

**新增错误类型：文件 `packages/core/src/plugins/session/errors.ts`**

```ts
export class UnsupportedSessionSchemaError extends Error {
  constructor(public schemaVersion: number, sessionId: string) {
    super(`Session ${sessionId} uses unsupported schema version ${schemaVersion}. Please migrate or recreate the session.`);
    this.name = 'UnsupportedSessionSchemaError';
  }
}
```

**文件：`packages/core/src/plugins/session/base.ts`**

- 删除 `migrateConversationToPiAi` 的 import 和调用。
- `load()` 中检查 `schemaVersion`：
  - 如果 `schemaVersion === 2`，正常加载。
  - 如果 `schemaVersion < 2` 或缺失，抛出 `UnsupportedSessionSchemaError`。

**文件：`packages/core/src/plugins/session/sqlite/index.ts`**

- 删除 `migrateConversationToPiAi` 的 import 和调用。
- 与 `BaseSessionProvider` 一致：遇到 `schemaVersion < 2` 抛出 `UnsupportedSessionSchemaError`。

**文件：`packages/core/src/plugins/session/in-memory/index.ts`**

- 删除 `migrateConversationToPiAi` 的 import 和调用。
- 与 `BaseSessionProvider` 一致：遇到 `schemaVersion < 2` 抛出 `UnsupportedSessionSchemaError`。

**文件：`packages/core/src/plugins/session/local/index.ts`**

- 删除 `msgCache`。
- 删除 `cueMessages()` / `pullMessages()`。
- 删除 `.msg.json` 文件读写逻辑。
- 只保留 `index.json` 管理和 CRUD。
- 继承 `BaseSessionProvider` 的 schema 检查行为。

### 4.9 Bridge 导出调整

**文件：`packages/bridge/src/index.ts`**

停止 re-export `ModelMessage` / `ContentPart`：

```ts
// 删除：
export type { AgentStreamEvent, ContentPart, ModelMessage } from 'rem-agent-core';

// 保留：
export type { AgentStreamEvent } from 'rem-agent-core';
```

Bridge 消费者如需 message 类型，直接从 `pi-ai` 导入 `Message`；如需 content block，使用 `TextContent`、`ThinkingContent`、`ToolCall` 等。

---

## 5. 测试更新

| 测试文件 | 改动 |
|---|---|
| `packages/core/tests/llm/pi-adapter.test.ts` | 删除（如存在） |
| `packages/core/tests/session-migration.test.ts` | 删除 schema v1 迁移用例，或整文件删除；新增 `UnsupportedSessionSchemaError` 回归测试 |
| `packages/core/tests/local-session-provider.test.ts` | 删除 `cueMessages` / `pullMessages` 用例 |
| `packages/core/tests/in-memory-session-provider.test.ts` | 添加 `UnsupportedSessionSchemaError` 回归测试 |
| `packages/core/tests/file-session-provider.test.ts` | 添加 `UnsupportedSessionSchemaError` 回归测试 |
| `packages/core/tests/reason/generate.test.ts` | 按 `AssistantMessage` 返回类型调整断言 |
| `packages/core/tests/title-provider.test.ts` | 按直接构造 `Message[]` / `Tool[]` 调整 |
| `packages/core/tests/compressor/llm-summary.test.ts` | 按 `AssistantMessage` 返回类型调整 |
| `packages/core/tests/tool-registry.test.ts` | `getToolSet()` 返回 `Tool[]`；断言从对象 key 改为数组 find by name |
| `packages/core/tests/in-memory-tool-provider.test.ts` | `getToolSet()` 返回 `Tool[]` |
| `packages/core/tests/overlay-tool-provider.test.ts` | `getToolSet()` 返回 `Tool[]` |
| `packages/core/tests/mcp/tool-provider.test.ts` | `getToolSet()` 返回 `Tool[]` |
| `packages/core/tests/mcp/composite-tool-provider.test.ts` | `getToolSet()` 返回 `Tool[]` |
| `packages/core/tests/tool-composer.test.ts` | 删除 `composeToolSet` 相关断言；验证返回 `ToolProvider.getToolSet()` 直接为 `Tool[]` |
| `packages/core/tests/run-agent*.test.ts` | mock 的 `getToolSet()` 返回 `Tool[]` |
| 其他使用 `ModelMessage` / `ContentPart` / `composeToolSet` 的测试 | 统一替换为 `pi.Message` / `Tool[]` |

---

## 6. 文档更新

- `packages/core/README.md`：删除 `pi-adapter` 章节，更新类型表与 `ToolSet` 说明。
- `packages/core/AGENTS.md`：更新“常用入口”表格，移除 `pi-adapter.ts`；更新 `ToolSet` 说明。
- `docs/module-reference.md`：更新 `session/local/` 描述，移除 `cueMessages` / `pullMessages`；更新 `tool-composer` 描述。
- `docs/superpowers/specs/2026-07-15-pi-ai-llm-migration-design.md`：在 Phase 3 部分补充说明本次清理已完成，迁移函数与 `ModelMessage` 已删除。

---

## 7. 验证方式

1. `pnpm typecheck`：全仓类型检查全绿。
2. `pnpm test`：所有测试通过。
3. 手动验证：启动一次完整对话，确认 session 能正常创建、加载、继续；工具调用与压缩流程正常。

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 旧 schema v1 session 无法加载 | 历史会话数据不可用 | 已统一抛出 `UnsupportedSessionSchemaError`；如有需要，可提前运行一次性迁移脚本 |
| ToolProvider 栈接口变更面大 | registry / MCP / overlay / composite / tests 都需要改 | 一次性搜索所有 `getToolSet()` 与 `ToolSet` 引用，统一改完 |
| `generate()` 返回类型变化 | title 和 compressor 调用方编译失败 | 已在本设计中明确两个调用方改造方案 |
| Bridge 公开类型变化 | 外部消费者编译失败 | Web 包不消费这两个类型；影响可控，在 changelog 中说明 |
| 删除 `pi-adapter.ts` 后其它包仍 import | 编译失败 | 一次性搜索并替换所有 import |

---

## 9. 参考文档

- `docs/superpowers/specs/2026-07-15-pi-ai-llm-migration-design.md`
- `docs/architecture.md`
- `docs/core-design.md`
- `docs/module-reference.md`
- `packages/core/README.md`
- `packages/core/AGENTS.md`

---

## 10. 设计约束声明

- `RemMessage` 和 `AgentStreamEvent` 保留。它们是 REM 在 `pi-ai` 之上的自有抽象（运行时元数据包装、事件并集），不是“同一语义的两种表达”的转换层。
- 本次清理不新增 `pi-ai` 的抽象封装，目标是直接复用原类型。
- `ToolSchema` 作为不含 `name` 的工具定义输入结构保留，但传给模型前必须补充 `name` 成为 `pi.Tool`。
