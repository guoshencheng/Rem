# 合并 SessionService 到 AgentService 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `SessionService` 的会话管理能力合并进 `AgentService`，使 `IAgentService` 成为 Web/TUI 管理会话的唯一入口。

**Architecture:** 扩展 `IAgentService` 接口，新增 `createSession/listSessions/getMessages/updateSession/deleteSession` 方法；`AgentService` 通过 `SessionProvider` 完成持久化；`AgentRemoteService` 通过 HTTP 调用后端路由；Web 路由和 DI 只依赖 `IAgentService`；最终删除 `packages/bridge/src/sessions.ts`。

**Tech Stack:** TypeScript, pnpm workspace, vitest, NodeNext ESM, rem-agent-core, rem-agent-bridge, Next.js App Router, awilix DI

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `packages/bridge/src/agent-service.interface.ts` | 扩展 `IAgentService` 接口，新增 `SessionUpdate` |
| `packages/bridge/src/types.ts` | 新增 `SessionUpdate`，`SessionSummary` 增加 `pinned` |
| `packages/bridge/src/agent.ts` | `AgentService` 新增会话管理方法 |
| `packages/bridge/src/agent-remote-service.ts` | `AgentRemoteService` 新增远程方法 |
| `packages/bridge/src/sessions.ts` | 删除 |
| `packages/bridge/src/index.ts` | 移除 `SessionService` 导出 |
| `packages/bridge/tests/agent-service.test.ts` | 新建：`AgentService` 会话管理测试 |
| `packages/bridge/tests/client.test.ts` | 扩展：`AgentRemoteService` 会话方法测试 |
| `packages/core/src/sdk/session-provider.ts` | `SessionProvider` 增加 `delete()` |
| `packages/core/src/session.ts` | `SessionSummary` 增加 `pinned` |
| `packages/core/src/plugins/session/base.ts` | `BaseSessionProvider` 实现默认 `delete()` |
| `packages/core/src/plugins/session/file/index.ts` | `list()` 读取 `metadata.pinned` |
| `packages/core/src/plugins/session/in-memory/index.ts` | 覆盖 `delete()`，读取 `metadata.pinned` |
| `packages/core/src/plugins/session/local/index.ts` | `updateIndex()` 读取 `metadata.pinned` |
| `packages/core/tests/file-session-provider.test.ts` | 扩展：`delete` 和 `pinned` 测试 |
| `packages/core/tests/session.test.ts` | 扩展：`delete` 和 `pinned` 测试 |
| `packages/web/src/lib/container.ts` | 移除 `sessionService` 注册 |
| `packages/web/src/app/api/sessions/route.ts` | 改调 `agentService` |
| `packages/web/src/app/api/sessions/[id]/route.ts` | 改调 `agentService` |

---

## Task 1: 扩展 Core `SessionProvider` 与 `SessionSummary`

**Files:**
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/sdk/session-provider.ts`
- Modify: `packages/core/src/plugins/session/base.ts`
- Modify: `packages/core/src/plugins/session/in-memory/index.ts`
- Modify: `packages/core/src/plugins/session/file/index.ts`
- Modify: `packages/core/src/plugins/session/local/index.ts`
- Test: `packages/core/tests/session.test.ts`
- Test: `packages/core/tests/file-session-provider.test.ts`

### Step 1.1: 在 `SessionSummary` 增加 `pinned`

Modify `packages/core/src/session.ts`:

```typescript
export interface SessionSummary {
  sessionId: string;
  title?: string;
  pinned?: boolean;
  updatedAt: Date;
  messageCount: number;
}
```

### Step 1.2: 在 `SessionProvider` 增加 `delete()`

Modify `packages/core/src/sdk/session-provider.ts`:

```typescript
export interface SessionProvider {
  create(): Promise<Session>;
  load(sessionId: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  delete(sessionId: string): Promise<void>;
  list(): Promise<SessionSummary[]>;
}
```

### Step 1.3: 在 `BaseSessionProvider` 实现默认 `delete()`

Modify `packages/core/src/plugins/session/base.ts`，在顶部 import 增加 `unlink`：

```typescript
import { mkdir, readFile, writeFile, unlink } from 'fs/promises';
```

在 `write()` 后增加：

```typescript
async delete(sessionId: string): Promise<void> {
  try {
    await unlink(this.sessionPath(sessionId));
  } catch {
    // ignore: file may not exist
  }
}
```

### Step 1.4: 在 `InMemorySessionProvider` 覆盖 `delete()` 并读取 `pinned`

Modify `packages/core/src/plugins/session/in-memory/index.ts`：

在 `list()` 中把 `pinned: session.metadata.pinned as boolean | undefined` 加入 summary；增加 `delete()` 方法：

```typescript
async delete(sessionId: string): Promise<void> {
  this.sessions.delete(sessionId);
}
```

### Step 1.5: 在 `FileSessionProvider.list()` 读取 `metadata.pinned`

Modify `packages/core/src/plugins/session/file/index.ts`，在 `summaries.push({...})` 中增加 `pinned: body.metadata?.pinned as boolean | undefined`。

### Step 1.6: 在 `LocalSessionProvider.updateIndex()` 读取 `metadata.pinned`

Modify `packages/core/src/plugins/session/local/index.ts`：

- 在 `IndexEntry` 接口增加 `pinned?: boolean`。
- 在 `updateIndex()` 的 `entry` 中增加 `pinned: session.metadata.pinned as boolean | undefined`。
- 在 `list()` 的返回对象中增加 `pinned: s.pinned`。

### Step 1.7: 写测试

Modify `packages/core/tests/session.test.ts`，在 InMemory 测试文件末尾增加：

```typescript
it('should delete a session', async () => {
  const provider = new InMemorySessionProvider();
  const session = await provider.create();
  await provider.delete(session.sessionId);
  const loaded = await provider.load(session.sessionId);
  expect(loaded).toBeNull();
});

it('should list pinned metadata', async () => {
  const provider = new InMemorySessionProvider();
  const a = await provider.create();
  a.metadata.title = 'A';
  a.metadata.pinned = true;
  await provider.save(a);

  const b = await provider.create();
  b.metadata.title = 'B';
  await provider.save(b);

  const list = await provider.list();
  const summaryA = list.find((s) => s.sessionId === a.sessionId);
  const summaryB = list.find((s) => s.sessionId === b.sessionId);
  expect(summaryA?.pinned).toBe(true);
  expect(summaryB?.pinned).toBeUndefined();
});
```

Modify `packages/core/tests/file-session-provider.test.ts`，在文件末尾增加：

```typescript
it('should delete a session file', async () => {
  const session = await provider.create();
  await provider.delete(session.sessionId);
  const loaded = await provider.load(session.sessionId);
  expect(loaded).toBeNull();
});

it('should list pinned metadata', async () => {
  const a = await provider.create();
  a.metadata.title = 'Pinned';
  a.metadata.pinned = true;
  await provider.save(a);

  const b = await provider.create();
  b.metadata.title = 'Normal';
  await provider.save(b);

  const list = await provider.list();
  const summaryA = list.find((s) => s.sessionId === a.sessionId);
  const summaryB = list.find((s) => s.sessionId === b.sessionId);
  expect(summaryA?.pinned).toBe(true);
  expect(summaryB?.pinned).toBeUndefined();
});
```

### Step 1.8: 运行 Core 测试

Run:

```bash
pnpm --filter rem-agent-core test
```

Expected: all tests pass.

### Step 1.9: Commit

```bash
git add packages/core/src/session.ts \
  packages/core/src/sdk/session-provider.ts \
  packages/core/src/plugins/session/base.ts \
  packages/core/src/plugins/session/in-memory/index.ts \
  packages/core/src/plugins/session/file/index.ts \
  packages/core/src/plugins/session/local/index.ts \
  packages/core/tests/session.test.ts \
  packages/core/tests/file-session-provider.test.ts
git commit -m "feat(core): add SessionProvider.delete and pinned metadata support"
```

---

## Task 2: 扩展 Bridge `IAgentService` 接口和类型

**Files:**
- Modify: `packages/bridge/src/agent-service.interface.ts`
- Modify: `packages/bridge/src/types.ts`

### Step 2.1: 新增 `SessionUpdate` 并扩展接口

Modify `packages/bridge/src/agent-service.interface.ts`：

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

### Step 2.2: 在 Bridge `types.ts` 增加 `SessionUpdate`

Modify `packages/bridge/src/types.ts`：

```typescript
export interface SessionUpdate {
  title?: string;
  pinned?: boolean;
}

export interface SessionSummary {
  sessionId: string;
  title?: string;
  pinned?: boolean;
  updatedAt: number;
  messageCount: number;
}
```

### Step 2.3: 类型检查

Run:

```bash
pnpm --filter rem-agent-bridge typecheck
```

Expected: 现有代码可能报错（因为 AgentService / AgentRemoteService 还没实现新接口），这是预期的。

### Step 2.4: Commit

```bash
git add packages/bridge/src/agent-service.interface.ts packages/bridge/src/types.ts
git commit -m "feat(bridge): extend IAgentService with session management methods"
```

---

## Task 3: 在 `AgentService` 实现会话管理

**Files:**
- Modify: `packages/bridge/src/agent.ts`
- Test: `packages/bridge/tests/agent-service.test.ts`（新建）

### Step 3.1: 新增辅助方法 `toSummary()`

Modify `packages/bridge/src/agent.ts`，在 `constructor` 后、生命周期方法前增加：

```typescript
private toSummary(session: { sessionId: string; metadata?: Record<string, unknown>; updatedAt: Date; conversation?: unknown[] }): SessionSummary {
  return {
    sessionId: session.sessionId,
    title: (session.metadata?.title as string | undefined) ?? 'New Chat',
    pinned: session.metadata?.pinned as boolean | undefined,
    updatedAt: session.updatedAt.getTime(),
    messageCount: Array.isArray(session.conversation) ? session.conversation.length : 0,
  };
}
```

> 注意：`SessionSummary` 从 Bridge `types.ts` 导入，不是 Core。

### Step 3.2: 修改 `listSessions()`

Modify `packages/bridge/src/agent.ts` 的 `listSessions()`：

```typescript
async listSessions(): Promise<SessionSummary[]> {
  const summaries = await this.sessionProvider.list();
  return summaries
    .map((s) => ({
      sessionId: s.sessionId,
      title: s.title ?? 'New Chat',
      pinned: s.pinned,
      updatedAt: s.updatedAt.getTime(),
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

### Step 3.3: 新增 `createSession()`

在 `AgentService` 中新增：

```typescript
async createSession(): Promise<SessionSummary> {
  const session = await this.sessionProvider.create();
  return this.toSummary(session);
}
```

### Step 3.4: 新增 `updateSession()`

在 `AgentService` 中新增：

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

确保 `ServiceError` 已导入。

### Step 3.5: 新增 `deleteSession()`

在 `AgentService` 中新增：

```typescript
async deleteSession(sessionId: string): Promise<void> {
  runRegistry.abort(sessionId);
  runRegistry.remove(sessionId);
  await this.sessionProvider.delete(sessionId);
}
```

### Step 3.6: 修改 `getMessages()` 的 404 行为

Modify `packages/bridge/src/agent.ts` 的 `getMessages()`：

```typescript
async getMessages(sessionId: string): Promise<UIMessage[]> {
  const session = await this.sessionProvider.load(sessionId);
  if (!session) {
    throw new ServiceError('Session not found', 404);
  }

  return session.conversation
    .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
    .map((msg) => ({
      id: msg.id,
      role: msg.role as 'user' | 'assistant',
      parts: msg.content ?? [],
      status: 'done' as const,
    }));
}
```

### Step 3.7: 导入 `SessionUpdate` 和 Bridge `SessionSummary`

确保 `packages/bridge/src/agent.ts` 的导入包含：

```typescript
import type { SessionUpdate } from './agent-service.interface.js';
import type { SessionSummary, UIMessage } from './types.js';
```

### Step 3.8: 新建 `AgentService` 会话管理测试

Create `packages/bridge/tests/agent-service.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentService } from '../src/agent.js';
import { FileSessionProvider, createProviderManager, createAgentFromEnv } from 'rem-agent-core';
import type { ProviderManager } from 'rem-agent-core';

describe('AgentService session management', () => {
  let dir: string;
  let pm: ProviderManager;
  let service: AgentService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-service-test-'));
    const sessionProvider = new FileSessionProvider(dir);
    pm = await createProviderManager({ sessionProvider });
    service = new AgentService(pm);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates a session', async () => {
    const summary = await service.createSession();
    expect(summary.sessionId).toBeDefined();
    expect(summary.title).toBe('New Chat');
    expect(summary.messageCount).toBe(0);

    const list = await service.listSessions();
    expect(list.some((s) => s.sessionId === summary.sessionId)).toBe(true);
  });

  it('lists sessions with pinned first', async () => {
    const a = await service.createSession();
    const b = await service.createSession();
    await service.updateSession(a.sessionId, { pinned: true, title: 'Pinned' });

    const list = await service.listSessions();
    expect(list[0].sessionId).toBe(a.sessionId);
    expect(list[0].pinned).toBe(true);
    expect(list[0].title).toBe('Pinned');
  });

  it('updates title and pinned', async () => {
    const summary = await service.createSession();
    await service.updateSession(summary.sessionId, { title: 'Renamed', pinned: true });
    const list = await service.listSessions();
    const found = list.find((s) => s.sessionId === summary.sessionId);
    expect(found?.title).toBe('Renamed');
    expect(found?.pinned).toBe(true);
  });

  it('deletes a session', async () => {
    const summary = await service.createSession();
    await service.deleteSession(summary.sessionId);
    const list = await service.listSessions();
    expect(list.some((s) => s.sessionId === summary.sessionId)).toBe(false);
  });

  it('throws 404 when updating non-existent session', async () => {
    await expect(service.updateSession('nonexistent', { title: 'X' })).rejects.toThrow(/Session not found/);
  });
});
```

> 注意：需要确认 `createProviderManager` 是否可直接从 `rem-agent-core` 导入。如果该函数未导出，请改用 `createAgentFromEnv({ sessionProvider })` 并解出 `pm`。

### Step 3.9: 运行 Bridge 测试

Run:

```bash
pnpm --filter rem-agent-bridge test
```

Expected: `agent-service.test.ts` 全部通过。

### Step 3.10: Commit

```bash
git add packages/bridge/src/agent.ts packages/bridge/tests/agent-service.test.ts
git commit -m "feat(bridge): implement session management in AgentService"
```

---

## Task 4: 在 `AgentRemoteService` 实现远程会话方法

**Files:**
- Modify: `packages/bridge/src/agent-remote-service.ts`
- Test: `packages/bridge/tests/client.test.ts`

### Step 4.1: 实现 `createSession/listSessions/getMessages/updateSession/deleteSession`

Modify `packages/bridge/src/agent-remote-service.ts`：

```typescript
import type { SessionUpdate } from './agent-service.interface.js';
```

增加方法实现：

```typescript
async createSession(): Promise<SessionSummary> {
  const response = await fetch(`${this.baseUrl}/api/sessions`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`Failed to create session: ${response.status}`);
  }
  return (await response.json()) as SessionSummary;
}

async listSessions(): Promise<SessionSummary[]> {
  const response = await fetch(`${this.baseUrl}/api/sessions`);
  if (!response.ok) {
    throw new Error(`Failed to list sessions: ${response.status}`);
  }
  return (await response.json()) as SessionSummary[];
}

async getMessages(sessionId: string): Promise<UIMessage[]> {
  const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}`);
  if (!response.ok) {
    throw new Error(`Failed to get messages: ${response.status}`);
  }
  const data = (await response.json()) as { messages?: UIMessage[] };
  return data.messages ?? [];
}

async updateSession(sessionId: string, updates: SessionUpdate): Promise<void> {
  const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!response.ok) {
    throw new Error(`Failed to update session: ${response.status}`);
  }
}

async deleteSession(sessionId: string): Promise<void> {
  const response = await fetch(`${this.baseUrl}/api/sessions/${sessionId}`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error(`Failed to delete session: ${response.status}`);
  }
}
```

### Step 4.2: 在 `client.test.ts` 增加远程会话方法测试

Append to `packages/bridge/tests/client.test.ts`:

```typescript
describe('AgentRemoteService session methods', () => {
  it('creates a session', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sessionId: 's1', title: 'New Chat', updatedAt: 1, messageCount: 0 }),
    });

    const client = new AgentRemoteService('http://localhost:8321');
    const summary = await client.createSession();
    expect(summary.sessionId).toBe('s1');
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8321/api/sessions', { method: 'POST' });
  });

  it('updates a session', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    const client = new AgentRemoteService('http://localhost:8321');
    await client.updateSession('s1', { title: 'T', pinned: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8321/api/sessions/s1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ title: 'T', pinned: true }) }),
    );
  });

  it('deletes a session', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    fetchMock.mockResolvedValueOnce({ ok: true });

    const client = new AgentRemoteService('http://localhost:8321');
    await client.deleteSession('s1');
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8321/api/sessions/s1', { method: 'DELETE' });
  });
});
```

### Step 4.3: 运行 Bridge 测试

Run:

```bash
pnpm --filter rem-agent-bridge test
```

Expected: all tests pass.

### Step 4.4: Commit

```bash
git add packages/bridge/src/agent-remote-service.ts packages/bridge/tests/client.test.ts
git commit -m "feat(bridge): implement remote session management in AgentRemoteService"
```

---

## Task 5: 删除 `SessionService` 并清理 Bridge 导出

**Files:**
- Delete: `packages/bridge/src/sessions.ts`
- Modify: `packages/bridge/src/index.ts`

### Step 5.1: 删除文件

```bash
rm packages/bridge/src/sessions.ts
```

### Step 5.2: 清理 `index.ts`

Modify `packages/bridge/src/index.ts`，移除 `SessionService` 导出，并导出 `SessionUpdate`：

```typescript
export { parseSSEStream, parseAgentStreamEvent } from './sse.js';
export { createSSEResponse, createBusSSEResponse } from './response.js';
export type {
  RunRequest,
  SessionSummary,
  SessionUpdate,
  InterruptRequest,
  ResetRequest,
  ServerStreamEvent,
  UIMessage,
  BusEvent,
} from './types.js';
export type { SSEEvent } from './sse.js';
export type { AgentStreamChunk, ContentPart, ModelMessage } from 'rem-agent-core';

export { reduceStreamChunk } from './stream-reducer.js';

export type { IAgentService } from './agent-service.interface.js';
export type { SessionUpdate } from './agent-service.interface.js';
export { AgentRemoteService } from './agent-remote-service.js';

export { AgentService } from './agent.js';
export type { RunParams, RunResult, InterruptResult, ResetResult } from './agent.js';
export { ServiceError } from './errors.js';
export { BroadcastBus, bus } from './broadcast-bus.js';
export { runRegistry } from './run-registry.js';
```

### Step 5.3: 类型检查

Run:

```bash
pnpm --filter rem-agent-bridge typecheck
```

Expected: pass.

### Step 5.4: Commit

```bash
git add packages/bridge/src/sessions.ts packages/bridge/src/index.ts
git commit -m "refactor(bridge): remove SessionService, export SessionUpdate"
```

---

## Task 6: Web 路由和 DI 迁移到 `IAgentService`

**Files:**
- Modify: `packages/web/src/lib/container.ts`
- Modify: `packages/web/src/app/api/sessions/route.ts`
- Modify: `packages/web/src/app/api/sessions/[id]/route.ts`

### Step 6.1: 简化 DI Container

Modify `packages/web/src/lib/container.ts`：

```typescript
container.register({
  agentService: asFunction(() => new AgentService(pm), {
    lifetime: Lifetime.SINGLETON,
  }),
});
```

移除 `SessionService` import。

### Step 6.2: 迁移 `GET/POST /api/sessions`

Modify `packages/web/src/app/api/sessions/route.ts`：

```typescript
import { NextRequest, NextResponse } from 'next/server';
import type { IAgentService } from 'rem-agent-bridge';
import { getContainer } from '@/lib/container';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get('q') ?? '';
    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');
    let sessions = await agentService.listSessions();
    if (q) {
      const lower = q.toLowerCase();
      sessions = sessions.filter((s) => (s.title ?? '').toLowerCase().includes(lower));
    }
    return NextResponse.json(sessions);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

export async function POST() {
  try {
    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');
    const result = await agentService.createSession();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
```

### Step 6.3: 迁移 `GET/PATCH/DELETE /api/sessions/[id]`

Modify `packages/web/src/app/api/sessions/[id]/route.ts`：

```typescript
import { NextRequest, NextResponse } from 'next/server';
import type { IAgentService } from 'rem-agent-bridge';
import { getContainer } from '@/lib/container';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');
    const messages = await agentService.getMessages(id);
    return NextResponse.json({
      sessionId: id,
      title: 'New Chat',
      messages,
    });
  } catch (err) {
    const status = err instanceof Error && err.message.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, pinned } = body as { title?: string; pinned?: boolean };
    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');
    await agentService.updateSession(id, { title, pinned });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const status = err instanceof Error && err.message.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');
    await agentService.deleteSession(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const status = err instanceof Error && err.message.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status });
  }
}
```

### Step 6.4: 全仓类型检查

Run:

```bash
pnpm typecheck
```

Expected: pass.

### Step 6.5: Commit

```bash
git add packages/web/src/lib/container.ts \
  packages/web/src/app/api/sessions/route.ts \
  packages/web/src/app/api/sessions/[id]/route.ts
git commit -m "refactor(web): route session endpoints through IAgentService, remove SessionService dependency"
```

---

## Task 7: 全仓验证

### Step 7.1: 运行全仓测试

Run:

```bash
pnpm typecheck && pnpm test
```

Expected: all packages pass.

### Step 7.2: 检查残留引用

Run:

```bash
rg "SessionService" packages/
```

Expected: no source/test references remain (only git metadata and docs may mention).

### Step 7.3: 最终提交（如需）

如果 7.1 有额外修复，单独提交；否则当前工作已拆分为多个 commit。

---

## Self-Review

**Spec coverage:**
- `SessionProvider.delete()` ✅ Task 1
- `metadata.pinned` 持久化 ✅ Task 1
- `IAgentService` 扩展 ✅ Task 2
- `AgentService` 实现会话 CRUD ✅ Task 3
- `AgentRemoteService` 实现远程会话方法 ✅ Task 4
- 删除 `SessionService` ✅ Task 5
- Web 路由迁移 ✅ Task 6

**Placeholder scan:** 无 TBD/TODO/"implement later"。

**Type consistency：**
- `SessionUpdate` 同时出现在 `agent-service.interface.ts` 和 `types.ts` 中；计划里两处一致 `{ title?: string; pinned?: boolean }`。
- `AgentService.toSummary()` 返回 Bridge `SessionSummary`，字段与 `types.ts` 一致。
- `listSessions()` 排序逻辑按 `pinned` 优先，其余按 `updatedAt` 降序，与 spec 一致。

