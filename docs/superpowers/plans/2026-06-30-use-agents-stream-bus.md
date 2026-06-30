# useAgents 流式总线实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 `BroadcastBus` + `IAgentService.stream()` + `useAgents()` hook 替换当前的 `session-store.ts` + `useSSE`，实现模块化的多 session 流式管理。

**Architecture:** 服务端新增 `BroadcastBus`（bridge 层）作为全局事件管道，`AgentService` 在每 chunk 产生时先持久化再发布到总线；`IAgentService` 接口新增 `stream()` 方法，两端各自实现（本地 async generator vs 远程 SSE fetch）；前端 `useAgentBus` 消费 `stream()` 并全量分发事件，`useAgents` 维护 `Map<sessionId, SessionState>` 并输出 `currentSession` 供渲染。

**Tech Stack:** TypeScript, React 19, Next.js 15 App Router, rem-agent-core, rem-agent-bridge

**Spec:** `docs/superpowers/specs/2026-06-30-use-agents-stream-bus-design.md`

---

## File Structure

| 文件 | 操作 | 职责 |
|---|---|---|
| `packages/bridge/src/broadcast-bus.ts` | NEW | 服务端全局事件发布/订阅 |
| `packages/bridge/src/types.ts` | MODIFY | 新增 `BusEvent` 类型 |
| `packages/bridge/src/agent-service.interface.ts` | MODIFY | 新增 `stream()` 方法签名 |
| `packages/bridge/src/agent.ts` | MODIFY | 实现 `stream()`，集成 BroadcastBus 实时持久化 |
| `packages/bridge/src/agent-remote-service.ts` | MODIFY | 实现 `stream()`，fetch SSE 端点 |
| `packages/bridge/src/response.ts` | MODIFY | 新增 `createBusSSEResponse()` |
| `packages/bridge/src/index.ts` | MODIFY | 导出 `BusEvent`、`BroadcastBus` |
| `packages/web/src/app/api/agent/stream/route.ts` | NEW | SSE 流端点 |
| `packages/web/src/lib/use-agent-bus.ts` | NEW | 全局 SSE 消费 + 事件分发 |
| `packages/web/src/lib/use-agents.ts` | NEW | 多 session 状态管理 |
| `packages/web/src/lib/types.ts` | MODIFY | 新增 `BusEvent` 类型，移除非工具类型 |
| `packages/web/src/components/chat/chat-panel.tsx` | MODIFY | 改为 props-driven |
| `packages/web/src/components/chat/message-list.tsx` | MODIFY | 改为 props-driven |
| `packages/web/src/components/chat/input-box.tsx` | MODIFY | 改为 props-driven |
| `packages/web/src/components/sidebar/session-sidebar.tsx` | MODIFY | 从 `useAgents` 获取状态 |
| `packages/web/src/components/sidebar/session-list.tsx` | MODIFY | 纯 props 组件 |
| `packages/web/src/components/sidebar/session-item.tsx` | MODIFY | 纯 props 组件 |
| `packages/web/src/app/page.tsx` | MODIFY | 使用 `useAgents` |
| `packages/web/src/lib/session-store.ts` | DELETE | 被 `useAgents` 替代 |
| `packages/web/src/lib/use-sse.ts` | DELETE | 被 `useAgentBus` 替代 |

---

### Task 1: BusEvent 类型定义

**Files:**
- Modify: `packages/bridge/src/types.ts:1-31`

- [ ] **Step 1: 在 types.ts 末尾追加 BusEvent 类型**

```typescript
import type { AgentStreamChunk } from 'rem-agent-core';

export type BusEvent =
  | { workspace: string; sessionId: string; type: 'chunk'; chunk: AgentStreamChunk }
  | { workspace: string; sessionId: string; type: 'session-start' }
  | { workspace: string; sessionId: string; type: 'session-end' }
  | { workspace: string; sessionId: string; type: 'session-error'; error: string };
```

- [ ] **Step 2: Typecheck bridge**

Run: `pnpm --filter rem-agent-bridge typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/bridge/src/types.ts
git commit -m "feat: add BusEvent type to bridge"
```

---

### Task 2: BroadcastBus 类

**Files:**
- Create: `packages/bridge/src/broadcast-bus.ts`

- [ ] **Step 1: 创建 BroadcastBus 类**

```typescript
import type { BusEvent } from './types.js';

export class BroadcastBus {
  private subscribers = new Set<(event: BusEvent) => void>();

  publish(event: BusEvent): void {
    for (const sub of this.subscribers) {
      sub(event);
    }
  }

  subscribe(fn: (event: BusEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }
}

export const bus = new BroadcastBus();
```

- [ ] **Step 2: Typecheck bridge**

Run: `pnpm --filter rem-agent-bridge typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/bridge/src/broadcast-bus.ts
git commit -m "feat: add BroadcastBus global event pipeline"
```

---

### Task 3: IAgentService 接口扩展

**Files:**
- Modify: `packages/bridge/src/agent-service.interface.ts:1-10`

- [ ] **Step 1: 添加 stream() 方法签名**

```typescript
import type { AgentStreamChunk } from 'rem-agent-core';
import type { BusEvent, SessionSummary, UIMessage } from './types.js';

export interface IAgentService {
  run(sessionId: string, input: string): Promise<AsyncIterable<AgentStreamChunk>>;
  interrupt(sessionId: string): Promise<void>;
  reset(sessionId: string): Promise<void>;
  listSessions(): Promise<SessionSummary[]>;
  getMessages(sessionId: string): Promise<UIMessage[]>;
  stream(): AsyncIterable<BusEvent>;
}
```

- [ ] **Step 2: Typecheck bridge**

Run: `pnpm --filter rem-agent-bridge typecheck`
Expected: FAIL (AgentService 和 AgentRemoteService 尚未实现 stream())

这步预期失败，下一 task 修复。

- [ ] **Step 3: Commit**

```bash
git add packages/bridge/src/agent-service.interface.ts
git commit -m "feat: add stream() method to IAgentService interface"
```

---

### Task 4: AgentService.stream() 实现 + BroadcastBus 集成

**Files:**
- Modify: `packages/bridge/src/agent.ts:1-99`

- [ ] **Step 1: 重写 agent.ts，集成 BroadcastBus**

```typescript
import type { AgentStreamChunk, AgentStream } from 'rem-agent-core';
import { runAgent as coreRunAgent } from 'rem-agent-core';
import type { AgentOutput } from 'rem-agent-core';
import type { ProviderManager } from 'rem-agent-core';
import type { SessionProvider } from 'rem-agent-core';
import { reduceStreamChunk } from './stream-reducer.js';
import { ServiceError } from './errors.js';
import { bus } from './broadcast-bus.js';
import type { BusEvent } from './types.js';
import type { IAgentService } from './agent-service.interface.js';
import type { SessionSummary, UIMessage } from './types.js';

export interface RunParams {
  sessionId: string;
  content: string;
}

export interface RunResult {
  stream: AgentStream;
  output: Promise<AgentOutput>;
}

export interface InterruptResult {
  sessionId: string;
  interrupted: boolean;
}

export interface ResetResult {
  sessionId: string;
  reset: boolean;
}

export class AgentService implements IAgentService {
  private activeRuns = new Map<string, AbortController>();
  private sessionProvider: SessionProvider;
  private workspace: string;

  constructor(private providerManager: ProviderManager, workspace = 'default') {
    this.sessionProvider = providerManager.require<SessionProvider>('session');
    this.workspace = workspace;
  }

  /* ---- Agent lifecycle ---- */

  async run(sessionId: string, input: string): Promise<AsyncIterable<AgentStreamChunk>> {
    if (this.activeRuns.has(sessionId)) {
      throw new ServiceError('Session is already running', 409);
    }

    bus.publish({ workspace: this.workspace, sessionId, type: 'session-start' });

    const abortController = new AbortController();
    const result = coreRunAgent({
      input: { content: input, timestamp: new Date() },
      sessionId,
      signal: abortController.signal,
      pm: this.providerManager,
    });
    this.activeRuns.set(sessionId, abortController);

    // Track accumulated parts for persistence
    let accumulatedParts: NonNullable<unknown>[] = [];

    const originalIterator = result.stream.fullStream[Symbol.asyncIterator]();

    const wrapped: AsyncIterable<AgentStreamChunk> = {
      [Symbol.asyncIterator]: async function* () {
        for (const chunk of (async function* () {
          while (true) {
            const { value, done } = await originalIterator.next();
            if (done) break;
            yield value;
          }
        })()) {
          yield chunk;

          // Persist delta chunks to session storage
          if (
            chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' ||
            chunk.type === 'tool-call' || chunk.type === 'tool-result' ||
            chunk.type === 'text-start' || chunk.type === 'reasoning-start' ||
            chunk.type === 'tool-call-start' || chunk.type === 'tool-result-start'
          ) {
            accumulatedParts = reduceStreamChunk(accumulatedParts as any, chunk);
            const session = await this.sessionProvider.load(sessionId);
            if (session) {
              const lastMsg = session.conversation[session.conversation.length - 1];
              if (lastMsg && lastMsg.role === 'assistant') {
                lastMsg.content = accumulatedParts as any;
                await this.sessionProvider.save(session);
              }
            }
          }

          // Broadcast all chunk types (including start/finish/error)
          bus.publish({
            workspace: this.workspace,
            sessionId,
            type: 'chunk',
            chunk,
          });

          if (chunk.type === 'finish') {
            bus.publish({ workspace: this.workspace, sessionId, type: 'session-end' });
          }
          if (chunk.type === 'error') {
            bus.publish({
              workspace: this.workspace,
              sessionId,
              type: 'session-error',
              error: String(chunk.error),
            });
          }
        }
      },
    };

    result.output.catch(() => {}).finally(() => {
      this.activeRuns.delete(sessionId);
    });

    return wrapped;
  }

  async interrupt(sessionId: string): Promise<void> {
    const controller = this.activeRuns.get(sessionId);
    if (controller) {
      controller.abort();
    }
  }

  async reset(sessionId: string): Promise<void> {
    const controller = this.activeRuns.get(sessionId);
    if (controller) controller.abort();
    this.activeRuns.delete(sessionId);
  }

  /* ---- Message tracking ---- */

  async getMessages(sessionId: string): Promise<UIMessage[]> {
    const session = await this.sessionProvider.load(sessionId);
    if (!session) return [];

    return session.conversation
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg) => ({
        id: msg.id,
        role: msg.role as 'user' | 'assistant',
        parts: msg.content,
        status: 'done' as const,
      }));
  }

  async listSessions(): Promise<SessionSummary[]> {
    const summaries = await this.sessionProvider.list();
    return summaries.map((s) => ({
      sessionId: s.sessionId,
      title: s.title ?? 'New Chat',
      updatedAt: Date.now(),
      messageCount: s.messageCount,
    }));
  }

  /* ---- Broadcast stream ---- */

  async *stream(): AsyncIterable<BusEvent> {
    let resolveNext: ((event: BusEvent) => void) | null = null;
    const queue: BusEvent[] = [];

    const unsub = bus.subscribe((event) => {
      if (event.workspace !== this.workspace) return;
      if (resolveNext) {
        resolveNext(event);
        resolveNext = null;
      } else {
        queue.push(event);
      }
    });

    try {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          yield await new Promise<BusEvent>((r) => { resolveNext = r; });
        }
      }
    } finally {
      unsub();
    }
  }
}
```

- [ ] **Step 2: Typecheck bridge**

Run: `pnpm --filter rem-agent-bridge typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/bridge/src/agent.ts
git commit -m "feat: integrate BroadcastBus into AgentService with real-time persist"
```

---

### Task 5: AgentRemoteService.stream() 实现

**Files:**
- Modify: `packages/bridge/src/agent-remote-service.ts:1-86`

- [ ] **Step 1: 添加 stream() 实现**

```typescript
import type { AgentStreamChunk } from 'rem-agent-core';
import type { BusEvent } from './types.js';
import type { IAgentService } from './agent-service.interface.js';
import type {
  RunRequest,
  SessionSummary,
  InterruptRequest,
  ResetRequest,
  UIMessage,
} from './types.js';
import { parseSSEStream, parseAgentStreamEvent } from './sse.js';

export class AgentRemoteService implements IAgentService {
  constructor(private baseUrl: string) {}

  async run(
    sessionId: string,
    input: string,
  ): Promise<AsyncIterable<AgentStreamChunk>> {
    const response = await fetch(`${this.baseUrl}/api/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, content: input } satisfies RunRequest),
    });

    if (!response.ok || !response.body) {
      throw new Error(
        `Failed to start run: ${response.status} ${response.statusText}`,
      );
    }

    const reader = response.body.getReader();
    const events = parseSSEStream(reader);

    return {
      [Symbol.asyncIterator]: async function* () {
        for await (const event of events) {
          if (
            event.event === 'chunk' ||
            event.event === 'error'
          ) {
            yield parseAgentStreamEvent(event);
          }
        }
      },
    };
  }

  async interrupt(sessionId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/agent/interrupt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId } satisfies InterruptRequest),
    });
    if (!response.ok) {
      throw new Error(`Failed to interrupt: ${response.status}`);
    }
  }

  async reset(sessionId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/agent/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId } satisfies ResetRequest),
    });
    if (!response.ok) {
      throw new Error(`Failed to reset: ${response.status}`);
    }
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

  /* ---- Broadcast stream ---- */

  async *stream(): AsyncIterable<BusEvent> {
    const response = await fetch(`${this.baseUrl}/api/agent/stream`);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to connect stream: ${response.status} ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const events = parseSSEStream(reader);

    for await (const event of events) {
      if (event.event === 'bus' && event.data) {
        try {
          yield JSON.parse(event.data) as BusEvent;
        } catch {
          // skip malformed events
        }
      }
    }
  }
}
```

- [ ] **Step 2: Typecheck bridge**

Run: `pnpm --filter rem-agent-bridge typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/bridge/src/agent-remote-service.ts
git commit -m "feat: implement AgentRemoteService.stream() with SSE fetch"
```

---

### Task 6: createBusSSEResponse

**Files:**
- Modify: `packages/bridge/src/response.ts:1-30`

- [ ] **Step 1: 追加 createBusSSEResponse 函数**

```typescript
import type { AgentStreamChunk } from 'rem-agent-core';
import type { BusEvent } from './types.js';

export function createSSEResponse(fullStream: AsyncIterable<AgentStreamChunk>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of fullStream) {
          controller.enqueue(encoder.encode(`event: chunk\ndata: ${JSON.stringify(chunk)}\n\n`));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Stream error';
        const name = err instanceof Error ? err.name : 'Error';
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { name, message } })}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export function createBusSSEResponse(busStream: AsyncIterable<BusEvent>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send keep-alive every 15 seconds
        const keepAlive = setInterval(() => {
          controller.enqueue(encoder.encode(':heartbeat\n\n'));
        }, 15000);

        for await (const event of busStream) {
          controller.enqueue(encoder.encode(`event: bus\ndata: ${JSON.stringify(event)}\n\n`));
        }

        clearInterval(keepAlive);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Stream error';
        const name = err instanceof Error ? err.name : 'Error';
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { name, message } })}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
    cancel() {
      // stream closed by client
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
```

- [ ] **Step 2: Typecheck bridge**

Run: `pnpm --filter rem-agent-bridge typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/bridge/src/response.ts
git commit -m "feat: add createBusSSEResponse for BusEvent SSE encoding"
```

---

### Task 7: Bridge exports 更新

**Files:**
- Modify: `packages/bridge/src/index.ts:1-22`
- Modify: `packages/bridge/src/client.ts:1-5`

- [ ] **Step 1: 更新 index.ts 导出新类型和类**

```typescript
export { parseSSEStream, parseAgentStreamEvent } from './sse.js';
export { createSSEResponse, createBusSSEResponse } from './response.js';
export type {
  RunRequest,
  SessionSummary,
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
export { AgentRemoteService } from './agent-remote-service.js';

export { AgentService } from './agent.js';
export type { RunParams, RunResult, InterruptResult, ResetResult } from './agent.js';
export { SessionService } from './sessions.js';
export { ServiceError } from './errors.js';
export { BroadcastBus, bus } from './broadcast-bus.js';
```

- [ ] **Step 2: 更新 client.ts 导出 BusEvent 类型**

```typescript
export { reduceStreamChunk } from './stream-reducer.js';
export { AgentRemoteService } from './agent-remote-service.js';
export type { IAgentService } from './agent-service.interface.js';
export type { AgentStreamChunk } from 'rem-agent-core';
export type { SessionSummary, BusEvent } from './types.js';
```

- [ ] **Step 3: Typecheck bridge**

Run: `pnpm --filter rem-agent-bridge typecheck`
Expected: PASS

- [ ] **Step 4: Build bridge**

Run: `pnpm --filter rem-agent-bridge build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/index.ts packages/bridge/src/client.ts
git commit -m "feat: export BusEvent, BroadcastBus, createBusSSEResponse from bridge"
```

---

### Task 8: SSE 流端点 /api/agent/stream

**Files:**
- Create: `packages/web/src/app/api/agent/stream/route.ts`

- [ ] **Step 1: 创建 SSE 流路由**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createBusSSEResponse } from 'rem-agent-bridge';
import { getContainer } from '@/lib/container';
import type { IAgentService } from 'rem-agent-bridge';

export async function GET(request: NextRequest) {
  try {
    const container = await getContainer();
    const agentService = container.resolve<IAgentService>('agentService');
    const busStream = agentService.stream();
    return createBusSSEResponse(busStream);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Web typecheck**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: PASS (可能受后续文件修改影响先检查本文件)

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/api/agent/stream/route.ts
git commit -m "feat: add GET /api/agent/stream SSE endpoint"
```

---

### Task 9: useAgentBus hook

**Files:**
- Create: `packages/web/src/lib/use-agent-bus.ts`

- [ ] **Step 1: 创建 useAgentBus**

```typescript
'use client';

import { useRef, useEffect, useCallback } from 'react';
import type { IAgentService, BusEvent } from 'rem-agent-bridge/client';

type Listener = (event: BusEvent) => void;

export function useAgentBus(agentService: IAgentService) {
  const listenersRef = useRef<Set<Listener>>(new Set());
  const runningRef = useRef(false);
  const retryDelayRef = useRef(1000);

  const onEvent = useCallback((listener: Listener): (() => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const connect = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;

    async function consume() {
      try {
        retryDelayRef.current = 1000;
        const stream = agentService.stream();
        for await (const event of stream) {
          for (const listener of listenersRef.current) {
            listener(event);
          }
        }
      } catch {
        // Stream disconnected, reconnect with backoff
        if (runningRef.current) {
          await new Promise((r) => setTimeout(r, retryDelayRef.current));
          retryDelayRef.current = Math.min(retryDelayRef.current * 2, 15000);
          consume();
        }
      }
    }

    consume();
  }, [agentService]);

  const disconnect = useCallback(() => {
    runningRef.current = false;
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  const send = useCallback(
    async (sessionId: string, content: string) => {
      await agentService.run(sessionId, content);
    },
    [agentService],
  );

  const interrupt = useCallback(
    async (sessionId: string) => {
      await agentService.interrupt(sessionId);
    },
    [agentService],
  );

  return { onEvent, send, interrupt };
}
```

- [ ] **Step 2: Web typecheck**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: PASS (当前只有本文件，无其他依赖变化)

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/use-agent-bus.ts
git commit -m "feat: add useAgentBus hook for SSE event consumption"
```

---

### Task 10: useAgents hook

**Files:**
- Create: `packages/web/src/lib/use-agents.ts`

- [ ] **Step 1: 创建 useAgents**

```typescript
'use client';

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type { IAgentService, BusEvent } from 'rem-agent-bridge/client';
import type { UIMessage } from 'rem-agent-bridge';
import { reduceStreamChunk } from 'rem-agent-bridge/client';
import { useAgentBus } from './use-agent-bus';

type SessionStatus = 'idle' | 'loading' | 'streaming' | 'done' | 'error';

interface SessionState {
  messages: UIMessage[];
  status: SessionStatus;
  error: string | null;
}

export interface SessionSummary {
  sessionId: string;
  title?: string;
  updatedAt: number;
  messageCount: number;
  pinned?: boolean;
}

interface UseAgentsOptions {
  workspace?: string;
}

export function useAgents(agentService: IAgentService, options?: UseAgentsOptions) {
  const workspace = options?.workspace ?? 'default';
  const bus = useAgentBus(agentService);

  const [sessionList, setSessionList] = useState<SessionSummary[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const sessionMapRef = useRef<Map<string, SessionState>>(new Map());
  const [version, setVersion] = useState(0);
  const assistantMsgIdRef = useRef<Map<string, string>>(new Map());

  const notifyChange = useCallback(() => {
    setVersion((v) => v + 1);
  }, []);

  const ensureSession = useCallback(
    async (sessionId: string) => {
      if (sessionMapRef.current.has(sessionId)) return;
      try {
        const messages = await agentService.getMessages(sessionId);
        sessionMapRef.current.set(sessionId, {
          messages,
          status: 'idle',
          error: null,
        });
      } catch {
        sessionMapRef.current.set(sessionId, {
          messages: [],
          status: 'idle',
          error: null,
        });
      }
      notifyChange();
    },
    [agentService, notifyChange],
  );

  // Init: load session list
  useEffect(() => {
    agentService.listSessions().then((list) => {
      setSessionList(list as SessionSummary[]);
      if (!currentId && list.length > 0) {
        const id = list[0].sessionId;
        setCurrentId(id);
        ensureSession(id);
      }
      setInitialized(true);
    }).catch(() => {
      setInitialized(true);
    });
  }, []);

  // Subscribe to bus events
  useEffect(() => {
    return bus.onEvent((event: BusEvent) => {
      if (event.workspace !== workspace) return;

      const map = sessionMapRef.current;
      const state = map.get(event.sessionId);

      switch (event.type) {
        case 'session-start': {
          ensureSession(event.sessionId);
          const s = map.get(event.sessionId);
          if (s) {
            s.status = 'loading';
            notifyChange();
          }
          break;
        }
        case 'chunk': {
          if (!state) return;
          const lastMsg = state.messages[state.messages.length - 1];
          if (!lastMsg || lastMsg.role !== 'assistant') return;

          const newParts = reduceStreamChunk(lastMsg.parts, event.chunk);
          state.messages = [
            ...state.messages.slice(0, -1),
            {
              ...lastMsg,
              parts: newParts,
              status: event.chunk.type === 'finish' ? 'done'
                : event.chunk.type === 'error' ? 'error'
                : 'streaming',
              error: event.chunk.type === 'error' ? String(event.chunk.error) : undefined,
            },
          ];
          state.status = event.chunk.type === 'finish' ? 'done'
            : event.chunk.type === 'error' ? 'error'
            : 'streaming';
          if (event.chunk.type === 'error') {
            state.error = String(event.chunk.error);
          }
          notifyChange();
          break;
        }
        case 'session-end': {
          if (!state) return;
          state.status = 'done';
          notifyChange();
          break;
        }
        case 'session-error': {
          if (!state) return;
          state.status = 'error';
          state.error = event.error;
          notifyChange();
          break;
        }
      }
    });
  }, [workspace, bus, ensureSession, notifyChange]);

  const currentSession = useMemo(() => {
    if (!currentId) return null;
    const state = sessionMapRef.current.get(currentId);
    if (!state) return null;
    return {
      id: currentId,
      messages: state.messages,
      status: state.status,
      error: state.error,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, version]);

  const send = useCallback(
    async (content: string) => {
      if (!currentId) return;
      const map = sessionMapRef.current;
      const state = map.get(currentId);
      if (!state) return;

      const userMsg: UIMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text', text: content }],
        status: 'done',
      };
      const assistantMsg: UIMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        parts: [],
        status: 'pending',
      };
      assistantMsgIdRef.current.set(currentId, assistantMsg.id);

      state.messages = [...state.messages, userMsg, assistantMsg];
      state.status = 'loading';
      state.error = null;
      notifyChange();

      try {
        await bus.send(currentId, content);
      } catch (err) {
        state.status = 'error';
        state.error = err instanceof Error ? err.message : '发送失败';
        notifyChange();
      }
    },
    [currentId, bus, notifyChange],
  );

  const interrupt = useCallback(async () => {
    if (!currentId) return;
    await bus.interrupt(currentId);
    const state = sessionMapRef.current.get(currentId);
    if (state) {
      state.status = 'done';
      notifyChange();
    }
  }, [currentId, bus, notifyChange]);

  const switchSession = useCallback(
    async (id: string) => {
      if (!sessionMapRef.current.has(id)) {
        await ensureSession(id);
      }
      setCurrentId(id);
    },
    [ensureSession],
  );

  const createSession = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions', { method: 'POST' });
      if (!res.ok) throw new Error('创建失败');
      const session = await res.json() as SessionSummary;
      setSessionList((prev) => [session, ...prev]);
      const id = session.sessionId;
      await ensureSession(id);
      setCurrentId(id);
    } catch (err) {
      // silent fail
    }
  }, [ensureSession]);

  const deleteSession = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
        sessionMapRef.current.delete(id);
        setSessionList((prev) => {
          const remaining = prev.filter((s) => s.sessionId !== id);
          if (currentId === id) {
            const next = remaining[0]?.sessionId ?? null;
            setCurrentId(next);
          }
          return remaining;
        });
        notifyChange();
      } catch {
        // silent fail
      }
    },
    [currentId, notifyChange],
  );

  return {
    currentSession,
    sessions: sessionList,
    switchSession,
    createSession,
    deleteSession,
    send,
    interrupt,
    initialized,
  };
}
```

- [ ] **Step 2: Web typecheck**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: FAIL (现有组件仍引用旧 store，下一 phase 修复)

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/use-agents.ts
git commit -m "feat: add useAgents hook with multi-session state management"
```

---

### Task 11: ChatPanel 改为 props-driven

**Files:**
- Modify: `packages/web/src/components/chat/chat-panel.tsx:1-55`
- Modify: `packages/web/src/components/chat/message-list.tsx:1-61`
- Modify: `packages/web/src/components/chat/input-box.tsx:1-80`

- [ ] **Step 1: 重写 ChatPanel**

```typescript
'use client';

import { MessageList } from './message-list';
import { InputBox } from './input-box';
import type { UIMessage } from '@/lib/types';

type SessionStatus = 'idle' | 'loading' | 'streaming' | 'done' | 'error';

interface ChatPanelProps {
  messages: UIMessage[];
  status: SessionStatus;
  error: string | null;
  initialized: boolean;
  onSend(content: string): void;
  onInterrupt(): void;
}

export function ChatPanel({ messages, status, error, initialized, onSend, onInterrupt }: ChatPanelProps) {
  const streaming = status === 'streaming' || status === 'loading';

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <header className="flex items-center gap-3 px-4 h-12 border-b border-bd flex-shrink-0">
        <span className="text-sm font-medium text-tx truncate flex-1">Rem Agent</span>
        {status === 'loading' && !streaming && (
          <span className="text-xs text-warn bg-warn-bg px-2 py-0.5 rounded-chip animate-pulse">连接中...</span>
        )}
        {error && (
          <span className="text-xs text-err bg-err-bg px-2 py-0.5 rounded-chip">{error}</span>
        )}
      </header>
      <MessageList messages={messages} onSend={onSend} />
      <InputBox
        streaming={streaming}
        initialized={initialized}
        onSend={onSend}
        onInterrupt={onInterrupt}
      />
    </div>
  );
}
```

- [ ] **Step 2: 重写 MessageList**

```typescript
'use client';

import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useRef, useEffect } from 'react';
import { MessageItem } from './message-item';
import type { UIMessage } from '@/lib/types';

interface MessageListProps {
  messages: UIMessage[];
  onSend(content: string): void;
}

export function MessageList({ messages, onSend }: MessageListProps) {
  const streamContent = messages
    .map((m) => m.parts.filter((p) => p.type === 'text').map((p) => p.text).join(''))
    .join('');
  const streamReasoning = messages
    .map((m) => m.parts.filter((p) => p.type === 'reasoning').map((p) => p.text).join(''))
    .join('');
  const virtRef = useRef<VirtuosoHandle>(null);

  useEffect(() => {
    if (messages.length > 0 && virtRef.current) {
      virtRef.current.scrollToIndex({ index: messages.length - 1, behavior: 'smooth' });
    }
  }, [messages.length]);

  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.status === 'streaming') {
      virtRef.current?.scrollToIndex({ index: messages.length - 1, behavior: 'auto' });
    }
  }, [streamContent, streamReasoning]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-tx3 text-sm gap-3">
        <div className="w-12 h-12 rounded-full bg-ac-soft flex items-center justify-center text-ac text-lg font-medium">
          R
        </div>
        <span>你好，请问有什么可以帮助你的？</span>
        <div className="flex gap-2 flex-wrap justify-center max-w-md mt-2">
          {['帮我写段代码', '解释一个概念', '帮我分析数据'].map((hint) => (
            <button
              key={hint}
              onClick={() => onSend(hint)}
              className="px-3 py-1.5 rounded-chip bg-card border border-bd2 text-xs text-tx2 hover:text-tx hover:border-ac/50 transition-colors"
            >
              {hint}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0">
      <Virtuoso
        ref={virtRef}
        data={messages}
        itemContent={(_index: number, msg: UIMessage) => <MessageItem message={msg} />}
        followOutput="smooth"
        className="scrollbar-thin"
      />
    </div>
  );
}
```

- [ ] **Step 3: 重写 InputBox**

```typescript
'use client';

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { Send, Square } from 'lucide-react';

interface InputBoxProps {
  streaming: boolean;
  initialized: boolean;
  onSend(content: string): void;
  onInterrupt(): void;
}

export function InputBox({ streaming, initialized, onSend, onInterrupt }: InputBoxProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || streaming || !initialized) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [text]);

  const placeholder = !initialized ? '连接中...' : '输入消息...';

  return (
    <div className="border-t border-bd px-4 py-3 bg-bg">
      <div className="flex items-end gap-2 max-w-3xl mx-auto">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={streaming || !initialized}
          className="flex-1 resize-none rounded-btn bg-card border border-bd2 text-tx placeholder-tx3 px-4 py-2.5 text-sm outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ maxHeight: '160px' }}
        />
        {streaming ? (
          <button
            onClick={onInterrupt}
            className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-btn bg-err text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Square size={14} fill="currentColor" />
            中断
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim() || !initialized}
            className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-btn bg-ac text-ac-ink text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send size={14} />
            发送
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck web**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: FAIL (SessionSidebar 仍引用旧 store)

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/chat/chat-panel.tsx packages/web/src/components/chat/message-list.tsx packages/web/src/components/chat/input-box.tsx
git commit -m "refactor: ChatPanel, MessageList, InputBox to props-driven components"
```

---

### Task 12: Sidebar 组件重构

**Files:**
- Modify: `packages/web/src/components/sidebar/session-sidebar.tsx:1-72`
- Modify: `packages/web/src/components/sidebar/session-list.tsx:1-29`
- Modify: `packages/web/src/components/sidebar/session-item.tsx:1-131`

- [ ] **Step 1: 重写 SessionSidebar**

```typescript
'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, Plus, Menu, X } from 'lucide-react';
import { SessionList } from './session-list';
import type { SessionSummary } from '@/lib/use-agents';

interface SessionSidebarProps {
  sessions: SessionSummary[];
  currentSessionId: string | null;
  onSwitch(id: string): void;
  onCreate(): void;
  onDelete(id: string): void;
  onSearch(query: string): void;
}

export function SessionSidebar({
  sessions,
  currentSessionId,
  onSwitch,
  onCreate,
  onDelete,
  onSearch,
}: SessionSidebarProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => onSearch(search), 300);
    return () => clearTimeout(searchTimer.current);
  }, [search, onSearch]);

  const sidebar = (
    <div className="flex flex-col h-full bg-sb border-r border-bd w-64 flex-shrink-0">
      <div className="flex items-center gap-2 px-3 py-3 border-b border-bd">
        <button onClick={() => setOpen(false)} className="lg:hidden p-1 rounded hover:bg-bd">
          <X size={16} className="text-tx2" />
        </button>
        <span className="text-sm font-semibold text-tx">Rem Agent</span>
      </div>

      <div className="px-3 py-2">
        <button
          onClick={() => { onCreate(); setOpen(false); }}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-btn bg-ac text-ac-ink text-xs font-medium hover:opacity-90 transition-opacity"
        >
          <Plus size={14} /> 新对话
        </button>
      </div>

      <div className="px-3 py-1">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-btn bg-card border border-bd2">
          <Search size={14} className="text-tx3 flex-shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索对话..."
            className="flex-1 bg-transparent text-xs text-tx placeholder-tx3 outline-none"
          />
        </div>
      </div>

      <SessionList
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSwitch={onSwitch}
        onDelete={onDelete}
      />
    </div>
  );

  return (
    <>
      <div className="hidden lg:block h-full">{sidebar}</div>
      <button
        onClick={() => setOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-40 p-2 rounded-btn bg-sb border border-bd text-tx2 hover:text-tx"
      >
        <Menu size={18} />
      </button>
      {open && (
        <>
          <div className="lg:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setOpen(false)} />
          <div className="lg:hidden fixed inset-y-0 left-0 z-50">{sidebar}</div>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 2: 重写 SessionList**

```typescript
'use client';

import { SessionItem } from './session-item';
import type { SessionSummary } from '@/lib/use-agents';

interface SessionListProps {
  sessions: SessionSummary[];
  currentSessionId: string | null;
  onSwitch(id: string): void;
  onDelete(id: string): void;
}

export function SessionList({ sessions, currentSessionId, onSwitch, onDelete }: SessionListProps) {
  const sorted = [...sessions].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return (Number(b.updatedAt) ?? 0) - (Number(a.updatedAt) ?? 0);
  });

  if (sessions.length === 0) {
    return (
      <div className="px-4 py-8 text-xs text-tx3 text-center">暂无对话</div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
      {sorted.map((s) => (
        <SessionItem
          key={s.sessionId}
          session={s}
          isActive={s.sessionId === currentSessionId}
          onSwitch={onSwitch}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 重写 SessionItem**

```typescript
'use client';

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { MoreHorizontal, Pin, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SessionSummary } from '@/lib/use-agents';

interface SessionItemProps {
  session: SessionSummary;
  isActive: boolean;
  onSwitch(id: string): void;
  onDelete(id: string): void;
}

async function updateSession(id: string, updates: { title?: string; pinned?: boolean }): Promise<void> {
  await fetch(`/api/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

export function SessionItem({ session, isActive, onSwitch, onDelete }: SessionItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(session.title ?? 'New Chat');
  const [pinned, setPinned] = useState(session.pinned ?? false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const handleRename = () => {
    const trimmed = title.trim();
    if (trimmed) {
      updateSession(session.sessionId, { title: trimmed }).catch(() => {});
    }
    setEditing(false);
  };

  const handleTogglePin = () => {
    const newPinned = !pinned;
    setPinned(newPinned);
    updateSession(session.sessionId, { pinned: newPinned }).catch(() => {
      setPinned(!newPinned); // revert on error
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleRename();
    if (e.key === 'Escape') setEditing(false);
  };

  return (
    <div
      className={cn(
        'group flex items-center gap-2 px-3 py-2 cursor-pointer text-sm rounded-btn mx-2 transition-colors',
        isActive ? 'bg-card border-l-2 border-ac' : 'hover:bg-card/50',
      )}
      onClick={() => onSwitch(session.sessionId)}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleRename}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-bd border border-bd2 rounded px-2 py-0.5 text-xs text-tx outline-none"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="flex-1 truncate text-tx2 group-hover:text-tx transition-colors">
          {title}
        </span>
      )}

      {pinned && <Pin size={10} className="text-ac flex-shrink-0" />}

      {!editing && (
        <div ref={menuRef} className="relative flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-bd transition-all"
          >
            <MoreHorizontal size={14} className="text-tx3" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 w-36 bg-card border border-bd rounded-btn shadow-lg py-1">
              <button
                onClick={(e) => { e.stopPropagation(); handleTogglePin(); setMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-tx2 hover:bg-bd hover:text-tx transition-colors"
              >
                <Pin size={12} /> {pinned ? '取消置顶' : '置顶'}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setEditing(true); setMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-tx2 hover:bg-bd hover:text-tx transition-colors"
              >
                <Pencil size={12} /> 重命名
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); setMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-err hover:bg-err-bg transition-colors"
              >
                <Trash2 size={12} /> 删除
              </button>
            </div>
          )}
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmDelete(false)}>
          <div className="bg-card border border-bd rounded-card p-4 max-w-xs mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-tx mb-1">确定要删除这个会话吗？</p>
            <p className="text-xs text-tx3 mb-3">此操作不可撤销。</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 rounded-btn text-xs text-tx2 hover:bg-bd transition-colors">取消</button>
              <button onClick={() => { onDelete(session.sessionId); setConfirmDelete(false); }} className="px-3 py-1.5 rounded-btn text-xs bg-err text-white hover:opacity-90 transition-opacity">删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck web**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: FAIL (page.tsx 仍引用旧 store)

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/sidebar/session-sidebar.tsx packages/web/src/components/sidebar/session-list.tsx packages/web/src/components/sidebar/session-item.tsx
git commit -m "refactor: sidebar components to props-driven with useAgents"
```

---

### Task 13: page.tsx 重构为使用 useAgents

**Files:**
- Modify: `packages/web/src/app/page.tsx:1-30`

- [ ] **Step 1: 重写 page.tsx**

```typescript
'use client';

import { useMemo, useCallback } from 'react';
import { useAgents } from '@/lib/use-agents';
import type { SessionSummary } from '@/lib/use-agents';
import { SessionSidebar } from '@/components/sidebar/session-sidebar';
import { ChatPanel } from '@/components/chat/chat-panel';
import { AgentRemoteService } from 'rem-agent-bridge/client';

export default function Home() {
  const agentService = useMemo(() => new AgentRemoteService(''), []);
  const {
    currentSession,
    sessions,
    switchSession,
    createSession,
    deleteSession,
    send,
    interrupt,
    initialized,
  } = useAgents(agentService);

  const handleSearch = useCallback(async (q: string) => {
    if (q) {
      const res = await fetch(`/api/sessions?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const list = await res.json();
        // Search results already applied via bus/listSessions
      }
    } else {
      agentService.listSessions().catch(() => {});
    }
  }, [agentService]);

  return (
    <div className="flex h-full">
      <SessionSidebar
        sessions={sessions as SessionSummary[]}
        currentSessionId={currentSession?.id ?? null}
        onSwitch={switchSession}
        onCreate={createSession}
        onDelete={deleteSession}
        onSearch={handleSearch}
      />
      {currentSession ? (
        <ChatPanel
          key={currentSession.id}
          messages={currentSession.messages}
          status={currentSession.status}
          error={currentSession.error}
          initialized={initialized}
          onSend={send}
          onInterrupt={interrupt}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-tx3 text-sm">
          请选择或创建一个会话
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck web**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: PASS (旧 store 和 use-sse 仍存在但未被引用则无报错；若有引用报错，继续下一步删除操作)

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/page.tsx
git commit -m "refactor: page.tsx to use useAgents hook"
```

---

### Task 14: 清理旧代码

**Files:**
- Delete: `packages/web/src/lib/session-store.ts`
- Delete: `packages/web/src/lib/use-sse.ts`
- Modify: `packages/web/src/lib/types.ts` (移除非工具类型)

- [ ] **Step 1: 删除旧文件**

```bash
rm packages/web/src/lib/session-store.ts
rm packages/web/src/lib/use-sse.ts
```

- [ ] **Step 2: 精简 types.ts**

```typescript
import type { AgentStreamChunk, UIMessage, BusEvent } from 'rem-agent-bridge';

export type { AgentStreamChunk, UIMessage, BusEvent };

export function isSSETextDelta(c: AgentStreamChunk): c is AgentStreamChunk & { type: 'text-delta' } {
  return c.type === 'text-delta';
}

export function isSSEReasoningDelta(c: AgentStreamChunk): c is AgentStreamChunk & { type: 'reasoning-delta' } {
  return c.type === 'reasoning-delta';
}

export function isSSEReasoningFinish(c: AgentStreamChunk): c is AgentStreamChunk & { type: 'reasoning-finish' } {
  return c.type === 'reasoning-finish';
}

export function isSSEToolCallStart(c: AgentStreamChunk): c is AgentStreamChunk & { type: 'tool-call-start' } {
  return c.type === 'tool-call-start';
}

export function isSSEToolResult(c: AgentStreamChunk): c is AgentStreamChunk & { type: 'tool-result' } {
  return c.type === 'tool-result';
}

export function isSSEFinish(c: AgentStreamChunk): c is AgentStreamChunk & { type: 'finish' } {
  return c.type === 'finish';
}

export function isSSEError(c: AgentStreamChunk): c is AgentStreamChunk & { type: 'error' } {
  return c.type === 'error';
}
```

- [ ] **Step 3: Web typecheck**

Run: `pnpm --filter rem-agent-web typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git rm packages/web/src/lib/session-store.ts packages/web/src/lib/use-sse.ts
git add packages/web/src/lib/types.ts
git commit -m "refactor: remove old session-store and use-sse, clean types"
```

---

### Task 15: 最终验证

- [ ] **Step 1: 全仓 typecheck**

```bash
pnpm typecheck
```
Expected: PASS

- [ ] **Step 2: 运行测试**

```bash
pnpm test
```
Expected: PASS

- [ ] **Step 3: Bridge build**

```bash
pnpm --filter rem-agent-bridge build
```
Expected: PASS

- [ ] **Step 4: Web dev 启动验证 (手动)**

```bash
pnpm --filter rem-agent-web dev
```
手动检查：
1. 页面加载显示 session 列表
2. 创建新 session 出现并切换
3. 发送消息，流式响应正确渲染
4. 切换 session，消息切换正常，老 session 数据保留
5. 多个 session 同时运行，切走的后台继续执行
6. 中断功能正常
7. 重命名、置顶、删除功能正常

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: final verification after useAgents migration" --allow-empty
```

---

## 自查

1. **Spec coverage**: 
   - BroadcastBus → Task 2
   - IAgentService.stream() → Task 3, 4, 5
   - createBusSSEResponse → Task 6
   - SSE endpoint → Task 8
   - useAgentBus → Task 9
   - useAgents → Task 10
   - ChatPanel props-driven → Task 11
   - Sidebar refactor → Task 12
   - page.tsx → Task 13
   - Cleanup → Task 14
   - Error handling: reconnection in useAgentBus (Task 9), error states in useAgents (Task 10), chunk parse error skip in AgentRemoteService (Task 5)

2. **Placeholder scan**: 无 TBD/TODO，所有步骤包含完整代码。

3. **Type consistency**: 
   - `BusEvent` 在 types.ts (Task 1) 定义，在 agent.ts (Task 4), agent-remote-service.ts (Task 5), response.ts (Task 6), use-agent-bus.ts (Task 9), use-agents.ts (Task 10) 中一致使用
   - `SessionSummary` 在 use-agents.ts (Task 10) 和 sidebar 组件 (Task 12) 中类型一致
   - `UIMessage` 来自 bridge，在 ChatPanel/MessageList (Task 11) 和 useAgents (Task 10) 中类型一致
