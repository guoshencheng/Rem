# 上下文压缩（Context Compression）设计

> 状态：✅ 已评审（2026-07-14）
>
> 目标：为 Rem Agent 实现基于 LLM 摘要的上下文压缩能力，替代当前的 `NoOpCompressor`，防止长会话超出模型上下文窗口。

---

## 1. 背景与目标

当前 `ContextCompressor` 接口已存在于 `packages/core/src/sdk/compressor.ts`，但仅实现了 `NoOpCompressor`，压缩从未真正触发。随着会话变长，token 数会逐渐逼近模型上下文窗口上限，最终导致 LLM 调用失败。

本设计实现一套主动阈值触发的 LLM 摘要压缩机制：

- 当累计 token 使用超过模型上下文窗口的 80% 时自动压缩
- 保留头部 3 条消息和尾部 20 条消息，中间旧消息由主模型生成结构化 Markdown 摘要
- 压缩前完整快照归档到 SQLite，支持任意层还原
- 压缩过程通过流式事件推送到前端，用户可感知

---

## 2. 架构与模块边界

### 2.1 Core 层改动

| 模块 | 职责 | 文件 |
|---|---|---|
| `plugins/compressor/llm-summary/` | 实现 `ContextCompressor`，负责阈值判断、head/tail 切分、LLM 摘要生成 | `index.ts`（主类）、`prompt.ts`（摘要模板）、`split.ts`（消息切分） |
| `storage/sqlite/archive-store.ts` | SQLite 归档存储，读写 `archived_messages` 表 | 单文件 |
| `storage/types.ts` | 新增 `ArchiveStore` 接口 | 扩展 |
| `storage/schema.ts` | 新增 `archived_messages` 表迁移 | 扩展 |
| `sdk/config-provider.ts` | 新增 `CompressionConfig` 和 `getCompressionConfig()` | 扩展 |
| `types.ts` | 新增压缩相关流式 chunk 类型 | 扩展 |
| `run-agent.ts` | 在压缩前后发送流式事件 | 扩展 |

### 2.2 前端改动

| 模块 | 职责 |
|---|---|
| `web` / `tui` | 识别新的压缩 chunk，展示"正在压缩上下文…"状态条 |

### 2.3 边界原则

- 压缩逻辑完全在 core 插件内，不依赖 web/tui
- 归档存储走现有 SQLite 基建，不新增外部依赖
- 前端只消费事件，不感知压缩算法细节

---

## 3. 组件与接口

### 3.1 `CompressionConfig`

```typescript
interface CompressionConfig {
  enabled: boolean;           // 默认 true
  thresholdRatio: number;     // 默认 0.8
  protectHead: number;        // 默认 3
  protectTail: number;        // 默认 20
}
```

### 3.2 `ArchiveStore` 接口

```typescript
interface ArchiveRecord {
  id: string;
  sessionId: string;
  compressedAt: Date;
  version: number;              // 0 = 原始，1 = 第一次压缩…
  parentArchiveId?: string;     // 形成版本链
  conversationSnapshot: ModelMessage[];
  summary: string;
  tokenUsageBefore?: LanguageModelUsage;
  tokenUsageAfter?: LanguageModelUsage;
}

interface ArchiveStore {
  save(record: ArchiveRecord): Promise<void>;
  get(id: string): Promise<ArchiveRecord | null>;
  listBySession(sessionId: string): Promise<ArchiveRecord[]>;
  getLatest(sessionId: string): Promise<ArchiveRecord | null>;
}
```

### 3.3 `LLMSummarizingCompressor`

```typescript
class LLMSummarizingCompressor implements ContextCompressor {
  constructor(config: CompressionConfig, modelConfig: ResolvedModelConfig);

  shouldCompress(session: Session): boolean;
  // 基于 session.metadata.tokenUsageHistory 累计 totalTokens，
  // 与 resolveContextWindow(provider, model) * thresholdRatio 比较

  async compress(messages: ModelMessage[]): Promise<ModelMessage[]>;
  // 1. splitHeadTail(messages) → { head, middle, tail }
  // 2. buildSummaryPrompt(middle) → 调用主模型生成 Markdown 摘要
  // 3. 返回 [head..., summaryMsg, tail...]
}
```

### 3.4 新增流式 chunk

```typescript
type AgentStreamChunk =
  | ...
  | { type: 'compress-start'; sessionId: string; estimatedTokens: number; threshold: number }
  | { type: 'compress-end'; sessionId: string; archiveId: string; removedMessageCount: number }
  | { type: 'compress-error'; sessionId: string; error: string };
```

### 3.5 摘要消息格式

压缩后插入一条 `role: 'system'` 的摘要消息，替代被删除的中间旧消息：

```typescript
{
  id: string,
  role: 'system',
  content: [{
    type: 'text',
    text: '[上下文压缩摘要]\n\n## Objective\n...\n## Important Details\n...'
  }]
}
```

**位置**：放在头部保护消息之后、尾部保护消息之前。

**为什么用 `role: 'system'`**：摘要不是用户说的话，也不是助手的回复，而是系统注入的背景上下文。用 `system` 角色可以让模型明确区分"这是参考背景，不是当前对话的一部分"。

---

## 4. 数据流

### 4.1 压缩触发流程

```
runAgent() 开始
  │
  ▼
contextProvider.build(session) → messages
  │
  ▼
compressor.shouldCompress(session)
  │  ├─ 读取 session.metadata.tokenUsageHistory
  │  ├─ 累计 totalTokens
  │  ├─ resolveContextWindow(provider, model) * thresholdRatio
  │  └─ 判断累计值是否超过阈值
  │
  ├─ 未超过 → 直接进入 ReactLoop
  │
  └─ 超过 → 进入压缩流程
       │
       ▼
  emit 'compress-start' chunk
       │
       ▼
  compressor.compress(messages)
       │  ├─ splitHeadTail(messages, protectHead=3, protectTail=20)
       │  ├─ buildSummaryPrompt(middle) → 调用主模型
       │  └─ 生成 summaryMsg
       │
       ▼
  archiveStore.save({ conversationSnapshot: 压缩前完整对话, summary, version, ... })
       │
       ▼
  session.conversation = [head..., summaryMsg, tail...]
  session.metadata.compressionHistory.push({ archiveId, version, compressedAt, removedMessageCount })
       │
       ▼
  sessionProvider.save(session)
       │
       ▼
  emit 'compress-end' chunk
       │
       ▼
  进入 ReactLoop（使用压缩后的 messages）
```

### 4.2 摘要 Prompt 结构

借鉴 OpenCode 的 anchored summary 模板，输出固定 Markdown 骨架：

```markdown
## Objective
- [用户试图完成什么]

## Important Details
- [约束、偏好、关键决策、重要事实]

## Work State
### Completed
- [已完成的工作]

### Active
- [当前进行中的工作]

### Blocked
- [阻塞项]

## Next Move
1. [下一步行动]

## Relevant Files
- [相关文件路径及原因]
```

**生成策略**：每次压缩从零重新生成摘要，不增量更新。

### 4.3 前端状态展示

- Web / TUI 收到 `compress-start` → 显示"正在压缩上下文…"状态条
- 收到 `compress-end` → 状态条消失，可选 toast 提示"已压缩 N 条消息"
- 收到 `compress-error` → 显示错误并停止本次 run

---

## 5. 配置

### 5.1 Config 文件（YAML/JSON）

在现有 `AgentBehaviorConfig` 中增加 `compression` 节：

```yaml
behavior:
  name: my-agent
  maxTurns: 60
  compression:
    enabled: true
    thresholdRatio: 0.8
    protectHead: 3
    protectTail: 20
```

### 5.2 环境变量覆盖

| 环境变量 | 说明 |
|---|---|
| `REM_COMPRESSION_ENABLED` | `true` / `false` |
| `REM_COMPRESSION_THRESHOLD_RATIO` | 0-1 之间的小数 |
| `REM_COMPRESSION_PROTECT_HEAD` | 正整数 |
| `REM_COMPRESSION_PROTECT_TAIL` | 正整数 |

优先级：**环境变量 > config 文件 > 默认值**

### 5.3 默认行为

- 默认启用压缩
- 默认阈值 80%
- 默认保护头部 3 条、尾部 20 条
- 如果 config 或 env 中未配置，使用默认值

---

## 6. 上下文窗口统一治理

### 6.1 改动 `llm/context-window.ts`

- 默认上下文窗口从 `128_000` 改为 `1_000_000`
- 保留环境变量覆盖：`MAX_CONTEXT_TOKENS`、模型级环境变量
- 保留内置模型映射表，但把默认兜底改为 1M
- 导出统一入口 `resolveContextWindow(provider, model)`，供 core 压缩逻辑和 web 展示共同使用

### 6.2 Web 端同步改动

- `input-box.tsx`、`chat-panel.tsx`、`chat-composer.tsx` 不再硬编码 `128_000`
- 改为从 props 或 config 传入，默认值通过 `resolveContextWindow` 获取
- 百分比展示组件 `token-stats.tsx` 的 `maxTokens` 也统一走这个入口

这样将来如果要支持动态模型列表或自定义 provider，只需要在 `context-window.ts` 一处扩展即可。

---

## 7. 归档存储设计

### 7.1 SQLite 表结构

```sql
CREATE TABLE archived_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  compressed_at INTEGER NOT NULL,
  version INTEGER NOT NULL,
  parent_archive_id TEXT,
  conversation_snapshot TEXT NOT NULL,  -- JSON 数组
  summary TEXT NOT NULL,
  token_usage_before TEXT,               -- JSON
  token_usage_after TEXT,                -- JSON
  metadata TEXT                          -- 可选 JSON
);

CREATE INDEX idx_archived_messages_session ON archived_messages(session_id);
CREATE INDEX idx_archived_messages_version ON archived_messages(session_id, version);
```

### 7.2 还原策略

每条归档存**完整会话快照**，因此任意一层都可以直接还原：

1. 通过 `archiveStore.get(id)` 或 `archiveStore.listBySession(sessionId)` 找到目标归档
2. 将 `conversationSnapshot` 写回 `session.conversation`
3. 清理 `session.metadata.compressionHistory` 中该层之后的记录
4. 保存 session

**版本链**：每条归档带 `version` 和 `parent_archive_id`，形成链式结构，方便追溯多次压缩历史。

---

## 8. 错误处理

| 场景 | 行为 |
|---|---|
| LLM 摘要生成失败 | 中断本次 run，emit `compress-error` chunk，session 保持原样 |
| 归档写入 SQLite 失败 | 中断本次 run，emit `compress-error` chunk，session 保持原样（因为不能丢原始消息） |
| session 保存失败 | 中断本次 run，emit `compress-error` chunk |
| 压缩后仍超阈值 | 本次 run 继续，下一轮再检查；不递归压缩 |
| 首次运行长会话、无历史 usage | 使用字符数估算（`content.length / 4`）作为 fallback，避免永远不触发 |

---

## 9. 测试策略

| 层级 | 测试内容 |
|---|---|
| 单元 | `shouldCompress` 阈值判断（含 fallback 估算） |
| 单元 | `splitHeadTail` 切分逻辑（头部 3 条、尾部 20 条） |
| 单元 | `buildSummaryPrompt` 生成 Markdown 模板 |
| 单元 | `ArchiveStore` SQLite CRUD（save / get / listBySession / getLatest） |
| 单元 | `CompressionConfig` 解析与默认值 |
| 集成 | mock LLM 返回摘要，验证压缩后消息结构正确 |
| 集成 | mock 压缩失败，验证 run 中断且 session 未被修改 |

---

## 10. 后续扩展（不在本 spec 范围）

- Bridge API：`GET /api/sessions/:id/archives`、`POST /api/sessions/:id/restore`
- Web 归档列表 UI 与一键还原
- Tool output pruning（OpenCode 风格的旧工具输出裁剪）
- 手动 `/compress` 触发命令
- 增量摘要（anchored summary）
