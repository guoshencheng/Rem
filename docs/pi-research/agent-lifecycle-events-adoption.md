# PI Agent 生命周期事件流调研及 REM 事件体系升级建议

## 1. 执行摘要：结论与推荐方案

PI（`@earendil-works/pi-agent-core`）把 Agent 运行抽象为清晰的三层事件流：

- **Agent 生命周期**：`agent_start` / `agent_end`
- **Turn 生命周期**：`turn_start` / `turn_end`（一次 LLM 调用 + 可能的多工具执行）
- **Message / Tool 生命周期**：`message_start` / `message_update` / `message_end`、`tool_execution_start` / `tool_execution_update` / `tool_execution_end`

REM 当前的事件体系以**低层流式 chunk**（`text-delta`、`tool-call-start`、`tool-result` 等）和**状态广播**（`session-start`、`activity-change`、`snapshot`）为主，缺少可直接消费的 message-level 和 turn-level 高层事件。UI 与插件必须自己从 chunk 里拼装消息、判断 turn 边界、维护 tool-call 状态，复杂且容易出错。

**推荐结论**：在 REM 中引入 PI 风格的高层生命周期事件，作为现有底层 chunk 流的补充，形成**“高层生命周期事件 + 低层流式 chunk”**双层体系。具体方案：

1. 在 `rem-agent-core` 中新增 `LifecycleBusEvent` 类型，扩展 `BusEvent` 和 `EventBus` 事件集。
2. 由 `runAgent`、`ReactLoop`、`executeTools` 等核心调用点显式发射生命周期事件。
3. `AgentState` 作为广播发布中心，`AgentStreamController` 作为流式侧转发器。
4. 保留所有现有 chunk 与 `session-start`/`session-end` 事件不变，旧消费者无需修改即可继续工作。
5. `bridge` 与 `web` 不需要结构性改动，只需在 UI 中逐步从“chunk 组装”迁移到“生命周期事件”消费。

此举可显著降低 UI 与插件的复杂度，同时为未来调试、日志、审批、计费、指标等横切能力提供稳定的事件入口。

---

## 2. REM 当前事件模型的问题

### 2.1 事件层次过底，UI 消费复杂

REM 当前对外可见的事件主要是 `BusEvent`（`bus-events.ts`）里的 chunk 与状态事件：

- `chunk`：最细粒度的流式片段（`text-delta`、`tool-call-start`、`tool-result` …）。
- `session-start` / `session-end` / `session-error`：一次运行的起止。
- `activity-change`：UI 状态（`thinking`、`calling-function`、`outputting` 等）。
- `snapshot`：当前正在流式写入的消息快照，用于重连恢复。
- `usage-change`：token 使用统计。
- `child-agent-update`、`todo-updated`：业务事件。

UI 要判断“一条消息从哪开始、到哪结束、包含哪些内容、对应哪些 tool call”，必须订阅 `chunk` 并在客户端维护一套复杂的组装逻辑（等价于 `AgentStreamController` 在服务端做的工作）。例如：

- 用户消息：只有 `message-start` 一个 chunk，没有明确的 `message_end`。
- assistant 消息：需要监听 `message-start` → `text-start` → `text-delta` → `text-finish` → `tool-call-*` 组合。
- tool result 消息：需要监听 `tool-result-start` → `tool-result` → `tool-result-finish`。
- 一条消息是否结束、turn 是否结束，需要推断，没有权威事件。

### 2.2 缺少 message-level 生命周期事件

REM 的 `AgentStreamChunk` 里存在 `message-start`、`step-start`/`step-finish` 等事件，但它们仍然面向流式片段，不是完整的消息生命周期。例如：

- 没有 `message:end` 表示某条消息已完整落库。
- 没有 `message:update` 来统一表示 assistant 输出的增量（而是拆成 `text-delta`、`reasoning-delta`、`tool-call` 等多种 chunk）。
- tool result 消息与 tool-call 的对应关系隐藏在 `toolCallId` 中，UI 需要自行管理映射。

### 2.3 缺少 turn-level 生命周期事件

REM 的 `ReactLoop` 发射 `step-start` / `step-finish`，但一个 **turn** 可能包含一次 assistant 生成 + 多步 tool 执行 + 后续 LLM 响应。`step` 与 `turn` 概念并不对齐：

- 当前 `step` 的边界对应一次 LLM 推理的生成段。
- 当 assistant 调用多个工具时，一次 step 之后进入工具执行阶段，再进入下一次 step。
- 没有明确的 `turn_start` / `turn_end` 告诉 UI“这一轮结束了，可以渲染最终结果、更新 token 统计”。

### 2.4 EventBus 生命周期钩子是“空置”的

`events.ts` 定义了 `EventBus` 与 `AgentEvent`：

```ts
export type AgentEvent =
  | 'agent:state-change'
  | 'turn:before' | 'turn:after'
  | 'phase:prepare' | 'phase:reason:before' | 'phase:reason:after' | ...
  | 'tool:before' | 'tool:after' | 'tool:error'
  ...;
```

但在 `run-agent.ts` 中，创建 `EventBus` 后仅通过 `liveState.attachEvents(events)` 让状态机发送 `agent:state-change`，**没有显式触发 `turn:before`/`turn:after` 或 `phase:*` 事件**。`ReactLoop` 和 `executeTools` 也没有调用这些钩子。结果是：这些设计良好的插件生命周期事件长期处于“有定义、无发射”状态，无法被插件或调试工具利用。

### 2.5 `activity-change` 是启发式推断，不是权威事件

`AgentState.applyChunk` 根据 chunk 类型推断 `activity`：

```ts
if (chunk.type === 'reasoning-start' || chunk.type === 'reasoning-delta') {
  this.activity = 'thinking';
} else if (chunk.type === 'tool-call-start' || chunk.type === 'tool-call') {
  this.activity = 'calling-function';
}
...
```

activity 语义与底层 chunk 强耦合，且无法表达“正在执行某条 tool call”或“当前是哪一轮 turn”这种高层语义。

### 2.6 事件发布不可等待

`BroadcastBus` 是 fire-and-forget 模式，listener 抛错会被吞掉。PI 的 `agent_end` 是一个 settlement barrier：所有监听者 settle 后，run 才算结束。REM 当前缺少这种“等待型”事件语义，某些需要在运行结束后 flush 状态或上报指标的场景不好做。

---

## 3. PI 事件流可借鉴点

### 3.1 事件层级：agent → turn → message → tool execution

PI 把事件天然分成四个层次，每个层次都有清晰的 start/end 对：

```
agent_start
├─ turn_start
│  ├─ message_start (user)
│  ├─ message_end   (user)
│  ├─ message_start (assistant)
│  ├─ message_update (assistant 流式增量)
│  ├─ message_end   (assistant)
│  ├─ tool_execution_start
│  ├─ tool_execution_update （可选）
│  ├─ tool_execution_end
│  ├─ message_start (toolResult)
│  └─ message_end   (toolResult)
│  └─ turn_end
├─ turn_start ...
agent_end
```

这种分层让 UI 可以：

- 在 `message_start` 时创建一条消息骨架。
- 在 `message_update` 时追加增量。
- 在 `message_end` 时把消息标记为完成。
- 在 `tool_execution_start/end` 时渲染工具调用进度。
- 在 `turn_end` 时归档本轮并更新 token 统计。
- 在 `agent_end` 时执行最终 flush。

### 3.2 `message_update` 仅用于 assistant，且携带完整 message 快照

PI 的 `message_update` 只针对 assistant 流式消息，结构为：

```ts
| { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
```

UI 既可以选择直接消费 `assistantMessageEvent` 里的 delta，也可以拿 `message` 作为完整快照做渲染。这比 REM 当前的 `text-delta`/`reasoning-delta`/`tool-call` 更统一。

### 3.3 工具执行独立生命周期

PI 把 tool execution 与 message 完全解耦：

```ts
| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
| { type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
| { type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean }
```

- 在 `tool_execution_start` 时即可显示“工具执行中”。
- 长时工具可以流式 `tool_execution_update`。
- `tool_execution_end` 在工具完成时触发，与是否已组装成 toolResult message 无关。
- 并行执行时，`tool_execution_end` 按完成顺序触发，但 toolResult message 仍按 assistant 消息中的源顺序发出。

### 3.4 `turn_end` 携带本轮完整上下文

```ts
| { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
```

`turn_end` 明确包含本轮 assistant 消息和全部 tool result 消息。这对应 REM 中 `turn:after` 的意图，但数据更完整、语义更明确。

### 3.5 `agent_end` 作为 settlement barrier

PI 的 `subscribe` 监听者是按注册顺序 `await` 执行的，`agent_end` 监听者 settle 后，`waitForIdle()` 才会返回。REM 的 `BroadcastBus` 是 fire-and-forget，若希望实现类似屏障，需要：

- 在核心层保留 `EventBus` 作为“可等待”的同步钩子；
- 在广播层保留 `BroadcastBus` 作为跨连接/跨进程事件总线；
- 或新增 `awaitable` 的 listener API。

### 3.6 工具执行模式影响事件顺序

PI 支持 `parallel`（默认）与 `sequential` 工具执行。并行模式下 `tool_execution_end` 按实际完成顺序触发，但持久化到 transcript 的 `toolResult` message 仍按 assistant 源顺序。这提醒 REM 在设计 tool-execution 事件时也要区分“执行完成顺序”和“transcript 顺序”。

---

## 4. 推荐的新事件体系

### 4.1 命名约定

为避免与现有 `agent:state-change`、`session-start` 等事件冲突，新生命周期事件统一使用 `lifecycle:` 前缀：

| PI 事件 | REM 推荐事件名 |
|---|---|
| `agent_start` | `lifecycle:agent:start` |
| `agent_end` | `lifecycle:agent:end` |
| `turn_start` | `lifecycle:turn:start` |
| `turn_end` | `lifecycle:turn:end` |
| `message_start` | `lifecycle:message:start` |
| `message_update` | `lifecycle:message:update` |
| `message_end` | `lifecycle:message:end` |
| `tool_execution_start` | `lifecycle:tool-execution:start` |
| `tool_execution_update` | `lifecycle:tool-execution:update` |
| `tool_execution_end` | `lifecycle:tool-execution:end` |

### 4.2 类型定义（建议）

#### 4.2.1 `BusEvent` 扩展（`packages/core/src/bus-events.ts`）

```ts
export type MessageContentDelta =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown };

export type LifecycleBusEvent =
  | { workspace: string; sessionId: string; type: 'lifecycle:agent:start'; runId?: string }
  | { workspace: string; sessionId: string; type: 'lifecycle:agent:end'; reason: 'complete' | 'error' | 'abort'; messages?: import('./types.js').ModelMessage[] }
  | { workspace: string; sessionId: string; type: 'lifecycle:turn:start'; turn: number }
  | { workspace: string; sessionId: string; type: 'lifecycle:turn:end'; turn: number; assistantMessageId: string; toolCallIds: string[] }
  | { workspace: string; sessionId: string; type: 'lifecycle:message:start'; messageId: string; role: 'user' | 'assistant' | 'tool' }
  | { workspace: string; sessionId: string; type: 'lifecycle:message:update'; messageId: string; role: 'assistant'; delta: MessageContentDelta }
  | { workspace: string; sessionId: string; type: 'lifecycle:message:end'; messageId: string; role: 'user' | 'assistant' | 'tool'; content: import('./types.js').ContentPart[] }
  | { workspace: string; sessionId: string; type: 'lifecycle:tool-execution:start'; toolCallId: string; toolName: string; args: unknown }
  | { workspace: string; sessionId: string; type: 'lifecycle:tool-execution:update'; toolCallId: string; partialResult: unknown }
  | { workspace: string; sessionId: string; type: 'lifecycle:tool-execution:end'; toolCallId: string; result: unknown; isError: boolean };

export type BusEvent =
  | ExistingBusEvent
  | LifecycleBusEvent;
```

> `ExistingBusEvent` 表示当前 `BusEvent` 的所有已有分支。

#### 4.2.2 `EventBus` 扩展（`packages/core/src/events.ts`）

把 `AgentEvent` 扩展为支持新的生命周期字符串：

```ts
export type AgentEvent =
  | 'agent:state-change'
  | 'lifecycle:agent:start' | 'lifecycle:agent:end'
  | 'lifecycle:turn:start' | 'lifecycle:turn:end'
  | 'lifecycle:message:start' | 'lifecycle:message:update' | 'lifecycle:message:end'
  | 'lifecycle:tool-execution:start' | 'lifecycle:tool-execution:update' | 'lifecycle:tool-execution:end'
  // 保留旧事件，作为兼容或别名
  | 'turn:before' | 'turn:after'
  | 'phase:prepare' | 'phase:reason:before' | 'phase:reason:after' | 'phase:reason:error'
  | 'phase:execute:before' | 'phase:execute:after'
  | 'phase:observe' | 'phase:reflect'
  | 'tool:before' | 'tool:after' | 'tool:error'
  | ...;
```

`EventContext` 也可以增加强类型字段，但为保持兼容，建议新增 `LifecycleEventContext` 并在 `emit` 时根据事件类型传入。

### 4.3 推荐事件序列

#### 4.3.1 一次简单 prompt（无工具）

```
runAgent
├─ lifecycle:agent:start
├─ session-start          (保留，已有)
├─ activity-change pending (保留，已有)
├─ lifecycle:turn:start   { turn: 1 }
│  ├─ lifecycle:message:start { role: user, messageId: ... }
│  │  ├─ chunk message-start (保留)
│  │  └─ lifecycle:message:end { role: user }
│  ├─ lifecycle:message:start { role: assistant, messageId: ... }
│  │  ├─ chunk message-start (保留)
│  │  ├─ chunk text-start / text-delta / text-finish (保留)
│  │  ├─ lifecycle:message:update { delta: { type: 'text', text: '...' } }
│  │  └─ lifecycle:message:end { role: assistant, content: [...] }
│  └─ lifecycle:turn:end { turn: 1, assistantMessageId: ..., toolCallIds: [] }
├─ usage-change             (保留，已有)
├─ lifecycle:agent:end { reason: 'complete' }
└─ session-end              (保留，已有)
```

#### 4.3.2 一次带工具调用的 prompt

```
runAgent
├─ lifecycle:agent:start
├─ lifecycle:turn:start { turn: 1 }
│  ├─ lifecycle:message:start { role: user }
│  │  └─ lifecycle:message:end { role: user }
│  ├─ lifecycle:message:start { role: assistant }
│  │  ├─ lifecycle:message:update { delta: { type: 'tool-call', ... } }
│  │  └─ lifecycle:message:end { role: assistant }
│  ├─ lifecycle:tool-execution:start { toolCallId, toolName, args }
│  │  ├─ lifecycle:tool-execution:update { partialResult }  (可选)
│  │  └─ lifecycle:tool-execution:end { result, isError }
│  ├─ lifecycle:message:start { role: tool, messageId: ... }
│  │  └─ lifecycle:message:end { role: tool }
│  └─ lifecycle:turn:end { turn: 1, assistantMessageId, toolCallIds: [...] }
├─ lifecycle:turn:start { turn: 2 }            (下一条 LLM 响应)
│  ├─ lifecycle:message:start { role: assistant }
│  │  ├─ lifecycle:message:update { delta: { type: 'text', ... } }
│  │  └─ lifecycle:message:end { role: assistant }
│  └─ lifecycle:turn:end { turn: 2, ... }
├─ lifecycle:agent:end { reason: 'complete' }
└─ session-end
```

### 4.4 与现有底层事件的关系

| PI / 新事件 | 对应 REM 现有事件 | 说明 |
|---|---|---|
| `lifecycle:agent:start` | `agent:state-change`（running）、`session-start` | agent 开始运行，语义与 `agent_start` 对齐 |
| `lifecycle:agent:end` | `agent:state-change`（idle/error）、`session-end` / `session-error` | 运行结束，与 `agent_end` 对齐 |
| `lifecycle:turn:start` | `turn:before`（定义但未实际发射） | 一次 turn 开始 |
| `lifecycle:turn:end` | `turn:after`（定义但未实际发射） | 一次 turn 结束，包含 assistant 消息和 toolResults |
| `lifecycle:message:start` | `message-start` chunk | 某条消息开始 |
| `lifecycle:message:update` | `text-delta` / `reasoning-delta` / `tool-call` chunk | assistant 消息增量 |
| `lifecycle:message:end` | `text-finish` / `reasoning-finish` / `tool-call-finish` chunk 组合 | 某条消息完整结束 |
| `lifecycle:tool-execution:start` | `tool:before`（定义但未实际发射） | 工具开始执行 |
| `lifecycle:tool-execution:end` | `tool:after` / `tool:error`（定义但未实际发射） | 工具执行结束 |
| `chunk` | 无对应 PI 事件 | 保留，用于需要逐字节的渲染场景 |
| `activity-change` | 无对应 PI 事件 | 保留，可由生命周期事件推导或独立触发 |
| `snapshot` | 无对应 PI 事件 | 保留，用于重连恢复 |

建议把 `turn:before`/`turn:after` 和 `phase:*` 作为**兼容别名**继续发射一段时间，之后再决定是否删除。`phase:prepare` 对应 `lifecycle:turn:start` 之前；`phase:reason:before`/`phase:reason:after` 对应 assistant `message:start`/`message:end`；`phase:execute:before`/`phase:execute:after` 对应 `tool-execution:start`/`tool-execution:end`；`phase:observe`/`phase:reflect` 对应 `turn:end` 之后、下一 `turn:start` 之前。

---

## 5. 变更清单

### 5.1 `rem-agent-core` 需要新增/修改的文件

| 文件 | 变更内容 |
|---|---|
| `packages/core/src/bus-events.ts` | 新增 `LifecycleBusEvent` 与 `MessageContentDelta` 类型；扩展 `BusEvent` union。 |
| `packages/core/src/types.ts` | 可选：提取 `MessageContentDelta` 复用类型；确保 `ModelMessage` 导出可用。 |
| `packages/core/src/events.ts` | 扩展 `AgentEvent` union，增加 `lifecycle:*` 事件；`EventContext` 可增加 `lifecycle` 相关字段。 |
| `packages/core/src/agent-state.ts` | 新增 `publishLifecycleEvent` 及便捷方法（`publishLifecycleAgentStart/End`、`publishLifecycleTurnStart/End` 等）；在 `startRun`/`finishRun` 中发射对应事件。 |
| `packages/core/src/state.ts` | 在 `start`/`finish`/`fail` 中发射 `agent:state-change` 的同时可附加 `lifecycle:agent:*` 广播（通过 `AgentState`）。 |
| `packages/core/src/stream/agent-stream.ts` | 新增 `emitLifecycle(event: LifecycleBusEvent)` 或 `onLifecycle(callback)` 钩子，方便 `runAgent` 把流式侧事件转发到 `AgentState`。 |
| `packages/core/src/run-agent.ts` | 在运行开始/结束处发射 `lifecycle:agent:start`/`end`；在 turn 边界发射 `lifecycle:turn:start`/`end`；在 user message 落库时发射 `lifecycle:message:start`/`end`。 |
| `packages/core/src/plugins/loop/react/index.ts` | 在 `run` 中发射 `turn:start/end` 和 assistant `message:start/end`；在 `message:update` 处把流式增量转发出去。 |
| `packages/core/src/reason/reason.ts` | 在流式生成过程中把 `text-delta`/`reasoning-delta`/`tool-call` 映射为 `lifecycle:message:update` 事件。 |
| `packages/core/src/execute/execute-tools.ts` | 在工具执行前后发射 `lifecycle:tool-execution:start`/`end`；若工具支持流式，发射 `tool-execution:update`。 |
| `packages/core/src/sdk/loop-strategy.ts` | 在 `LoopContext` 中增加 `emitLifecycle` 或 `publishLifecycle` 字段。 |
| `packages/core/tests/...` | 新增 `lifecycle-events.test.ts` 或扩展现有事件测试，验证事件顺序、字段、幂等性。 |

### 5.2 `rem-agent-bridge` 是否需要同步调整

- `packages/bridge/src/types.ts`：仅 re-export `BusEvent` 等类型，无需修改即可自动获得新事件类型。
- `packages/bridge/src/broadcast-bus.ts`、`packages/bridge/src/sse.ts`：SSE 编码对 `BusEvent` 是通用 JSON 序列化，新增事件类型直接透传，无需修改。
- `packages/bridge/src/agent.ts`：`AgentState` 已经负责发布生命周期事件，无需在 `AgentService` 中额外处理。
- 结论：**bridge 不需要结构性改动**，除非未来希望把 `event: bus` 拆分为更细的事件名（如 `event: lifecycle:turn:start`），那样才需要改 `response.ts`，但当前不是必要项。

### 5.3 `rem-agent-web` 是否需要同步调整

- `packages/web/src/lib/agent-bus.ts` 与 `packages/web/src/lib/use-agent-bus.ts`：只负责接收 `BusEvent`，无需改动。
- 具体的 UI 组件（聊天消息列表、工具调用卡片、token 统计）可以**逐步**迁移到新的生命周期事件，但旧代码基于 `chunk`/`snapshot` 的组装逻辑继续可用。
- 结论：**web 不需要破坏性改动**，只是消费侧的可选升级。

---

## 6. 迁移步骤：在不破坏现有事件消费者的前提下引入新事件

### 步骤 1：新增类型（零行为变更）

- 在 `bus-events.ts` 定义 `LifecycleBusEvent` 并扩展 `BusEvent`。
- 在 `events.ts` 扩展 `AgentEvent` union。
- 在 `types.ts` 补充 `MessageContentDelta`（若需要）。
- 提交一次 PR，仅类型变更，不触发任何新事件。

### 步骤 2：在 `AgentState` 中增加发布能力

- 新增 `publishLifecycleEvent(workspace, sessionId, event)` 方法。
- 在 `startRun` 中发布 `lifecycle:agent:start`（与 `session-start` 并存）。
- 在 `finishRun` 中根据 `error` 发布 `lifecycle:agent:end`（与 `session-end`/`session-error` 并存）。

### 步骤 3：在 `AgentStreamController` 中增加转发能力

- 新增 `emitLifecycle(event: LifecycleBusEvent)` 或 `onLifecycle` 回调注册。
- 在 `runAgent` 中把 `AgentStreamController` 与 `AgentState` 的发布方法绑定：

  ```ts
  const controller = new AgentStreamController();
  controller.onLifecycle = (event) => agentState.publishLifecycleEvent(workspace, sessionId, event);
  ```

  或者把 `publishLifecycle` 通过 `LoopContext` 传给 `ReactLoop`。

### 步骤 4：在 `runAgent` 和 `ReactLoop` 中发射消息/turn 生命周期事件

- `runAgent`：
  - 开始运行：`lifecycle:agent:start`。
  - user message 落库后：`lifecycle:message:start` + `lifecycle:message:end`。
  - `loopStrategy.run` 返回后：`lifecycle:turn:end` + `lifecycle:agent:end`。
- `ReactLoop.run`：
  - 每次进入循环：`lifecycle:turn:start`。
  - assistant `message-start` 时：`lifecycle:message:start`。
  - 每个流式增量（来自 `reason`）通过 `emitLifecycle` 发送 `lifecycle:message:update`。
  - assistant `message-end` 时：`lifecycle:message:end`。
  - 如果 turn 结束，发射 `lifecycle:turn:end`。

### 步骤 5：在 `executeTools` 中发射工具执行生命周期事件

- 每个 tool call 执行前：`lifecycle:tool-execution:start`。
- 流式工具：`lifecycle:tool-execution:update`。
- 每个 tool call 执行后：`lifecycle:tool-execution:end`。
- 落库为 toolResult message 后：`lifecycle:message:start` + `lifecycle:message:end`（role: tool）。

### 步骤 6：在 `EventBus` 中发射兼容的 `turn:before`/`turn:after` 和 `phase:*` 事件

- 在新事件发射点附近，同步触发旧的事件名，供现有插件或调试代码使用。
- 例如：`lifecycle:turn:start` 时同时 `events.emit('turn:before', ctx)`；`lifecycle:tool-execution:start` 时同时 `events.emit('tool:before', ctx)`。

### 步骤 7：UI 侧逐步迁移

- 保留原有 `chunk`/`snapshot` 消费路径。
- 新增基于 `lifecycle:message:*` 和 `lifecycle:tool-execution:*` 的消息渲染路径。
- 通过 feature flag 或环境变量选择新旧渲染方式，验证稳定后再移除旧路径。

### 步骤 8：测试与文档

- 新增单测覆盖事件顺序：
  - 简单 prompt 的事件序列。
  - 多工具并行执行时 `tool-execution:end` 的完成顺序与 `tool-result` message 顺序。
  - 中断/异常时 `lifecycle:agent:end` 的 `reason`。
- 更新 `packages/core/README.md` 与 `docs/core-design.md` 中事件相关章节。

---

## 7. 与现有 `AgentState`、`AgentStreamController` 的集成方式

### 7.1 `AgentState` 作为生命周期事件的发布中心

`AgentState` 当前已经承担发布 `session-start`、`activity-change`、`usage-change`、`snapshot` 等广播事件的职责。引入生命周期事件后，它应继续作为**单一发布源**：

```ts
export class AgentState {
  // ...
  publishLifecycleEvent(workspace: string, sessionId: string, event: LifecycleBusEvent): void {
    this.bus.publish({ workspace, sessionId, ...event } as BusEvent);
  }

  publishLifecycleAgentStart(workspace: string, sessionId: string, runId?: string): void {
    this.publishLifecycleEvent(workspace, sessionId, { type: 'lifecycle:agent:start', runId });
  }

  publishLifecycleTurnStart(workspace: string, sessionId: string, turn: number): void {
    this.publishLifecycleEvent(workspace, sessionId, { type: 'lifecycle:turn:start', turn });
  }
  // ...
}
```

好处：

- 所有事件都走 `BroadcastBus`，订阅者（bridge、web、tui、测试）统一消费。
- `startRun`/`finishRun` 等状态转换点天然就是发布生命周期事件的位置。
- 避免 `runAgent` 与 `ReactLoop` 重复维护发布逻辑。

### 7.2 `AgentStreamController` 作为流式侧转发器

`AgentStreamController` 位于 `runAgent` 内部，是流式 chunk 的“生产者”。它最适合把**流式增量**转换为 `lifecycle:message:update`：

```ts
export class AgentStreamController {
  // 新增
  onLifecycle?: (event: LifecycleBusEvent) => void;

  emitLifecycle(event: LifecycleBusEvent): void {
    this.onLifecycle?.(event);
  }
}
```

在 `runAgent` 中绑定：

```ts
const controller = new AgentStreamController();
controller.onLifecycle = (event) =>
  params.agentState.publishLifecycleEvent(workspace, params.sessionId, event);
```

`trackMessageStart` 除了转发 provider chunk，还可以根据当前 `messageId` 把 `text-delta`/`reasoning-delta`/`tool-call` 包装为 `lifecycle:message:update`。

### 7.3 `LoopContext` 增加 `emitLifecycle` 钩子

`ReactLoop` 作为插件需要知道当前 `workspace` 和 `sessionId` 才能发布事件。与其在 `LoopContext` 中直接注入 `AgentState`，不如注入一个无状态的 `emitLifecycle` 回调：

```ts
export interface LoopContext {
  // ... 现有字段
  emit: (chunk: ProviderChunk) => void;
  emitLifecycle: (event: LifecycleBusEvent) => void;
}
```

在 `runAgent` 中：

```ts
const loopCtx: LoopContext = {
  // ...
  emit: (chunk) => trackMessageStart(chunk),
  emitLifecycle: (event) =>
    params.agentState.publishLifecycleEvent(workspace, params.sessionId, event),
  // ...
};
```

这样 `ReactLoop` 不依赖 `AgentState` 的具体实现，仍符合 Clean Architecture 的边界要求。

### 7.4 用生命周期事件替代部分 chunk 推断逻辑

当前 `AgentState.applyChunk` 和 `AgentLiveState.applyChunk` 通过 chunk 类型推断 activity 和 pendingToolCalls。引入生命周期事件后，可以逐步让 `AgentLiveState` 订阅这些事件：

- `lifecycle:tool-execution:start` → `pendingToolCalls.add(toolCallId)`。
- `lifecycle:tool-execution:end` → `pendingToolCalls.delete(toolCallId)`。
- `lifecycle:message:update` → 更新 `streamingMessage`。
- `lifecycle:message:end` → 清空 `streamingMessage`。

`AgentState.applyChunk` 仍然负责转发 chunk 和维护 `snapshot`（为了兼容），但新的状态维护可以迁移到生命周期事件上，减少对 chunk 语义的依赖。

### 7.5 保留 `snapshot` 作为重连恢复机制

`lifecycle:message:update` 只发增量，无法直接用于重连。`snapshot` 仍表示“当前正在流式写入消息的完整 parts 列表”，因此：

- 新连接建立时，先 replay `snapshot`。
- 再订阅后续 `lifecycle:message:update` / `chunk` / `lifecycle:message:end`。
- `snapshot` 的生成可以继续基于 chunk，也可以基于生命周期事件，但对外接口不变。

---

## 8. 风险与注意事项

### 8.1 事件重复与消费选择

新旧事件会同时存在。UI 必须决定消费哪一层：

- 如果 UI 既监听 `chunk` 又监听 `lifecycle:message:*`，可能重复渲染。
- 建议：
  - 简单渲染走 `lifecycle:message:*` + `lifecycle:tool-execution:*`。
  - 需要逐字流式效果时，再单独消费 `text-delta` / `reasoning-delta`。
  - 在迁移文档中明确“不要同时用两套事件组装同一条消息”。

### 8.2 工具执行顺序与消息顺序不一致

参考 PI，并行工具执行时 `tool-execution:end` 按完成顺序触发，而 `toolResult` message 需要按 assistant 消息中的源顺序落库。REM 在发射事件时也要注意：

- `lifecycle:tool-execution:end` 可以随到随发，用于显示进度。
- `lifecycle:message:end`（role: tool）必须在 toolResult 消息按正确顺序写入 session 后再发。

### 8.3 BroadcastBus 不是 settlement barrier

PI 的 `agent_end` 监听者是 awaited 的；REM 的 `BroadcastBus` 是 fire-and-forget。如果某些插件或调试器希望“在 agent 结束后执行同步清理”，需要：

- 在 `EventBus` 上保留可等待的 `lifecycle:agent:end` 钩子；或
- 在 `BroadcastBus` 之上提供 `awaitable` 的 listener API。

建议：核心运行逻辑只依赖 `BroadcastBus`；需要等待语义的场景使用 `EventBus` 的同步版本。

### 8.4 类型与跨包传播

`BusEvent` 是 core 定义的 union，bridge 与 web 通过 re-export 使用。新增 `LifecycleBusEvent` 后：

- 现有 `switch (event.type)` 不会被 TypeScript 强制 exhaustive，因此不会破坏编译。
- 但如果代码中有 `if (event.type === 'chunk')` 等 narrow 操作，新增类型不会影响已有分支。
- 需要确保 `BusEvent` 的新分支是可序列化的纯 JSON 对象，以便 SSE 传输。

### 8.5 事件字段命名稳定

`messageId`、`toolCallId`、`turn` 等字段一旦发布，就被 UI 和测试依赖。建议在实现前把这些字段命名写进规范，并在测试中作为稳定契约断言，避免后续随意改名。

### 8.6 与 `EventBus` 旧事件的兼容

`turn:before`/`turn:after` 和 `phase:*` 当前几乎没有被触发。若直接引入新事件而不触发旧事件，不会破坏现有消费者（因为本来就没有）。但为了稳妥，可以在新事件发射点同步发射旧事件名，作为兼容层，后续再评估是否删除。

### 8.7 测试与回滚

- 生命周期事件应该像 SSE 协议一样有单元测试覆盖，避免因为 `emit` 顺序错误导致 UI 渲染异常。
- 如果新事件导致问题，可以设置 `options.lifecycleEvents = false` 在 `runAgent` 中快速关闭，而不影响 chunk 流。

### 8.8 性能

每增加一个事件，都会带来一次 publish 和若干 listener 调用。对于高频 `message:update`（流式文本），必须确保：

- listener 不阻塞主线程（React 状态更新可合并）。
- 事件对象创建开销小（避免深拷贝 message）。
- 在 server 端，publish 到 `BroadcastBus` 后继续流式，不会等待 SSE 客户端。

---

## 9. 总结

PI 的事件流设计把 Agent 运行抽象为 **agent → turn → message → tool execution** 四层生命周期，结构清晰、UI 友好。REM 当前事件体系偏底层，UI 和插件必须从 chunk 中自行拼装高层语义，导致复杂且容易出错。

推荐 REM 以**增量、非破坏**的方式引入 PI 风格的高层生命周期事件：

1. 新增 `lifecycle:*` 命名空间的事件类型，扩展 `BusEvent` 与 `EventBus`。
2. 在 `runAgent`、`ReactLoop`、`executeTools`、`reason` 等关键调用点发射事件。
3. 以 `AgentState` 为单一发布中心，`AgentStreamController` 为流式转发器。
4. 保留现有 `chunk`、`session-start`/`session-end`、`activity-change`、`snapshot` 等事件，旧消费者无需改动。
5. `bridge` 和 `web` 无需结构性改动，UI 可逐步迁移。

实现完成后，REM 的 UI 将能够直接基于 `lifecycle:message:start` / `lifecycle:message:update` / `lifecycle:message:end` 渲染消息，基于 `lifecycle:tool-execution:*` 渲染工具调用进度，基于 `lifecycle:turn:end` 更新轮次和 token 统计，整体可维护性显著提升。
