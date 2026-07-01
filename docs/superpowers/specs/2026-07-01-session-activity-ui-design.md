# Session Activity Status UI 设计文档

> 日期：2026-07-01  
> 主题：会话级 Agent 实时状态展示 + Chat 布局与输入框重构

---

## 1. 背景与目标

当前 `rem-agent-web` 的 sidebar 只展示会话标题与 pin 状态，用户无法一眼看出哪些会话正在运行、当前 Agent 处于哪一阶段。上一个迭代中我们移除了 `MessageItem` 中的 `ThinkingBar`，因此需要在更合适的位置（会话列表 + Chat 底部）展示状态。

本设计目标：

1. 在 sidebar 每个会话项展示粗粒度运行状态（running / idle / error）。
2. 在当前 Chat 窗口底部（输入框上方）展示细粒度 Agent 活动状态（thinking / calling-function / outputting / idle）。
3. 调整 Chat 布局：内容区与输入框共用最大宽度容器；用户消息保留气泡且最大宽度 60%；Agent 消息无气泡、宽度拉通。
4. 输入框支持多行，采用上下结构（上方 textarea + 下方工具行），`Shift+Enter` 换行、`Enter` 发送。

---

## 2. 状态模型

### 2.1 Bridge 层类型扩展

在 `rem-agent-bridge` 的 `types.ts` 中扩展：

```ts
export type SessionActivity =
  | 'idle'
  | 'thinking'
  | 'calling-function'
  | 'outputting';

export interface SessionSummary {
  sessionId: string;
  title?: string;
  pinned?: boolean;
  updatedAt: number;
  messageCount: number;
  activity?: SessionActivity;
}
```

`BusEvent` 新增 `activity-change`：

```ts
export type BusEvent =
  | { workspace: string; sessionId: string; type: 'chunk'; chunk: AgentStreamChunk }
  | { workspace: string; sessionId: string; type: 'session-start' }
  | { workspace: string; sessionId: string; type: 'session-end' }
  | { workspace: string; sessionId: string; type: 'session-error'; error: string }
  | { workspace: string; sessionId: string; type: 'activity-change'; activity: SessionActivity };
```

### 2.2 服务端 `SessionActivityTracker`

在 `rem-agent-bridge` 的 `AgentService` 内部维护一个内存状态跟踪器：

```ts
interface ActivityState {
  activity: SessionActivity;
  pendingToolCalls: Set<string>;
  updatedAt: number;
}
```

映射规则（基于现有 `AgentStreamChunk` 推导）：

| 事件 / Chunk | 状态变更 |
|---|---|
| `session-start` | 若当前无状态，设为 `thinking` |
| `reasoning-*` | `thinking` |
| `tool-call-start` / `tool-call` | `calling-function`，并将 `toolCallId` 加入 `pendingToolCalls` |
| `tool-result*` | 移除对应 `toolCallId`；若 `pendingToolCalls` 为空，保持 `calling-function` 直到下一个 chunk 到来后再根据新 chunk 切换 |
| `text-start` / `text-delta` | `outputting` |
| `finish` / `error` / `session-error` / `session-end` | `idle`，清空 `pendingToolCalls` |

每次状态变化时 publish `activity-change` 事件。

`AgentSessionManager.listSessions()` 从 tracker 读取 activity 并拼入 `SessionSummary`。

> 说明：当前选择方案 B，即不修改 core 的 stream 协议，基于已有 chunk 推导。工具调用期间通过 `pendingToolCalls` 强制保持 `calling-function`，避免状态跳回 `thinking`。

---

## 3. 前端实现

### 3.1 `useAgents` 状态消费

- `SessionSummary` 类型扩展 `activity`。
- `SessionState` 扩展 `activity?: SessionActivity` 与 `pendingToolCalls: Set<string>`，用于本地推导。
- bus 事件处理新增 `activity-change` 分支：更新 `sessionMapRef` 中对应 session 的 `activity`，并同步更新 `sessionList`。
- 对于未加载的 session 收到 `session-start` / `chunk` / `activity-change` 时，调用 `ensureSession(sessionId)` 初始化占位状态（只记录 activity，不拼接流式消息），确保 sidebar 能显示正在运行的状态。

### 3.2 Sidebar 状态展示

`SessionItem` 接收 `activity` 与 `status`，在标题左侧显示状态圆点：

| 状态 | 视觉 |
|---|---|
| `thinking` | 蓝色跳动圆点 |
| `calling-function` | 橙色/黄色圆点 |
| `outputting` | 绿色圆点 |
| `idle` / undefined | 灰色圆点（或不显示） |
| session status `error` | 红色圆点 |

圆点尺寸 6px，带 `animate-pulse`（running 状态）。

### 3.3 Chat 底部状态条

在 `ChatPanel` 的 header 或输入框上方新增 `ActivityBar` 组件：

- 当当前会话 `activity !== 'idle'` 时显示。
- 文案：
  - `thinking` → "Thinking..."
  - `calling-function` → "Calling function..."
  - `outputting` → "Outputting..."
- 左侧配对应颜色图标（Loader / Wrench / PenLine）。
- 如果 `status === 'error'`，显示红色错误提示，覆盖 activity。

### 3.4 Chat 布局重构

#### 消息区域

- 整个消息列表与输入框外层包一个 `max-w-3xl`（或 `max-w-[720px]`）容器，水平居中。
- 用户消息：
  - 右对齐
  - 气泡背景 `bg-ac text-ac-ink`
  - 最大宽度 60%
  - 圆角保留 `rounded-card rounded-br-sm`
- Agent 消息：
  - 左对齐
  - 无背景、无边框
  - 宽度拉通（100% 容器宽度）
  - 文字颜色 `text-tx`

#### 输入框

- 改为上下结构：
  - 上方：多行 textarea，占满宽度，最小高度 28px，最大高度 160px，自动增高
  - 下方：flex 工具行，`justify-between`，左侧 + 按钮，右侧向上箭头发送按钮
- 外层深色圆角卡片容器
- `Shift+Enter` 换行，`Enter` 发送
- 发送按钮在输入为空时置灰禁用

---

## 4. 数据流

```
User sends message
        │
        ▼
useAgents.send() ──► AgentService.run()
                            │
                            ▼
                    bus.publish(session-start)
                            │
                            ▼
                    core.runAgent() stream
                            │
                            ▼
                    AgentService wrapped stream
                            │
                            ▼
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        chunk events   activity-change   session-end/error
              │             │             │
              ▼             ▼             ▼
        useAgents bus listener
              │
              ▼
        update sessionMapRef + sessionList
              │
              ▼
        SessionItem + ActivityBar re-render
```

---

## 5. 错误处理

- 服务端 tracker 与 bus publish 失败不应影响主 stream，try/catch 包裹。
- 前端 `activity-change` 处理失败不应中断其他事件处理。
- session status `error` 优先级高于 `activity`：只要 `status === 'error'`，sidebar 与 chat 都显示错误状态。

---

## 6. 测试策略

- `AgentService`：新增 tracker 单元测试，验证各 chunk 到 activity 的映射。
- `useAgents`：测试 bus 事件 `activity-change` 能正确更新 `sessionList` 与 `currentSession`。
- 组件：
  - `SessionItem`：不同 activity/status 下圆点颜色/动画正确。
  - `ActivityBar`：各 activity 文案与图标正确；error 状态覆盖 activity。
  - `InputBox`：`Shift+Enter` 换行、`Enter` 发送、空输入禁用发送。

---

## 7. 非目标 / 不纳入本次

- 不添加底部模型选择 / Build 模式工具栏。
- 不修改 core 的 `AgentStreamChunk` 协议（方案 B）。
- 不做 activity 持久化；刷新页面后状态从 `listSessions` 重新加载，瞬时 running 状态可能显示为 idle，直到新事件到达。

---

## 8. 文件变更清单

| 包 | 文件 | 变更 |
|---|---|---|
| bridge | `src/types.ts` | 扩展 `SessionActivity`、`SessionSummary`、`BusEvent` |
| bridge | `src/agent.ts` | 新增 `SessionActivityTracker` 并集成到 run 生命周期 |
| bridge | `src/agent-session.ts` | `listSessions` 读取 tracker activity |
| bridge | `src/index.ts` / `src/client.ts` | 导出新增类型 |
| web | `src/lib/use-agents.ts` | 消费 `activity-change`，维护本地 pendingToolCalls，未加载 session 占位 |
| web | `src/components/sidebar/session-item.tsx` | 显示 activity 圆点 |
| web | `src/components/chat/chat-panel.tsx` | 展示 `ActivityBar` |
| web | `src/components/chat/message-item.tsx` | 用户气泡 60%，Agent 无气泡拉通 |
| web | `src/components/chat/input-box.tsx` | 改为上下结构多行 textarea |
| web | `src/components/chat/activity-bar.tsx` | 新增组件（可选单独文件） |
