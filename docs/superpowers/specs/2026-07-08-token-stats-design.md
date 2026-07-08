# Token 统计与上下文窗口比例设计

> 日期：2026-07-08
> 状态：设计已确认，待实施

---

## 1. 背景与目标

当前 `rem-agent-core` 的 LLM Provider（OpenAI / Anthropic）已经能返回 `usage`，`StreamChunk` 也定义了 `type: 'usage'`，但上层没有真正消费这些数据：

- `reason.ts` 没有把 usage chunk 转发到流中
- `stream-aggregators.ts` 的 `aggregateUsage()` 直接返回全 0
- `AgentLiveState` / `Session.metadata` 没有 token 统计
- Bridge / Web 状态里没有 usage 字段

本设计目标：在 Core 层完整收集 token 使用数据，向上暴露给 Bridge / Web，并提供会话累计、每轮明细、cache 命中、上下文窗口比例等能力。

---

## 2. 需求范围

### 2.1 统计粒度

- **单次用户请求**：一条 assistant 消息对应一次 `runAgent()` 调用的总 token
- **每轮 ReAct**：一次 `runAgent()` 内部可能有多轮 reason/execute，每轮单独统计
- **会话累计**：跨多次用户请求，按 session 累计

### 2.2 明细保留

完整 token 原信息需要保留，包括：

- `inputTokens` / `outputTokens` / `totalTokens`
- `inputTokenDetails`：
  - `noCacheTokens`
  - `cacheReadTokens`
  - `cacheWriteTokens`
- `outputTokenDetails`：
  - `textTokens`
  - `reasoningTokens`

### 2.3 展示位置

- **每条 assistant 消息底部**：显示本次请求总 token
- **聊天框上方**：显示当前会话累计 token（含 cache 数值）和上下文窗口比例
- **独立统计面板 / Popover**：显示 cache 明细、每轮明细、完整原信息

### 2.4 上下文窗口比例

- 内置常见模型 context window 表
- 允许通过环境变量覆盖
- 比例 = 当前会话累计已用 token / 模型最大窗口

---

## 3. 设计决策

### 3.1 方案选择

采用 **方案 A：流增强型**，核心思路：

1. 让 `AgentStream.usage` 真正工作
2. `AgentLiveState` 持有当前会话累计 usage
3. `session.metadata.tokenUsageHistory` 只存明细
4. `AgentState` 通过 `usage-change` BusEvent 向 Web 广播更新

### 3.2 状态分层

| 层级 | 存放内容 | 生命周期 |
|---|---|---|
| `AgentLiveState.tokenUsage` | 当前会话累计 usage | 运行时内存，跨请求存活 |
| `session.metadata.tokenUsageHistory` | 每次 run / 每轮明细 | 通过 `SessionProvider` 持久化 |
| Web UI State | 当前显示用的累计 usage | 组件状态 |

### 3.3 上下文窗口来源

- 内置表覆盖常见模型
- 环境变量 `MAX_CONTEXT_TOKENS` 可全局覆盖；`<PROVIDER>_<MODEL>_MAX_CONTEXT_TOKENS` 可针对特定模型覆盖
- 未知模型回退到保守默认值（如 128k）

---

## 4. 架构

```
┌─────────────────────────────────────────┐
│  rem-agent-web                          │
│  - use-agents.ts（新增 usage 状态）       │
│  - ChatPanel 顶部显示会话累计 token        │
│  - MessageItem 底部显示单条 token          │
│  - TokenStatsBadge / TokenStatsPopover    │
└─────────────────┬───────────────────────┘
                  │ BusEvent: usage-change
┌─────────────────▼───────────────────────┐
│  rem-agent-bridge                       │
│  - AgentService 透传 chunk               │
│  - SessionSummary 暴露累计 token         │
└─────────────────┬───────────────────────┘
                  │ AgentStreamChunk（含 usage）
┌─────────────────▼───────────────────────┐
│  rem-agent-core                         │
│  - reason.ts：转发 usage chunk           │
│  - AgentStreamController：接收 usage chunk│
│  - stream-aggregators.ts：聚合 usage     │
│  - run-agent.ts：累加并写明细到 metadata  │
│  - AgentState：发布 usage-change 事件    │
│  - llm/context-window.ts：窗口表         │
│  - token-usage.ts：累加/格式化工具       │
└─────────────────────────────────────────┘
```

---

## 5. 组件

### 5.1 Core 层

#### `AgentStreamChunk` 扩展（`src/types.ts`）

```typescript
export type AgentStreamChunk =
  | ... // 现有类型
  | {
      type: 'usage';
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      inputTokenDetails?: {
        noCacheTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
      };
      outputTokenDetails?: {
        textTokens?: number;
        reasoningTokens?: number;
      };
    };
```

#### `AgentLiveState` 扩展（`src/state.ts`）

```typescript
export class AgentLiveState {
  // ... 现有字段

  tokenUsage: LanguageModelUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
  };

  addTokenUsage(usage: LanguageModelUsage): void {
    this.tokenUsage = addUsage(this.tokenUsage, usage);
  }
}
```

#### `AgentState` 扩展（`src/agent-state.ts`）

```typescript
publishUsageChange(workspace: string, sessionId: string, usage: LanguageModelUsage): void {
  this.bus.publish({ workspace, sessionId, type: 'usage-change', usage });
}
```

#### 新增 `llm/context-window.ts`

```typescript
export interface ContextWindowEntry {
  maxTokens: number;
}

export function resolveContextWindow(
  provider: string,
  model: string,
  env?: NodeJS.ProcessEnv,
): number;

export function computeWindowRatio(
  usage: LanguageModelUsage,
  maxTokens: number,
): number;
```

内置常见模型表，支持环境变量覆盖。

#### 新增 `token-usage.ts`

```typescript
export interface TokenUsageDetail extends LanguageModelUsage {
  runAt: Date;
  turns: LanguageModelUsage[]; // 每轮 ReAct 明细
}

export function emptyUsage(): LanguageModelUsage;
export function addUsage(a: LanguageModelUsage, b: LanguageModelUsage): LanguageModelUsage;
export function formatUsage(u: LanguageModelUsage): string;
export function computeCacheStats(u: LanguageModelUsage): {
  cacheRead: number;
  cacheWrite: number;
  noCache: number;
};
```

#### `reason.ts` 修改

在 `onChunk` 中转发 `usage` chunk：

```typescript
onChunk: (chunk: StreamChunk) => {
  if (chunk.type === 'usage') {
    emit({
      type: 'usage',
      inputTokens: chunk.inputTokens,
      outputTokens: chunk.outputTokens,
      totalTokens: chunk.totalTokens,
      inputTokenDetails: chunk.inputTokenDetails,
      outputTokenDetails: chunk.outputTokenDetails,
    });
  }
  // ... 现有 text/reasoning/tool-call 处理
}
```

#### `run-agent.ts` 修改

```typescript
// reason() 返回后
liveState.addTokenUsage(result.usage);
agentState.publishUsageChange(workspace, params.sessionId, liveState.tokenUsage);

// 明细追加到 metadata
session.metadata.tokenUsageHistory = session.metadata.tokenUsageHistory ?? [];
session.metadata.tokenUsageHistory.push({
  runAt: new Date(),
  inputTokens: result.usage.inputTokens,
  outputTokens: result.usage.outputTokens,
  totalTokens: result.usage.totalTokens,
  inputTokenDetails: result.usage.inputTokenDetails,
  outputTokenDetails: result.usage.outputTokenDetails,
  turns: [
    // 每轮 ReAct 的 usage 明细
    {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
      inputTokenDetails: result.usage.inputTokenDetails,
      outputTokenDetails: result.usage.outputTokenDetails,
    },
  ],
});
await sessionProvider.save(session);
```

### 5.2 Bridge 层

#### `BusEvent` 扩展（`src/bus-events.ts` 或 `src/types.ts`）

```typescript
export type BusEvent =
  | ... // 现有类型
  | { workspace: string; sessionId: string; type: 'usage-change'; usage: LanguageModelUsage };
```

#### `SessionSummary` 扩展

```typescript
export interface SessionSummary {
  // ... 现有字段
  tokenUsage?: LanguageModelUsage;
}
```

#### `AgentService.listSessions()`

从 session metadata 重新计算累计 usage 返回。

### 5.3 Web 层

#### `use-agents.ts` 扩展

```typescript
interface SessionState {
  // ... 现有字段
  tokenUsage?: LanguageModelUsage;
}

// 在 event handler 中
case 'usage-change': {
  state.tokenUsage = event.usage;
  notifyChange();
  break;
}
```

#### 新增 `components/chat/token-stats.tsx`

- `TokenStatsBadge`：显示累计 token + 窗口比例 + cache 数值
- `TokenStatsPopover`：显示完整明细

#### `MessageItem` 修改

assistant 消息底部显示本次请求总 token。

#### `ChatPanel` 修改

聊天框上方渲染 `TokenStatsBadge`。

---

## 6. 数据流

### 6.1 单次请求

```
用户输入
  │
  ▼
[web] sendMessage()
  │
  ▼
[bridge] AgentService.run(sessionId, input)
  │  1. agentState.startRun(sessionId, workspace)
  │     - 从 session.metadata.tokenUsageHistory 恢复累计值到 liveState.tokenUsage
  │
  ▼
[core] runAgent(params)
  │  2. 创建 EventBus，liveState.attachEvents(events)
  │  3. 保存 user message
  │
  ▼
[core] loopStrategy.run(loopCtx)
  │
  ├──► loopCtx.reason() → reason.ts
  │      │
  │      ├──► InferenceEngine.infer(stream)
  │      │      │
  │      │      ├──► provider.stream() 产生 usage chunk
  │      │      │
  │      │      └──► onChunk 转发 usage chunk → AgentStreamController
  │      │
  │      └──► 返回 ReasonResult { usage }
  │
  ▼
[core] run-agent.ts
  │  4. liveState.addTokenUsage(result.usage)
  │  5. agentState.publishUsageChange(workspace, sessionId, liveState.tokenUsage)
  │     └──► BroadcastBus → Web UI
  │  6. 把本次 usage 明细追加到 session.metadata.tokenUsageHistory
  │  7. sessionProvider.save(session)
```

### 6.2 恢复累计值

```typescript
function restoreTokenUsageFromHistory(
  history: TokenUsageDetail[],
): LanguageModelUsage {
  return history.reduce((acc, detail) => addUsage(acc, detail), emptyUsage());
}
```

在 `AgentState.startRun()` 或 `runAgent()` 开始时，如果 `liveState.tokenUsage` 为初始空值，就从 `session.metadata.tokenUsageHistory` 恢复。

### 6.3 窗口比例

```
展示时
  │
  ▼
resolveContextWindow(provider, model, env) → maxTokens
  │
  ▼
computeWindowRatio(liveState.tokenUsage, maxTokens)
  │
  ▼
TokenStatsBadge 显示比例
```

---

## 7. 错误处理

| 场景 | 处理策略 |
|---|---|
| Provider 不返回 usage | 兼容 `undefined`，按 0 处理 |
| usage chunk 重复 | 在 `StreamCollector` / `reason.ts` 中确保每条响应只取一个 usage |
| reason() 重试 | 只累加最后一次成功调用的 usage |
| 运行中断/abort | 已产生的 usage 保留在 liveState 和 metadata history 中 |
| 进程重启 | 从 `tokenUsageHistory` 重新计算累计值 |
| 未知模型 context window | 回退默认值 128k，debug log warning |
| 环境变量格式错误 | 忽略覆盖，回退内置表 |

---

## 8. 测试

### 8.1 Core 层

- `stream-aggregators.test.ts`：测试 `aggregateUsage` 累加逻辑
- `token-usage.test.ts`：测试 `addUsage`、`computeCacheStats`、`formatUsage`
- `context-window.test.ts`：测试模型表解析、环境变量覆盖、未知模型回退、比例计算
- `reason.test.ts`：mock provider stream，验证 usage chunk 转发
- `run-agent.test.ts`：验证 liveState 累计、metadata history 写入、`usage-change` 发布

### 8.2 Bridge 层

- `agent.test.ts`：验证 `listSessions()` 返回 `tokenUsage`，验证 `usage-change` event 订阅

### 8.3 Web 层

- `TokenStatsBadge`：显示总 token、窗口比例
- `TokenStatsPopover`：显示 cache 明细
- `use-agents`：收到 `usage-change` 后状态更新

### 8.4 端到端

- 一次完整对话后，检查 UI 累计值与会话 metadata 明细一致

---

## 9. 待确认 / 后续

- 是否需要按模型分别统计累计值？
- 是否需要成本估算（按模型单价计算 USD）？
- 每轮 ReAct 明细是否在 UI 第一版就展示，还是后续迭代？
