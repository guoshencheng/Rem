# 彻底移除 pi-adapter 转换层设计方案

> 日期：2026-07-16
> 主题：删除 `packages/core` 中 REM 自建的 `ModelMessage` / `ContentPart` 表示层及 `pi-adapter.ts` 转换层，让 Core 内部完全直接使用 `@earendil-works/pi-ai` 的数据类型。

---

## 1. 背景与上下文

2026-07-15 的设计方案已将 Core 的 LLM 调用迁移到 `@earendil-works/pi-ai`，并完成了以下改动：

- `Session.conversation` 改为 `pi.Message[]`。
- `reason()` / `generate()` 改为调用 `models.stream()` / `models.complete()`。
- 流式事件改为 `AgentStreamEvent = AssistantMessageEvent | RemMetaEvent`。

但该方案 Phase 3 只要求删除 `pi-adapter.ts` 中的“过渡函数”，仍保留了 `migrateConversationToPiAi` 和 `LegacyModelMessage` 等旧格式转换逻辑。实际代码中仍然存在 `ModelMessage`、`ContentPart` 类型以及 `toPiMessage`、`fromPiMessage`、`toPiTool`、`fromPiAssistantMessage` 等转换函数。

本次设计目标是在 Phase 3 基础上进一步收尾：彻底移除这层转换，让 Core 内部任何数据传递都不再经过 REM 自建的消息格式。

---

## 2. 设计目标

1. 删除 `packages/core/src/pi-adapter.ts` 文件。
2. 删除 `packages/core/src/types.ts` 中的 `ModelMessage`、`ContentPart`、`MessageContent`。
3. 让 `ToolSet` 直接对齐 `pi-ai.Tool[]`。
4. 让 `generate()` 直接返回 `pi.AssistantMessage`。
5. 删除 `LocalSessionProvider` 中已无人使用的 `cueMessages()` / `pullMessages()` 缓存方法。
6. 删除 schema v1 旧会话迁移逻辑，不再兼容旧 `ModelMessage[]` 数据格式。
7. 同步更新 `bridge` 导出、测试和文档。

---

## 3. 关键决策（用户确认）

| 问题 | 选择 | 说明 |
|---|---|---|
| 旧 schema v1 session 迁移 | B. 删除迁移 | 不再支持加载旧 `ModelMessage[]` 数据 |
| 工具定义层 | A. 直接改用 `pi.Tool[]` | `ToolSet` 改为 `Tool[]`，不再维护独立格式 |
| `generate()` 返回值 | A. 直接返回 `pi.AssistantMessage` | 调用方自行读取 content / usage / stopReason |
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

### 4.3 工具层直接对齐 `pi-ai`

**文件：`packages/core/src/sdk/tool-provider.ts`**

保留 `ToolSchema` 作为 REM 工具定义的输入结构：

```ts
export interface ToolSchema {
  description: string;
  parameters: Record<string, unknown>;
}
```

将 `ToolSet` 改为直接返回 `pi.Tool[]`：

```ts
import type { Tool } from '@earendil-works/pi-ai';
export type ToolSet = Tool[];
```

**文件：`packages/core/src/tool-composer.ts`**

不再调用 `toPiTool`，直接返回 `Tool[]`。

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

调用方（如 `LLMTitleProvider`）自行从 `AssistantMessage.content` 提取结果。

### 4.5 Title Provider 直接构造 `pi.Message[]`

**文件：`packages/core/src/plugins/title/llm/index.ts`**

不再把 `pi.Message[]` 转成 `ModelMessage[]`，直接构造 `pi.Message[]`：

```ts
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
  tools: [setTitleTool], // 改为 Tool[]
});
```

### 4.6 Session Provider 清理

**文件：`packages/core/src/plugins/session/base.ts`**

- 删除 `migrateConversationToPiAi` 的 import 和调用。
- `load()` 中不再检查 `schemaVersion < 2` 并迁移。
- 可保留 `schemaVersion` 字段用于未来版本，但只设置、不迁移。

**文件：`packages/core/src/plugins/session/sqlite/index.ts`**

- 删除 `migrateConversationToPiAi` 的 import 和调用。
- **不再兼容** `schemaVersion < 2` 的旧数据。如果仍遇到旧 session，直接按错误处理，不静默迁移。

**文件：`packages/core/src/plugins/session/local/index.ts`**

- 删除 `msgCache`。
- 删除 `cueMessages()` / `pullMessages()`。
- 删除 `.msg.json` 文件读写逻辑。
- 只保留 `index.json` 管理和 CRUD。

### 4.7 `execute-tools.ts` 保持不变

`packages/core/src/execute/execute-tools.ts` 已直接构造 `ToolResultMessage` 并追加到 `conversation`，继续直接消费 `pi-ai` 类型，无需改动。

### 4.8 Bridge 导出调整

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
| `packages/core/tests/session-migration.test.ts` | 删除 schema v1 迁移用例，或整文件删除 |
| `packages/core/tests/local-session-provider.test.ts` | 删除 `cueMessages` / `pullMessages` 用例 |
| `packages/core/tests/reason/generate.test.ts` | 按 `AssistantMessage` 返回类型调整断言 |
| `packages/core/tests/title-provider.test.ts` | 按直接构造 `Message[]` 调整 |
| 其他使用 `ModelMessage` / `ContentPart` 的测试 | 统一替换为 `pi.Message` / content blocks |

---

## 6. 文档更新

- `packages/core/README.md`：删除 `pi-adapter` 章节，更新类型表。
- `packages/core/AGENTS.md`：更新“常用入口”表格，移除 `pi-adapter.ts`。
- `docs/module-reference.md`：更新 `session/local/` 描述，移除 `cueMessages` / `pullMessages`。
- `docs/superpowers/specs/2026-07-15-pi-ai-llm-migration-design.md`：在 Phase 3 部分补充说明本次清理已完成，迁移函数已删除。

---

## 7. 验证方式

1. `pnpm typecheck`：全仓类型检查全绿。
2. `pnpm test`：所有测试通过。
3. 手动验证：启动一次完整对话，确认 session 能正常创建、加载、继续。

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 旧 schema v1 session 无法加载 | 历史会话数据不可用 | 已确认删除迁移；如有需要，可提前运行一次性迁移脚本 |
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
- 本次清理不包含 `execute-tools.ts` 改造，因为它已直接消费 `pi-ai` 类型。
- 本次清理不新增 `pi-ai` 的抽象封装，目标是直接复用原类型。
