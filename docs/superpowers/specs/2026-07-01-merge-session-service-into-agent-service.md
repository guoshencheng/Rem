# 合并 SessionService 到 AgentService

## 目标

将 `packages/bridge/src/sessions.ts` 中的会话管理能力合并进 `AgentService`，让 `IAgentService` 成为 Web/TUI 消费会话功能的唯一入口。解决当前 `SessionService` 与 `AgentService` 职责重叠、远程实现（`AgentRemoteService`）缺少会话管理、以及 `pinned` 等元数据无法持久化的问题。

## 当前问题

1. **职责重叠**：`SessionService` 和 `AgentService` 都涉及会话；`GET /api/sessions` 直接调 `agentService.listSessions()`，而 `POST /api/sessions` 走 `sessionService.create()`，入口不统一。
2. **远程实现缺失**：`AgentRemoteService` 没有 `createSession/updateSession/deleteSession`，导致远程模式下无法管理会话。
3. **元数据不持久化**：`SessionService` 的 `title` 覆盖层和 `pinned` 存在内存 `Map` 中，进程重启丢失。
4. **创建会话不落盘**：`SessionService.create()` 只生成 UUID，不调用 `SessionProvider.create()`，首次持久化延迟到第一次 `run()`。

## 设计原则

- `IAgentService` 是会话管理的唯一抽象，本地和远程实现行为一致。
- 元数据（`title`、`pinned`）随会话文件持久化，不保留内存补丁层。
- `SessionProvider` 负责底层存储原语；`AgentService` 负责业务编排（如排序、类型转换、广播事件）。
- 遵循模块分离规范：`AgentService` 文件预计会增长，超过 200 行后需拆分会话管理相关逻辑到独立模块。

## 改动范围

| 文件 | 操作 | 说明 |
|---|---|---|
| `packages/bridge/src/agent-service.interface.ts` | MODIFY | 扩展 `IAgentService`，新增 `createSession/listSessions/getMessages/updateSession/deleteSession` |
| `packages/bridge/src/types.ts` | MODIFY | 新增 `SessionUpdate` 类型；`SessionSummary` 增加 `pinned?: boolean` |
| `packages/bridge/src/agent.ts` | MODIFY | `AgentService` 实现会话管理方法；`listSessions()` 按 pinned 排序 |
| `packages/bridge/src/agent-remote-service.ts` | MODIFY | `AgentRemoteService` 实现新增方法，调用对应 HTTP 端点 |
| `packages/bridge/src/sessions.ts` | DELETE | 移除 `SessionService` 和 `extractTitle` |
| `packages/bridge/src/index.ts` | MODIFY | 移除 `SessionService` 导出 |
| `packages/core/src/sdk/session-provider.ts` | MODIFY | `SessionProvider` 增加 `delete(sessionId: string): Promise<void>` |
| `packages/core/src/plugins/session/base.ts` | MODIFY | `BaseSessionProvider` 实现通用 `delete()` |
| `packages/core/src/plugins/session/file/index.ts` | MODIFY | `list()` 读取 `metadata.pinned` |
| `packages/core/src/plugins/session/in-memory/index.ts` | MODIFY | 覆盖 `delete()`，并支持 `pinned` 读取 |
| `packages/core/src/plugins/session/local/index.ts` | MODIFY | `delete()` 已存在，补充 `pinned` 读取 |
| `packages/core/src/session.ts` | MODIFY | `SessionSummary` 增加 `pinned?: boolean` |
| `packages/web/src/lib/container.ts` | MODIFY | 移除 `sessionService` 注册 |
| `packages/web/src/app/api/sessions/route.ts` | MODIFY | 改调 `agentService.createSession()` 和 `agentService.listSessions()` |
| `packages/web/src/app/api/sessions/[id]/route.ts` | MODIFY | 改调 `agentService.getMessages/updateSession/deleteSession` |

## 接口定义

### `IAgentService`

```typescript
import type { AgentStreamChunk } from 'rem-agent-core';
import type { BusEvent, SessionSummary, UIMessage } from './types.js';

export interface SessionUpdate {
  title?: string;
  pinned?: boolean;
}

export interface IAgentService {
  run(sessionId: string, input: string): Promise<AsyncIterable<AgentStreamChunk>>;
  interrupt(sessionId: string): Promise<void>;
  reset(sessionId: string): Promise<void>;
  createSession(): Promise<SessionSummary>;
  listSessions(): Promise<SessionSummary[]>;
  getMessages(sessionId: string): Promise<UIMessage[]>;
  updateSession(sessionId: string, updates: SessionUpdate): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  stream(): AsyncIterable<BusEvent>;
}
```

### `SessionProvider`（Core）

```typescript
export interface SessionProvider {
  create(): Promise<Session>;
  load(sessionId: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  delete(sessionId: string): Promise<void>;
  list(): Promise<SessionSummary[]>;
}
```

### `SessionSummary`（Bridge 与 Core）

Bridge 层的 `SessionSummary` 已包含 `pinned?: boolean`；Core 层的 `SessionSummary` 同步增加 `pinned?: boolean`。

## 数据流

### 创建会话

```
Web POST /api/sessions
  → container.resolve<IAgentService>('agentService')
  → AgentService.createSession()
  → sessionProvider.create()  // 立即生成并持久化空会话
  → 返回 SessionSummary { sessionId, title, updatedAt, messageCount: 0 }
```

### 列出会话

```
Web GET /api/sessions
  → AgentService.listSessions()
  → sessionProvider.list()
  → 按 pinned 降序、再按 updatedAt 降序排序
  → 返回 SessionSummary[]
```

### 更新元数据

```
Web PATCH /api/sessions/:id
  → AgentService.updateSession(id, { title, pinned })
  → sessionProvider.load(id)
  → 写 session.metadata.title / metadata.pinned
  → sessionProvider.save(session)
```

### 删除会话

```
Web DELETE /api/sessions/:id
  → AgentService.deleteSession(id)
  → sessionProvider.delete(id)  // 物理删除会话文件
  → runRegistry.abort/remove(id)（若正在运行）
```

### 获取消息

```
Web GET /api/sessions/:id
  → AgentService.getMessages(id)  // 已存在，保持不变
```

## AgentService 实现要点

### `createSession()`

```typescript
async createSession(): Promise<SessionSummary> {
  const session = await this.sessionProvider.create();
  return this.toSummary(session);
}
```

### `updateSession()`

```typescript
async updateSession(sessionId: string, updates: SessionUpdate): Promise<void> {
  const session = await this.sessionProvider.load(sessionId);
  if (!session) {
    throw new ServiceError('Session not found', 404);
  }
  if (updates.title !== undefined) {
    session.metadata.title = updates.title;
  }
  if (updates.pinned !== undefined) {
    session.metadata.pinned = updates.pinned;
  }
  await this.sessionProvider.save(session);
}
```

### `deleteSession()`

```typescript
async deleteSession(sessionId: string): Promise<void> {
  runRegistry.abort(sessionId);
  runRegistry.remove(sessionId);
  await this.sessionProvider.delete(sessionId);
}
```

### `listSessions()`

```typescript
async listSessions(): Promise<SessionSummary[]> {
  const summaries = await this.sessionProvider.list();
  return summaries
    .map((s) => ({
      sessionId: s.sessionId,
      title: s.title ?? 'New Chat',
      pinned: s.pinned,
      updatedAt: Date.now(),
      messageCount: s.messageCount,
    }))
    .sort((a, b) => {
      if (a.pinned === b.pinned) {
        return b.updatedAt - a.updatedAt;
      }
      return a.pinned ? -1 : 1;
    });
}
```

> **说明**：`listSessions()` 当前将 `updatedAt` 统一返回 `Date.now()`。后续若 `SessionProvider` 能可靠返回文件更新时间，可改为使用 provider 返回的值。

## AgentRemoteService 实现要点

为保持远程接口与本地一致，新增方法映射到已有 HTTP 路由：

| 方法 | HTTP 调用 |
|---|---|
| `createSession()` | `POST /api/sessions` |
| `listSessions()` | `GET /api/sessions` |
| `getMessages(id)` | `GET /api/sessions/:id` |
| `updateSession(id, updates)` | `PATCH /api/sessions/:id` |
| `deleteSession(id)` | `DELETE /api/sessions/:id` |

`createSession` 返回 `SessionSummary`；`updateSession`/`deleteSession` 在响应非 2xx 时抛错。

## Core 层变更

### `SessionProvider.delete()`

`BaseSessionProvider` 提供默认实现：

```typescript
async delete(sessionId: string): Promise<void> {
  try { await unlink(this.sessionPath(sessionId)); } catch { /* ignore */ }
}
```

- `FileSessionProvider` 继承默认实现。
- `LocalSessionProvider` 已自定义 `delete()`，会同时清理 `_msgCache` 和 `index.json`。
- `InMemorySessionProvider` 覆盖为从内部 Map 删除。

### `metadata.pinned`

不新增 `Session` 字段，继续使用 `metadata: Record<string, unknown>`。`FileSessionProvider.list()`、`LocalSessionProvider.updateIndex()`、`InMemorySessionProvider.list()` 读取 `metadata.pinned` 并写入 `SessionSummary.pinned`。`metadata.title` 已在使用，无需额外改动。

## Web 层变更

### `container.ts`

只保留 `agentService`：

```typescript
container.register({
  agentService: asFunction(() => new AgentService(pm), {
    lifetime: Lifetime.SINGLETON,
  }),
});
```

### 路由

- `GET /api/sessions`：调用 `agentService.listSessions()`，保持搜索过滤逻辑。
- `POST /api/sessions`：调用 `agentService.createSession()`。
- `GET /api/sessions/:id`：调用 `agentService.getMessages(id)`。
- `PATCH /api/sessions/:id`：调用 `agentService.updateSession(id, { title, pinned })`。
- `DELETE /api/sessions/:id`：调用 `agentService.deleteSession(id)`。

## 删除 `SessionService` 的影响

- `packages/bridge/src/sessions.ts` 整体删除。
- `extractTitle` 不再保留：标题生成已下沉到 Core 的 `TitleProvider`，运行时通过 `AgentStreamChunk` 的 `session-title` 事件写回 `metadata.title`。
- 若某些调用方仍通过 `SessionService.create()` 的同步返回值创建会话，需要改为 `await agentService.createSession()`。

## 错误处理

- `updateSession/getMessages/deleteSession` 遇到不存在的会话时抛 `ServiceError(404)`。
- `deleteSession` 先中断并清理 `runRegistry`，再删除文件；避免运行时残留。
- `SessionProvider.delete()` 幂等：文件或会话不存在时不抛错。

## 测试要点

1. `AgentService.createSession()` 调用后 `sessionProvider.list()` 能列出该会话。
2. `AgentService.updateSession()` 能修改 `title` 和 `pinned`，并在 `listSessions()` 中体现。
3. `AgentService.deleteSession()` 删除文件后，`getMessages()` 返回空数组。
4. `AgentRemoteService` 的 `createSession/updateSession/deleteSession` 能正确序列化请求并解析响应。
5. Web 路由 `container.resolve<IAgentService>('agentService')` 成功，不再依赖 `SessionService`。

## 不改的

- `AgentService.run()` / `interrupt()` / `reset()` 的核心逻辑不变。
- `BroadcastBus` 事件类型不变。
- `SessionProvider` 的 `create/load/save/list` 语义不变，仅新增 `delete`。
- Core 的 `TitleProvider` 标题生成逻辑不变。
