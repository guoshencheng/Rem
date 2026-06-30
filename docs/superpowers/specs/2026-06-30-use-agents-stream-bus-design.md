# useAgents 流式总线设计

## 目标

用更模块化的 `useAgents()` hook 替代当前 `session-store.ts` + `useSSE` 的复杂状态管理，实现类似 Vercel AI `useChat` 的开发体验。支持多 session 同时运行（切换后老 session 在后台继续流式），前端仅需根据 `currentSession` 做渲染和调用 `send`/`interrupt`。

## 核心约束

- 纯前端状态管理，接收 `IAgentService` 注入
- 使用 SSE 事件总线模式：前端一条长连接，事件全量推送（带 `workspace` + `sessionId`），前端按需处理
- 所有 session 的消息在内存 map 中维护，切换 session 不会丢失数据
- 触发 agent 运行仍通过 POST 端点（`POST /api/agent/run`），结果由 SSE 总线推送回前端
- `useAgents` 放在 `packages/web/src/lib/`
- 桥接层仅新增 `BroadcastBus`（`packages/bridge/src/broadcast-bus.ts`），不改动其他现有文件

## 架构总览

```
┌─ 服务端 ─────────────────────────────────────────────────┐
│                                                           │
│  POST /api/agent/run ← AgentService.run() ──→ BroadcastBus│
│  GET  /api/agent/stream ←──── BroadcastBus ──→ SSE 流    │
│                                                           │
└──────────────────────┬────────────────────────────────────┘
                       │ 单条 SSE 连接（带 workspace + sessionId 的全量事件）
┌─ 前端 ───────────────┴────────────────────────────────────┐
│                                                           │
│  useAgentBus(agentService)                                │
│    ├─ SSE 连接管理 + 重连                                  │
│    ├─ onEvent(listener) 全量分发                           │
│    ├─ send(sessionId, content) → POST /run                │
│    └─ interrupt(sessionId) → POST /interrupt              │
│                                                           │
│  useAgents(agentService)                                  │
│    ├─ Map<sessionId, SessionState> 全局内存维护            │
│    ├─ currentSession: { id, messages, status, error }     │
│    ├─ sessions: SessionSummary[]                          │
│    ├─ switchSession / createSession / deleteSession        │
│    └─ send / interrupt（基于 currentSessionId）            │
│                                                           │
│  ChatPanel (props-driven, 无状态)                          │
│    ├─ messages / status / error                           │
│    ├─ onSend / onInterrupt                                │
│    └─ 切换时卸载重建，数据不丢                               │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

---

## 1. 服务端 BroadcastBus

**文件：** `packages/bridge/src/broadcast-bus.ts`

事件管道，不存储，不持久化，只负责将活跃 session 的 chunk 广播给所有 SSE 订阅方。

### 事件类型

```typescript
type BusEvent =
  | { workspace: string; sessionId: string; type: 'chunk'; chunk: AgentStreamChunk }
  | { workspace: string; sessionId: string; type: 'session-start' }
  | { workspace: string; sessionId: string; type: 'session-end' }
  | { workspace: string; sessionId: string; type: 'session-error'; error: string };
```

### BroadcastBus 类

```typescript
class BroadcastBus {
  private subscribers = new Set<(event: BusEvent) => void>();

  publish(event: BusEvent): void {
    // 同步遍历所有 subscriber 推送
  }

  subscribe(fn: (event: BusEvent) => void): () => void {
    // 注册回调，返回 unsubscribe 函数
  }
}
```

全局单例：`export const bus = new BroadcastBus();`

### AgentService 集成

`AgentService.run()` 内部修改——每个 delta 先持久化，再广播：

1. `run` 开始时：`bus.publish({ workspace, sessionId, type: 'session-start' })`

2. 每个 delta 产出时（如 `text-delta`、`reasoning-delta`、`tool-call` 等）：
   - 解析 delta，通过 `reduceStreamChunk` 累加到消息的 `ContentPart[]`
   - 将累加后的消息**实时写入** session 存储（调用 `SessionProvider.save()`）
   - 然后广播：`bus.publish({ workspace, sessionId, type: 'chunk', chunk })`
   
   **动机**：确保 Node 端 session 存储始终是最新的消息状态，即使 SSE 连接断开或客户端异常，服务端数据也不丢失。客户端重连后可随时通过 `getMessages` 恢复完整状态。

3. 正常结束时：`bus.publish({ workspace, sessionId, type: 'session-end' })`

4. 异常时：`bus.publish({ workspace, sessionId, type: 'session-error', error })`

### SSE 端点集成

`GET /api/agent/stream` 端点在 `packages/web/src/app/api/agent/stream/route.ts`（或内联在现有 `route.ts`）。连接时 `subscribe` 到 `bus`，接收到 `BusEvent` 后序列化为 SSE 格式写入 `ReadableStream`。

```typescript
bus.subscribe((event) => {
  controller.enqueue(`event: agent\ndata: ${JSON.stringify(event)}\n\n`);
});
```

无事件时空连接保持 open（通过 SSE keep-alive comment 如 `:heartbeat\n\n`，每 15 秒一次）。

---

## 2. 前端 useAgentBus – SSE 连接管理

**文件：** `packages/web/src/lib/use-agent-bus.ts`

应用级单例 hook，负责维护与 `/api/agent/stream` 的 SSE 长连接。

### API

```typescript
function useAgentBus(agentService: AgentRemoteService): {
  onEvent(listener: (event: BusEvent) => void): () => void;
  send(sessionId: string, content: string): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
};
```

### 实现要点

| 要点 | 说明 |
|---|---|
| **SSE 连接** | 挂载时 `fetch('/api/agent/stream')`，读取 `ReadableStream`，经 `parseSSEStream` 解析，反序列化为 `BusEvent` |
| **Listener 管理** | `onEvent` 注册回调到内部的 `Set`，返回 `unsubscribe`。事件到达时遍历所有 listener 同步调用 |
| **重连** | 断开后自动重连，指数退避（1s, 2s, 4s, max 15s），重连成功后恢复分发 |
| **send/interrupt** | 内部调用 `AgentRemoteService.run(sessionId, content)` / `AgentRemoteService.interrupt(sessionId)` |
| **全量分发** | 不做 workspace 或 sessionId 过滤——所有事件发给所有 listener，由消费方自己判断 |
| **单例** | 通过 `useRef` + 模块级标记确保整个应用只有一个 SSE 连接 |

### 注意

- `useAgentBus` 不对外导出给用户代码直接使用。仅由 `useAgents` 内部消费
- 无 `status`、`reconnecting` 等总线自身状态——那是每 session 的事

---

## 3. 前端 useAgents – 全局 session 管理

**文件：** `packages/web/src/lib/use-agents.ts`

应用级 hook，维护所有 session 的状态 map，输出当前 session 的渲染数据。

### API

```typescript
function useAgents(agentService: AgentRemoteService, options?: { workspace?: string }): {
  // —— 当前选中的 session ——
  currentSession: {
    id: string;
    messages: UIMessage[];
    status: 'idle' | 'loading' | 'streaming' | 'done' | 'error';
    error: string | null;
  } | null;

  // —— 会话管理 ——
  sessions: SessionSummary[];
  switchSession(sessionId: string): void;
  createSession(): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;

  // —— 操作 ——
  send(content: string): Promise<void>;
  interrupt(): Promise<void>;
};
```

### 内部状态

```typescript
type SessionState = {
  messages: UIMessage[];
  status: 'idle' | 'loading' | 'streaming' | 'done' | 'error';
  error: string | null;
};

// 在 useRef 中维护
const sessionMap = useRef<Map<string, SessionState>>(new Map());
```

### 初始化

1. `agentService.listSessions()` 加载会话列表 → `sessions`
2. `sessionMap` 初始为空。只有当 session 首次收到总线事件或用户切换到该 session 时，才惰性通过 `agentService.getMessages(sessionId)` 拉取历史消息

### 总线事件处理

`useAgentBus.onEvent` 注册回调。workspace 由 `useAgents` 初始化时通过参数传入（如 `useAgents(agentService, { workspace: 'default' })`），用于过滤无关事件。

`ensureSessionExists(sessionId)`：如果 `sessionMap` 中无此 sessionId，懒加载历史消息并初始化 `SessionState`（status='idle', messages 从 `getMessages` 获取，error=null）；若已存在则跳过。

```
onEvent(event):
  if event.workspace !== 当前 workspace → 丢弃
  if event.type === 'session-start':
    ensureSessionExists(event.sessionId)
    set session.status = 'loading'
  if event.type === 'chunk':
    if sessionMap 中无此 sessionId → 丢弃
    reduceStreamChunk(session.messages.last.parts, event.chunk)
    更新 session.status = 'streaming'
  if event.type === 'session-end':
    session.status = 'done'
  if event.type === 'session-error':
    session.status = 'error'
    session.error = event.error
```

### 操作

| 操作 | 行为 |
|---|---|
| `send(content)` | 如果 `currentSession` 不为 null：在 messages 尾部追加 pending assistant message → `bus.send(currentSessionId, content)` |
| `interrupt()` | `bus.interrupt(currentSessionId)` → status 设为 `done` |
| `switchSession(id)` | 更新 `currentSessionId`。如果 `sessionMap` 中还没有该 session 的状态，惰性加载历史 |
| `createSession()` | `agentService` 创建新 session → 追加到 sessions → 切换到新 session |
| `deleteSession(id)` | `agentService` 删除 → 从 sessions 和 sessionMap 中移除。如果删除的是当前 session，`currentSession` 置为 null |

### 当前 session 输出

`currentSession` 始终从 `sessionMap.get(currentSessionId)` 读取。`messages`、`status`、`error` 这三个字段对 React 来说是派生状态——当 map 中对应 session 的数据更新时，触发组件重新渲染。

### React 渲染优化

切换 `currentSessionId` 时，`currentSession.messages` 引用了 map 中另一个 session 的数据。需要确保 React 能感知到数据变更：
- 方案：用一个 `useState` 存储 `currentSessionId`，`currentSession` 通过 `useMemo` 从 map 派生。当 map 中的 session 数据更新（chunk 到达）时，用一个 state 计数器 `version` 强制触发重渲染
- 具体实现待 plan 阶段细化

---

## 4. ChatPanel – 纯渲染组件

**文件：** `packages/web/src/components/chat/chat-panel.tsx`

重构后 ChatPanel 不再管理任何状态、SSE 连接、消息流。完全由 props 驱动。

### Props

```typescript
interface ChatPanelProps {
  messages: UIMessage[];
  status: SessionStatus;
  error: string | null;
  onSend(content: string): void;
  onInterrupt(): void;
}
```

### 组件内子组件不变

- `MessageList` —— 渲染 `messages`
- `MessageItem` —— 单条消息（user/assistant 分支，含 reasoning / tool-call 折叠块）
- `ThinkingBar` —— 当 `status === 'streaming'` 时显示
- `InputBox` —— 调用 `onSend`，显示发送/中断按钮

### 切换行为

切换 session 时，由于 ChatPanel 卸载重建，React 会创建全新的组件实例。旧 session 的消息在 `useAgents` 的 `sessionMap` 中保留，不影响。

---

## 5. 组件关系图

```
App
 ├─ useAgents(agentService)
 │    ├─ useAgentBus(agentService)  ← 内部消费, 建立 SSE 连接
 │    │
 │    ├─ 维护 sessionMap: Map<id, { messages, status, error }>
 │    │
 │    └─ 输出: { currentSession, sessions, switchSession,
 │               createSession, deleteSession, send, interrupt }
 │
 ├─ <SessionSidebar
 │     sessions={sessions}
 │     currentId={currentSession?.id}
 │     onSwitch={switchSession}
 │     onCreate={createSession}
 │     onDelete={deleteSession}
 │   />
 │
 └─ {currentSession &&
      <ChatPanel
        key={currentSession.id}
        messages={currentSession.messages}
        status={currentSession.status}
        error={currentSession.error}
        onSend={send}
        onInterrupt={interrupt}
      />
    }
```

- `key={currentSession.id}` 确保切换时 React 完全卸载旧 ChatPanel，重建新 ChatPanel
- `SessionSidebar` 的交互不变。搜索用客户端过滤（`sessions` 已全量持有）；重命名/置顶等元数据操作由侧栏直接调用 `agentService`（不使用 `useAgents`），操作完成后重新 `listSessions` 刷新列表

---

## 6. 需要删除的旧代码

| 文件 | 原因 |
|---|---|
| `packages/web/src/lib/session-store.ts` | 被 `useAgents` 完全替换 |
| `packages/web/src/lib/use-sse.ts` | SSE 连接由 `useAgentBus` 内部管理 |
| `packages/web/src/lib/types.ts` 中与 store 相关的类型 | 只保留 `BusEvent` 和 session 无关的工具类型 |

---

## 7. 错误处理

| 场景 | 行为 |
|---|---|
| SSE 连接断开 | 自动重连（指数退避），重连后继续接收事件，不丢失任何 chunk |
| `send` 网络错误 | 将当前 assistant message 的 status 设为 `error`，显示错误消息 |
| chunk 解析失败 | 跳过该 chunk，不影响整体流程。在 console warn 记录 |
| `sessionMap` 中不存在 sessionId | 正常情况下由 `ensureSessionExists` 处理；如果仍不存在（竞态），chunk 丢弃 |
| `agentService` 不可用 | `sessions` 列表加载失败时，整个 `useAgents` 进入降级模式（`sessions` 为空数组，`currentSession` 为 null） |

---

## 8. 不做的

- 不做 WebSocket：保持纯 HTTP + SSE，不改动传输协议
- 不做消息持久化：消息由 core 的 `SessionProvider` 负责持久化，前端只反映当前内存状态
- 不做离线支持
- 不做用浏览测 SSE 重放/重传历史 chunk：历史消息通过 `getMessages` REST API 获取
