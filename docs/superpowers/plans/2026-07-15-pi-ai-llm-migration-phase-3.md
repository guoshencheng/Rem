# pi-ai LLM 迁移 Phase 3：清理与数据迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 Phase 1/2 保留的旧类型、旧文件和 `deprecated/` 目录，完成 session 数据迁移清理，更新文档，确保全量测试通过且旧 session 可读。

**Architecture:** 删除 `packages/core/src/deprecated/`、`packages/core/src/llm/types.ts`（如已无引用）、`packages/core/src/pi-adapter.ts` 中的过渡函数 `toLegacyProviderChunks` 和 `languageModelUsageToPiUsage`；从 `types.ts` 删除旧 `AgentStreamChunk` / `ProviderChunk` / `LanguageModelUsage` 兼容别名；更新 `token-usage.ts` 完全基于 `pi.Usage`；更新文档 `docs/architecture.md`、`docs/core-design.md`、`packages/core/README.md`。

**Tech Stack:** TypeScript, pnpm, Vitest

---

## File Structure

### 删除文件

| 文件 | 说明 |
|---|---|
| `packages/core/src/deprecated/` | 整个目录删除 |
| `packages/core/src/llm/types.ts` | 如果已无其它引用，删除；否则只保留最小必要类型 |
| `packages/core/src/llm/api-registry.ts` | 已移动，现在删除 |
| `packages/core/src/llm/engine.ts` | 已移动，现在删除 |
| `packages/core/src/llm/stream-collector.ts` | 已移动，现在删除 |
| `packages/core/src/llm/partition-stream.ts` | 已移动，现在删除 |
| `packages/core/src/llm/providers/` | 已移动，现在删除整个目录 |
| `packages/core/src/stream/agent-stream.ts` | 如果 Phase 2 已替换为 `agent-event-stream.ts`，删除旧文件 |
| `packages/core/src/stream/stream-aggregators.ts` | 如果 Phase 2 已替换为 `event-aggregators.ts`，删除旧文件 |

### 修改文件

| 文件 | 修改内容 |
|---|---|
| `packages/core/src/types.ts` | 删除 `AgentStreamChunk` 兼容别名、`ProviderChunk` 兼容别名、`LanguageModelUsage` 兼容别名；确认 `LanguageModelUsage` 不再使用 |
| `packages/core/src/pi-adapter.ts` | 删除 `toLegacyProviderChunks`、`languageModelUsageToPiUsage`；保留 `toPiMessage`/`fromPiMessage`/`toPiTool`/`toPiToolResultMessage`/`migrateConversationToPiAi` |
| `packages/core/src/token-usage.ts` | 完全基于 `pi.Usage`；删除 `LanguageModelUsage` 相关函数 |
| `packages/core/src/index.ts` | 更新导出，移除旧 LLM provider 导出；确认公开 API 仍稳定 |
| `packages/core/README.md` | 更新 LLM 层描述 |
| `docs/architecture.md` | 更新 LLM Provider 层架构图 |
| `docs/core-design.md` | 更新 Core 层事件与 LLM 设计 |
| `packages/core/tests/llm/` | 删除旧 provider 测试；保留 pi-adapter / models 测试 |
| `packages/core/tests/session-migration.test.ts` | 补充迁移幂等性测试 |

---

## Task 1: 删除 `deprecated/` 目录和旧 LLM 文件

**Files:**
- Delete: `packages/core/src/deprecated/`
- Delete: `packages/core/src/llm/types.ts`（如确认无引用）
- Delete: `packages/core/src/llm/providers/` 目录
- Delete: `packages/core/src/llm/api-registry.ts`（如尚未移动）
- Delete: `packages/core/src/llm/engine.ts`（如尚未移动）
- Delete: `packages/core/src/llm/stream-collector.ts`（如尚未移动）
- Delete: `packages/core/src/llm/partition-stream.ts`（如尚未移动）

- [ ] **Step 1: 删除文件**

```bash
rm -rf packages/core/src/deprecated
rm -rf packages/core/src/llm/providers
rm -f packages/core/src/llm/types.ts
rm -f packages/core/src/llm/api-registry.ts
rm -f packages/core/src/llm/engine.ts
rm -f packages/core/src/llm/stream-collector.ts
rm -f packages/core/src/llm/partition-stream.ts
```

- [ ] **Step 2: 确认 `packages/core/src/llm/` 只剩 `models.ts` 和 `context-window.ts`**

```bash
ls packages/core/src/llm/
# Expected: models.ts context-window.ts
```

- [ ] **Step 3: Commit**

```bash
git add -A
 git commit -m "chore(core): remove deprecated LLM provider files and old adapters"
```

---

## Task 2: 清理 `types.ts` 旧兼容类型

**Files:**
- Modify: `packages/core/src/types.ts`

- [ ] **Step 1: 删除旧兼容别名**

```ts
// 删除以下代码：
// export type AgentStreamChunk = AgentStreamEvent;
// export type ProviderChunk = never;
// export interface LanguageModelUsage { ... }  // 如果已替换为 pi.Usage
```

- [ ] **Step 2: 搜索并替换所有 `LanguageModelUsage` 引用为 `Usage`**

```bash
rg "LanguageModelUsage" packages/core/src
# 对每一处引用，改为从 pi-ai import 的 Usage 或本地兼容类型
```

- [ ] **Step 3: 运行类型检查**

```bash
pnpm --filter rem-agent-core typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types.ts
 git commit -m "types(core): remove legacy AgentStreamChunk, ProviderChunk and LanguageModelUsage aliases"
```

---

## Task 3: 清理 `pi-adapter.ts` 过渡函数

**Files:**
- Modify: `packages/core/src/pi-adapter.ts`

- [ ] **Step 1: 删除 `toLegacyProviderChunks` 和 `languageModelUsageToPiUsage`**

```ts
// 保留：
// toPiMessage, fromPiMessage, toPiTool, toPiToolResultMessage
// fromPiAssistantMessage, piUsageToLanguageModelUsage (如果 Bridge/Web 仍需要)
// migrateConversationToPiAi

// 删除：
// toLegacyProviderChunks
// languageModelUsageToPiUsage
```

- [ ] **Step 2: 如果 Bridge/Web 已完全使用 pi.Usage，可删除 `piUsageToLanguageModelUsage` 并统一使用 `pi.Usage`**

```ts
// 如果删除 piUsageToLanguageModelUsage，确保没有引用
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/pi-adapter.ts
 git commit -m "refactor(core): remove Phase 1/2 adapter shims from pi-adapter"
```

---

## Task 4: 更新 `token-usage.ts` 完全基于 `pi.Usage`

**Files:**
- Modify: `packages/core/src/token-usage.ts`

- [ ] **Step 1: 删除 `LanguageModelUsage` 相关函数，只保留 `pi.Usage` 函数**

```ts
import type { Usage } from '@earendil-works/pi-ai';

export function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

export function addUsage(a: Usage, b: Usage): Usage {
  return { /* ... */ };
}

export function addCost(a: Usage['cost'], b: Usage['cost']): Usage['cost'] {
  return { /* ... */ };
}

export function formatUsage(usage: Usage): string {
  return `${usage.totalTokens} tokens (${usage.input} in / ${usage.output} out)`;
}
```

- [ ] **Step 2: 运行测试**

```bash
pnpm --filter rem-agent-core test packages/core/tests/token-usage.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/token-usage.ts
 git commit -m "refactor(usage): fully adopt pi.Usage and remove legacy usage types"
```

---

## Task 5: 完成 Session 数据迁移清理

**Files:**
- Modify: `packages/core/src/plugins/session/*`
- Test: `packages/core/tests/session-migration.test.ts`

- [ ] **Step 1: 确保 `load()` 只在 `schemaVersion < 2` 时迁移，并写入新 schemaVersion**

```ts
if ((session.metadata?.schemaVersion ?? 1) < 2) {
  const { messages, messageIds } = migrateConversationToPiAi(session.conversation);
  session.conversation = messages;
  session.metadata = {
    ...session.metadata,
    schemaVersion: 2,
    messageMeta: { ...(session.metadata?.messageMeta as object), ...messageIds },
  };
  await this.save(session);
}
```

- [ ] **Step 2: 添加迁移幂等性测试**

```ts
it('does not migrate twice', async () => {
  const session = await provider.load('old-session');
  expect(session.metadata.schemaVersion).toBe(2);
  const conversationBefore = JSON.stringify(session.conversation);
  const reloaded = await provider.load('old-session');
  expect(JSON.stringify(reloaded.conversation)).toBe(conversationBefore);
});
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/plugins/session/* packages/core/tests/session-migration.test.ts
 git commit -m "feat(session): finalize schemaVersion migration and add idempotency test"
```

---

## Task 6: 更新 `index.ts` 公开导出

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 移除旧 LLM provider 导出，确认新的导出**

```ts
// 移除：
// export { registerProvider, resolveProvider, ... } from './llm/api-registry.js'
// export { openaiProvider, anthropicProvider } from './llm/providers/index.js'

// 保留或新增：
export { createCoreModels } from './llm/models.js';
export type { RemMessage, AgentStreamEvent, StreamErrorInfo } from './types.js';
```

- [ ] **Step 2: 确认 bridge / web / tui 没有 import 被删除的导出**

```bash
rg "from 'rem-agent-core/(llm/|reason/|api-registry|providers)" packages/bridge/src packages/web/src packages/tui/src
# 修复任何残留引用
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
 git commit -m "feat(core): update public exports for pi-ai migration"
```

---

## Task 7: 更新文档

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/core-design.md`
- Modify: `packages/core/README.md`

- [ ] **Step 1: 更新 `docs/architecture.md` 的 LLM Provider 层描述**

```markdown
## 7. LLM Provider 层

```
src/llm/
├── models.ts              # pi-ai Models 集合初始化
├── context-window.ts      # 上下文窗口（后续可替换为 pi-ai 模型元数据）
└── pi-adapter.ts          # REM ↔ pi-ai 类型转换
```

Core 通过 `AgentContext.models` 使用 pi-ai `Models` 集合，`runAgent` 直接调用 `models.stream(model, context, options)` 和 `models.complete(...)`。
```

- [ ] **Step 2: 更新 `docs/core-design.md` 的事件与 LLM 章节**

重点更新：
- `AgentStreamEvent = AssistantMessageEvent | RemMetaEvent`；
- 工具结果作为 `ToolResultMessage`；
- `Session.conversation` 为 `pi.Message[]`；
- 删除 `InferenceEngine` / `StreamCollector`。

- [ ] **Step 3: 更新 `packages/core/README.md`**

- 更新 LLM 调用示例；
- 更新 `createAgentFromEnv` 行为说明；
- 说明 `RemMessage` 和 `messageMeta`。

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md docs/core-design.md packages/core/README.md
 git commit -m "docs: update architecture and core docs for pi-ai migration"
```

---

## Task 8: 清理测试文件

**Files:**
- Delete: `packages/core/tests/llm/engine.test.ts`（如果存在）
- Delete: `packages/core/tests/llm/providers/openai.test.ts`（如果存在）
- Delete: `packages/core/tests/llm/providers/anthropic.test.ts`（如果存在）
- Modify: `packages/core/tests/llm/api-registry.test.ts`（如果存在，改为 models 测试）

- [ ] **Step 1: 删除旧 provider 测试**

```bash
rm -f packages/core/tests/llm/engine.test.ts
rm -f packages/core/tests/llm/providers/openai.test.ts
rm -f packages/core/tests/llm/providers/anthropic.test.ts
rm -f packages/core/tests/llm/api-registry.test.ts
```

- [ ] **Step 2: 确认剩余测试覆盖核心路径**

- `pi-adapter.test.ts`：round-trip；
- `models.test.ts`：Models 集合；
- `reason.test.ts`：pi-ai 路径；
- `session-migration.test.ts`：迁移；
- `execute-tools.test.ts`：工具结果消息。

- [ ] **Step 3: Commit**

```bash
git add -A
 git commit -m "test(core): remove old LLM provider tests and keep pi-ai coverage"
```

---

## Task 9: 全量验证与收尾

- [ ] **Step 1: 类型检查**

```bash
pnpm typecheck
# Expected: PASS
```

- [ ] **Step 2: 测试**

```bash
pnpm test
# Expected: PASS
```

- [ ] **Step 3: 旧 session 兼容测试**

```bash
# 准备一个 schemaVersion=1 的旧 session 文件，加载并继续对话，确认无错误
```

- [ ] **Step 4: 检查文件树**

```bash
find packages/core/src/llm -type f
# Expected: models.ts, context-window.ts (and any remaining utilities only)

find packages/core/src/deprecated -type f
# Expected: (empty or directory nonexistent)
```

- [ ] **Step 5: Commit final fixes**

```bash
git add .
 git commit -m "fix(core): Phase 3 cleanup final fixes"
```

---

## Self-Review Checklist

- [ ] `packages/core/src/llm/` 只剩 `models.ts` 和 `context-window.ts`；
- [ ] `packages/core/src/deprecated/` 已删除；
- [ ] `types.ts` 中没有 `AgentStreamChunk` / `ProviderChunk` / `LanguageModelUsage` 兼容别名；
- [ ] `pi-adapter.ts` 中没有 `toLegacyProviderChunks` 或 `languageModelUsageToPiUsage`；
- [ ] `token-usage.ts` 只基于 `pi.Usage`；
- [ ] `index.ts` 没有导出已删除的模块；
- [ ] 旧 session 自动迁移后 `schemaVersion = 2` 且再次加载不重复迁移；
- [ ] 文档已更新；
- [ ] `pnpm typecheck` 和 `pnpm test` 全绿。

---

## 完成标志

- 全量测试通过；
- 旧 session 可读；
- 新 session 文件格式为 `pi.Message[]`；
- 文档与代码一致；
- 无 `deprecated/` 目录残留。
