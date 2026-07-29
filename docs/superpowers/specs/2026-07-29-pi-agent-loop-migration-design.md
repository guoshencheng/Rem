# pi-agent-core Agent 循环迁移设计

日期：2026-07-29
状态：已批准

## 背景与目标

rem core 当前用自建 `ReactLoop` 驱动 ReAct 循环，LLM 调用层已统一为 `@earendil-works/pi-ai` 的 `Models` 集合。本次迁移将循环层替换为 `@earendil-works/pi-agent-core` 的 **`Agent` 类**（中层抽象），并顺带将 session 存储迁移到 pi 的 tree entry 模型。

依赖方向不变：

```
pi-ai（Provider / Models / 协议）← pi-agent-core（Agent 循环）← rem core（编排 / 持久化 / 审批）
```

已确认的关键决策（来自 brainstorming）：

1. 采用 pi-agent-core 的**中层 `Agent` 类**（非低层 `agentLoop()`，非高层 `AgentHarness`）。
2. 工具审批走 pi 的 **`beforeToolCall` hook**，接 rem 现有 `permissionEvaluator`。
3. 持久化参照 pi-coding-agent 模式：`subscribe` 事件驱动增量落盘。
4. session 存储迁移到 pi 的 **tree entry 模型**（仅存储模型；fork/branch/compaction entry 本期不做）。
5. **删除** `LoopStrategy` / `ReactLoop` 抽象，`runAgent` 直接编排 pi Agent。
6. 暴露 **`steer` / `followUp`**（含 bridge 路由），`abort` 保持现有能力。
7. 集成形态：**就地覆盖重写 `run-agent.ts`**，拆分为 `src/run-agent/` 目录模块（逻辑参考独立适配层方案，但不新增平行适配层）。

## 模块划分

就地替换 `src/run-agent.ts` 单文件，拆为 `src/run-agent/` 目录，并新增 `src/session-tree/`：

```
packages/core/src/
  run-agent/
    index.ts              — runAgent 入口编排（加载 session → 组装 → 跑 → 收尾）
    pi-agent-factory.ts   — 构造 pi Agent：streamFn = di.models.streamSimple.bind(di.models)，
                            注入 getApiKey / beforeToolCall / transformContext / steering 配置
    tool-bridge.ts        — rem ToolSet + delegate-task/todowrite overlay → pi AgentTool[]
                            （execute 抛异常约定，审批经 beforeToolCall → permissionEvaluator）
    context-bridge.ts     — transformContext 挂 compressor（LLMSummarizingCompressor 保留），
                            budget 检查仍在入口做
    event-bridge.ts       — pi AgentEvent → rem AgentStreamEvent 映射 + 转发 AgentEventStreamController
    session-writer.ts     — subscribe 事件驱动增量持久化（message_end/tool_execution_end → tree entry）
  session-tree/           — tree session 存储模型（替换现有 session 线性存储）
    types.ts              — entry 树模型（parentId/leafId），对齐 pi SessionTreeEntry
    sqlite-storage.ts     — rem SqliteStorageProvider 上的 tree 实现（新表 + 迁移）
    context-builder.ts    — leaf → root 回溯重建 messages
```

### 删除清单

- `src/sdk/loop-strategy.ts`（`LoopStrategy` / `LoopContext` / `LoopResult`）
- `src/plugins/loop/react/`（`ReactLoop`）
- `src/reason/reason.ts`（主流程已不使用；`generate.ts` 保留，供 compressor / titleProvider）
- `AgentDI.loopStrategy` 字段及装配处默认值

### Provider 自定义路径（不变）

`createCoreModels({ all: true, customProviders })` → `Models` 集合 → `streamFn`。pi Agent 不感知 provider，只认 `Model` + `streamFn`；`ConfigProvider` 继续负责 provider/model/apiKey/baseURL 解析。AGENTS.md 红线"Provider 配置由 Core 拥有"不受影响。

## 数据流（一次 run 的完整序列）

```
runAgent(params)
  │
  ├─ 1. session-tree 加载/创建：leaf → root 回溯重建 pi Message[]（含压缩截断）
  ├─ 2. budgetPolicy 检查 + resolveContextWindow（与现状一致）
  ├─ 3. tool-bridge：DefaultToolComposer 合并（toolProvider + mcp + skills）
  │     → OverlayToolProvider 叠加 delegate-task/todowrite → 逐个包装成 pi AgentTool
  ├─ 4. 组装 system prompt（现有 ProviderAwareTemplateSelector + sections，不动）
  ├─ 5. pi-agent-factory 构造 Agent：
  │     ├─ streamFn = models.streamSimple.bind(models)（Provider 分发在 pi-ai 内）
  │     ├─ getApiKey = (provider) => ConfigProvider 解析的 apiKey
  │     ├─ beforeToolCall → permissionEvaluator 审批；拒绝 → block，loop 收到 isError toolResult
  │     ├─ transformContext → compressor.shouldCompress 时执行压缩（对发给 LLM 的副本生效，
  │     │   不改 Agent.state.messages 本体）
  │     └─ steeringMode / followUpMode 队列开启
  ├─ 6. agent.subscribe(event-bridge)：
  │     ├─ message_start/update/end → 映射为 AgentStreamEvent → AgentEventStreamController（SSE 到 UI 不变）
  │     ├─ tool_execution_start/end → 同上
  │     └─ message_end / toolResult → session-writer 增量 append tree entry（SQLite）
  ├─ 7. agent.prompt(userMessage) → pi runLoop 驱动（内部处理多步 tool call 循环）
  └─ 8. agent_end → usage 汇总持久化 → controller.finish()
```

### 关键语义对齐

- rem 的 `RemMessage` id 由 session-writer 在写 entry 时生成，事件里通过等价 `resolveMessageId` 机制携带（保持 UI 的 messageId 关联能力）。
- `message_update` 里的 `assistantMessageEvent`（text_delta 等）直接透传为现有 `AgentStreamEvent`，bridge/UI 的 SSE 协议**不变**。
- abort：bridge 现有 abort 路由 → `agent.abort()`。
- steer/followUp：bridge 新增路由 → `agent.steer(msg)` / `agent.followUp(msg)`，复用同一 subscribe 事件流，UI 无需新协议（新消息照常从 message_start 事件流出）。

## tree session 存储模型

模型对齐 pi 的 `SessionTreeEntry`，由 rem 自己实现（不依赖 harness 层）：

```typescript
type SessionTreeEntry =
  | { id: string; parentId: string | null; timestamp: number; type: 'message'; message: pi.Message }
  | { id: string; parentId: string | null; timestamp: number; type: 'model_change'; provider: string; model: string }
  | { id: string; parentId: string | null; timestamp: number; type: 'label'; label: string };
```

本期只有 `message` / `model_change` / `label` 三种 entry；compaction、branch_summary 类型预留不进 schema。

### SQLite schema（SqliteStorageProvider 新增迁移）

```sql
CREATE TABLE session_entries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  parent_id TEXT,
  type TEXT NOT NULL,        -- message | model_change | label
  payload TEXT NOT NULL,     -- JSON
  created_at INTEGER NOT NULL
);
ALTER TABLE sessions ADD COLUMN active_leaf_id TEXT;
CREATE INDEX idx_entries_session ON session_entries(session_id);
```

### 写入时机

- `appendEntry` 单条 INSERT，事务内同步更新 `sessions.active_leaf_id`。
- 消息 entry 在 `message_end` 时立即写。
- `model_change` / `label` 在 `agent_end` 时批量冲刷（参照 pi harness 的 pendingSessionWrites 模式）。

### 恢复

打开 session = 读 `active_leaf_id` → 沿 `parent_id` 回溯到 root → 反转得 `pi.Message[]` → 灌进 `Agent` 的 `initialState.messages`。进程崩溃后天然可恢复到上一条已落盘消息。

### 旧数据迁移

现有线性 messages 表 → 按时间序生成单链 tree（`parent_id` = 前一条 entry id），`active_leaf_id` = 最后一条。单个 session 的迁移用事务包裹，失败回滚该 session（不留半迁移态）。

### 本期不做

fork / branch / navigateTree、compaction entry。压缩仍走现有"替换上下文"语义，作用于 `transformContext` 的 LLM 入参副本。

## 错误处理

| 场景 | 行为 |
|---|---|
| LLM 流错误（`stopReason: 'error'`） | pi loop 发 `turn_end` + `agent_end` 退出；event-bridge 映射为 rem 错误事件；失败消息照样经 `message_end` 持久化 |
| 工具 execute 抛异常 | pi loop 自动捕获 → `isError: true` 的 toolResult，循环继续（pi 原生约定） |
| 审批拒绝 | `beforeToolCall` 返回 block → pi 生成 isError toolResult 并继续，不中断 run |
| `stopReason: 'length'` | pi 自动将截断消息的所有 tool call 标记为错误，不执行 |
| session 写入失败 | 单条 entry 写失败 → 记录错误并中断 run（宁可中断也不产生内存/盘面漂移） |
| 重试 | pi `streamSimple` 自带重试（`maxRetryDelayMs` 可配）；删除 rem 手写 3 次重试逻辑。ErrorHandler 保留用于事件层错误分类 |

## 测试策略

vitest，放 `packages/core/tests/`：

1. **tool-bridge**：rem ToolDefinition → AgentTool 的参数校验、异常 → isError 映射、审批 block 路径（mock permissionEvaluator）。
2. **event-bridge**：用 pi-ai faux provider 喂固定事件序列，断言输出 `AgentStreamEvent` 序列与现有 bridge 协议一致（回归保护 SSE 契约）。
3. **session-tree**：appendEntry / leaf 回溯 / 崩溃恢复（写一半模拟中断）/ 旧线性数据迁移。
4. **集成**：`createAgentFromEnv` + faux provider 跑完整 runAgent，断言 tree entry 落盘顺序与事件流；steer / followUp / abort 各一个用例。
5. 迁移后 `pnpm typecheck && pnpm test` 全量回归。

## 实施顺序（供实现计划参考）

1. session-tree 存储（schema 迁移 + appendEntry/回溯 + 旧数据迁移）— 可独立验证。
2. run-agent 重写接入 pi Agent（tool-bridge / event-bridge / session-writer）— SSE 契约回归。
3. bridge 新增 steer / followUp 路由。

## 不做清单（YAGNI）

- pi `AgentHarness`（Session/compaction/skills/hook 体系与 rem 重叠，不引入）。
- tree 的 fork/branch/navigateTree 与 UI。
- compaction entry（压缩语义不变，只换挂载点）。
- UI 侧改动（SSE 协议不变）。
