# Bridge SSE 收敛 + 直接 POST 流式响应 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 SSE 解析/构造逻辑统一收敛到 bridge 包，POST /api/agent/run 直接返回流式响应，消除两步请求模式。

**Architecture:** Bridge 层提供 `createSSEResponse`（SSE 响应构造）和 `parseSSEStream`（统一解析），Web 层从 bridge 导入并删除重复实现。POST handler 用 `createSSEResponse` 一次性返回流，客户端 `useSSE` 改为直接 POST 消费。

**Tech Stack:** TypeScript 5.4+, Node.js, Next.js 15 App Router, vitest

---

## 文件结构

| 文件 | 职责 | 操作 |
|------|------|------|
| `packages/bridge/src/sse.ts` | 统一 SSE 解析（合并 web 版健壮实现） | 修改 |
| `packages/bridge/src/response.ts` | `createSSEResponse()` — 将 AgentStream 转为 SSE Response | 新建 |
| `packages/bridge/src/client.ts` | `AgentClient.run()` 直接消费 POST 流 | 修改 |
| `packages/bridge/src/agent.ts` | `AgentService.run()` 去 async，返回 stream | 修改 |
| `packages/bridge/src/types.ts` | 删除 `RunResponse`（不再需要） | 修改 |
| `packages/bridge/src/index.ts` | 导出 `createSSEResponse` | 修改 |
| `packages/bridge/tests/client.test.ts` | 更新为单次 fetch 模式 | 修改 |
| `packages/web/src/lib/stream-parser.ts` | 删除（改为从 bridge re-export） | 修改 |
| `packages/web/src/lib/use-sse.ts` | `connect()` 支持 POST method/body | 修改 |
| `packages/web/src/lib/agent-client.ts` | 删除 `getStreamUrl`，`runAgent` 语义调整 | 修改 |
| `packages/web/src/lib/types.ts` | 删除 `SSEEvent`、`RunResponse` | 修改 |
| `packages/web/src/lib/session-store.ts` | `sendMessage` 不管理 `streamUrl` | 修改 |
| `packages/web/src/components/chat/chat-panel.tsx` | useEffect 中一体化 POST + 流消费 | 修改 |
| `packages/web/src/app/api/agent/run/route.ts` | 使用 `createSSEResponse` | 修改 |
| `packages/web/src/app/api/stream/[sessionId]/route.ts` | 删除 | 删除 |

---

### Task 1: 统一 Bridge SSE 解析

**Files:**
- Modify: `packages/bridge/src/sse.ts`

**说明:** 用 web 版解析器的健壮实现替换 bridge 当前版本，保留 `parseAgentStreamEvent` 不变。

- [ ] **Step 1: 替换 `parseSSEStream` 实现**

```typescript
import type { AgentStreamChunk } from 'rem-agent-core';

export interface SSEEvent {
  event?: string;
  data: string;
}

export function parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncIterable<SSEEvent> {
  const decoder = new TextDecoder();
  let buffer = '';

  return {
    [Symbol.asyncIterator]: async function* () {
      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: true });
        }

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let eventType: string | undefined;
        let dataLines: string[] = [];

        for (const line of lines) {
          if (line === '') {
            if (dataLines.length > 0) {
              yield { event: eventType, data: dataLines.join('\n') };
              eventType = undefined;
              dataLines = [];
            }
            continue;
          }
          if (line.startsWith('event: ')) {
            eventType = line.slice(7);
          } else if (line.startsWith('data: ')) {
            dataLines.push(line.slice(6));
          }
        }

        if (done) {
          if (dataLines.length > 0) {
            yield { event: eventType, data: dataLines.join('\n') };
          }
          return;
        }
      }
    },
  };
}

export function parseAgentStreamEvent(event: SSEEvent): AgentStreamChunk {
  return JSON.parse(event.data) as AgentStreamChunk;
}
```

- [ ] **Step 2: 提交**

```bash
git add packages/bridge/src/sse.ts
git commit -m "refactor(bridge): 统一 SSE 解析器，支持多行 data 和 done 后残留处理"
```

---

### Task 2: 新增 `createSSEResponse`

**Files:**
- Create: `packages/bridge/src/response.ts`
- Modify: `packages/bridge/tests/client.test.ts` (添加测试)

- [ ] **Step 1: 创建 `response.ts`**

```typescript
import type { AgentStreamChunk } from 'rem-agent-core';

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
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify({ type: 'error', error: message })}\n\n`),
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
```

- [ ] **Step 2: 添加测试**

在 `packages/bridge/tests/client.test.ts` 文件末尾追加：

```typescript
import { createSSEResponse } from '../src/response.js';
import { parseSSEStream, parseAgentStreamEvent } from '../src/sse.js';

describe('createSSEResponse', () => {
  it('produces valid SSE stream from chunks', async () => {
    async function* gen(): AsyncIterable<AgentStreamChunk> {
      yield { type: 'text-start', step: 1, partId: 'p1' } as AgentStreamChunk;
      yield { type: 'text-delta', step: 1, partId: 'p1', text: 'hi' } as AgentStreamChunk;
      yield { type: 'finish', output: { content: 'hi', completed: true } } as AgentStreamChunk;
    }

    const response = createSSEResponse(gen());
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');

    const reader = response.body!.getReader();
    const sseEvents = parseSSEStream(reader);
    const chunks: AgentStreamChunk[] = [];
    for await (const sse of sseEvents) {
      if (sse.event === 'chunk' || sse.event === 'error') {
        chunks.push(parseAgentStreamEvent(sse));
      }
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0].type).toBe('text-start');
    expect(chunks[1].type).toBe('text-delta');
    expect(chunks[2].type).toBe('finish');
  });

  it('emits error SSE frame on stream exception', async () => {
    async function* gen(): AsyncIterable<AgentStreamChunk> {
      yield { type: 'text-delta', step: 1, partId: 'p1', text: 'a' } as AgentStreamChunk;
      throw new Error('boom');
    }

    const response = createSSEResponse(gen());
    const reader = response.body!.getReader();
    const sseEvents = parseSSEStream(reader);
    const chunks: AgentStreamChunk[] = [];
    for await (const sse of sseEvents) {
      if (sse.event === 'chunk' || sse.event === 'error') {
        chunks.push(parseAgentStreamEvent(sse));
      }
    }

    expect(chunks.some((c) => c.type === 'error')).toBe(true);
  });
});
```

- [ ] **Step 3: 运行测试验证**

```bash
pnpm --filter rem-agent-bridge test
```
Expected: 新测试通过，旧测试可能失败（旧测试仍用两步 fetch mock，下一步修复）。

- [ ] **Step 4: 提交**

```bash
git add packages/bridge/src/response.ts packages/bridge/tests/client.test.ts
git commit -m "feat(bridge): 添加 createSSEResponse 及测试"
```

---

### Task 3: 更新 `AgentClient.run()` 为直接 POST 消费

**Files:**
- Modify: `packages/bridge/src/client.ts`
- Modify: `packages/bridge/tests/client.test.ts` (更新旧测试)

- [ ] **Step 1: 重写 `AgentClient.run()`**

将 `packages/bridge/src/client.ts` 的 `run` 方法和 `consumeStream` 替换为：

```typescript
import type { AgentStreamChunk } from 'rem-agent-core';
import type {
  RunRequest,
  SessionSummary,
  InterruptRequest,
  ResetRequest,
} from './types.js';
import { parseSSEStream, parseAgentStreamEvent } from './sse.js';

export class AgentClient {
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

  // ... interrupt, reset, listSessions 方法不变 ...
```

注意：`RunResponse` 从 import 中移除。

- [ ] **Step 2: 更新旧测试**

将 `packages/bridge/tests/client.test.ts` 中原有的 `'requests run and consumes stream'` 测试改为单次 fetch mock：

```typescript
it('requests run and consumes stream', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    fetchMock.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => {
          const encoder = new TextEncoder();
          let done = false;
          return {
            read: async () => {
              if (done) return { done: true, value: undefined };
              done = true;
              return {
                done: false,
                value: encoder.encode(
                  'event: chunk\n' +
                    'data: {"type":"text-start","step":1,"partId":"p1"}\n\n' +
                    'event: chunk\n' +
                    'data: {"type":"text-delta","step":1,"partId":"p1","text":"hi"}\n\n' +
                    'event: chunk\n' +
                    'data: {"type":"finish","output":{"content":"hi","completed":true}}\n\n',
                ),
              };
            },
          };
        },
      },
    });

    const client = new AgentClient('http://localhost:8321');
    const stream = await client.run('s1', 'hello');
    const chunks: any[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0].type).toBe('text-start');
    expect(chunks[1].type).toBe('text-delta');
    expect(chunks[2].type).toBe('finish');
  });
```

- [ ] **Step 3: 运行测试**

```bash
pnpm --filter rem-agent-bridge test
```
Expected: 全部测试通过。

- [ ] **Step 4: 提交**

```bash
git add packages/bridge/src/client.ts packages/bridge/tests/client.test.ts
git commit -m "refactor(bridge): AgentClient.run() 改为直接消费 POST 流式响应"
```

---

### Task 4: 简化 `AgentService.run()` 和清理 types

**Files:**
- Modify: `packages/bridge/src/agent.ts`
- Modify: `packages/bridge/src/types.ts`

- [ ] **Step 1: 修改 `agent.ts`**

`AgentService.run()` 去掉 `async`，删除 `activeStreams` 和 `getStream()`，直接返回 `{ stream, output }`：

```typescript
import type { AgentStreamChunk, AgentStream } from 'rem-agent-core';
import { runAgent as coreRunAgent } from 'rem-agent-core';
import type { ServerMessage, ContentPart, AgentOutput } from 'rem-agent-core';
import type { ProviderManager } from 'rem-agent-core';
import type { SessionProvider } from 'rem-agent-core';
import { ServiceError } from './errors.js';

export type { ServerMessage } from 'rem-agent-core';

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

export class AgentService {
  private activeRuns = new Map<string, AbortController>();
  private sessionProvider: SessionProvider;
  private msgCache = new Map<string, ServerMessage[]>();

  constructor(private providerManager: ProviderManager) {
    this.sessionProvider = providerManager.require<SessionProvider>('session');
  }

  run(params: RunParams): RunResult {
    if (this.activeRuns.has(params.sessionId)) {
      throw new ServiceError('Session is already running', 409);
    }

    const abortController = new AbortController();
    this.activeRuns.set(params.sessionId, abortController);

    const result = coreRunAgent({
      input: { content: params.content, timestamp: new Date() },
      sessionId: params.sessionId,
      signal: abortController.signal,
      pm: this.providerManager,
    });

    const tapped = this.tapFullStream(result.stream.fullStream, params.sessionId);
    const tappedStream = { ...result.stream, fullStream: tapped };

    result.output.finally(() => {
      this.activeRuns.delete(params.sessionId);
    });

    return { stream: tappedStream, output: result.output };
  }

  // tapFullStream —— 保持不变 ...

  interrupt(sessionId: string): InterruptResult {
    const controller = this.activeRuns.get(sessionId);
    if (controller) {
      controller.abort();
    }
    return { sessionId, interrupted: !!controller };
  }

  async reset(sessionId: string): Promise<ResetResult> {
    const controller = this.activeRuns.get(sessionId);
    if (controller) controller.abort();
    this.activeRuns.delete(sessionId);
    return { sessionId, reset: true };
  }

  // addUserMessage、getMessages、listSessions —— 保持不变 ...
}
```

关键变更：
1. `run()` 去掉 `async`，函数签名从 `async run(...): Promise<RunResult>` 变为 `run(...): RunResult`
2. `RunResult` 接口从 `{ sessionId: string }` 变为 `{ stream: AgentStream; output: Promise<AgentOutput> }`
3. 删除 `activeStreams` 及 `getStream()` 方法
4. 删除 `RunAgentResult` import（不再需要）

- [ ] **Step 2: 清理 `types.ts`**

删除 `RunResponse`（不再需要）：

在 `packages/bridge/src/types.ts` 中删除以下内容：
```typescript
export interface RunResponse {
  sessionId: string;
  streamUrl: string;
}
```

- [ ] **Step 3: 提交**

```bash
git add packages/bridge/src/agent.ts packages/bridge/src/types.ts
git commit -m "refactor(bridge): AgentService.run() 去 async，直接返回 stream；删除 RunResponse"
```

---

### Task 5: 更新 Bridge 导出

**Files:**
- Modify: `packages/bridge/src/index.ts`

- [ ] **Step 1: 新增导出 `createSSEResponse`，移除 `RunResponse`**

```typescript
export { AgentClient } from './client.js';
export { parseSSEStream, parseAgentStreamEvent } from './sse.js';
export { createSSEResponse } from './response.js';
export type {
  RunRequest,
  SessionSummary,
  InterruptRequest,
  ResetRequest,
  ServerStreamEvent,
} from './types.js';
export type { SSEEvent } from './sse.js';
export type { AgentStreamChunk, ModelMessage, ServerMessage } from 'rem-agent-core';

export { AgentService } from './agent.js';
export type { RunParams, RunResult, InterruptResult, ResetResult } from './agent.js';
export { SessionService } from './sessions.js';
export { ServiceError } from './errors.js';
```

- [ ] **Step 2: 提交**

```bash
git add packages/bridge/src/index.ts
git commit -m "feat(bridge): 导出 createSSEResponse，移除 RunResponse 导出"
```

---

### Task 6: Web 层 — 删除 stream-parser.ts，从 bridge re-export

**Files:**
- Modify: `packages/web/src/lib/stream-parser.ts`

- [ ] **Step 1: 将 `stream-parser.ts` 改为 re-export**

```typescript
export { parseSSEStream, parseAgentStreamEvent } from 'rem-agent-bridge';
export type { SSEEvent } from 'rem-agent-bridge';
```

- [ ] **Step 2: 提交**

```bash
git add packages/web/src/lib/stream-parser.ts
git commit -m "refactor(web): stream-parser 改为从 bridge re-export"
```

---

### Task 7: Web 层 — 更新 `use-sse.ts` 支持 POST

**Files:**
- Modify: `packages/web/src/lib/use-sse.ts`

- [ ] **Step 1: 修改 `connect` 签名，支持 POST options**

```typescript
'use client';

import { useRef, useCallback } from 'react';
import type { AgentStreamChunk } from './types';
import { parseSSEStream, parseAgentStreamEvent } from './stream-parser';

type ChunkHandler = (chunk: AgentStreamChunk) => void;
type StatusHandler = (status: 'connecting' | 'reconnecting' | 'error' | 'done') => void;

interface FetchOptions {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

export function useSSE() {
  const abortRef = useRef<AbortController | null>(null);
  const retryCountRef = useRef(0);
  const maxRetries = 3;

  const connect = useCallback(
    (
      url: string,
      options: FetchOptions,
      onChunk: ChunkHandler,
      onError?: (err: Error) => void,
      onStatus?: StatusHandler,
    ) => {
      const abort = new AbortController();
      abortRef.current = abort;

      async function start() {
        try {
          onStatus?.('connecting');
          const response = await fetch(url, {
            method: options.method ?? 'GET',
            headers: options.headers,
            body: options.body,
            signal: abort.signal,
          });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          retryCountRef.current = 0;
          const reader = response.body?.getReader();
          if (!reader) throw new Error('No readable stream');

          for await (const sse of parseSSEStream(reader)) {
            const chunk = parseAgentStreamEvent(sse);
            onChunk(chunk);
            if (chunk.type === 'finish' || chunk.type === 'error') {
              onStatus?.(chunk.type === 'error' ? 'error' : 'done');
              return;
            }
          }
          onStatus?.('done');
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          if (retryCountRef.current < maxRetries) {
            retryCountRef.current++;
            onStatus?.('reconnecting');
            await new Promise((r) => setTimeout(r, 3000));
            start();
          } else {
            onStatus?.('error');
            onError?.(err instanceof Error ? err : new Error(String(err)));
          }
        }
      }

      start();
    },
    [],
  );

  const disconnect = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    retryCountRef.current = 0;
  }, []);

  return { connect, disconnect };
}
```

关键变更：`connect` 新增第二参数 `options: FetchOptions`，内部 `fetch` 使用 `options.method`（默认 `'GET'`）、`options.headers`、`options.body`。

- [ ] **Step 2: 提交**

```bash
git add packages/web/src/lib/use-sse.ts
git commit -m "refactor(web): useSSE.connect() 支持 POST method/body"
```

---

### Task 8: Web 层 — 更新 `agent-client.ts`

**Files:**
- Modify: `packages/web/src/lib/agent-client.ts`

- [ ] **Step 1: 删除 `getStreamUrl`，调整 `runAgent` 返回类型**

```typescript
import type { SessionSummary } from './types';

export async function runAgent(sessionId: string, input: string): Promise<Response> {
  const res = await fetch('/api/agent/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, content: input }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to run agent: ${res.status} ${text}`);
  }
  return res;
}

export async function interruptAgent(sessionId: string): Promise<void> {
  await fetch('/api/agent/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, interrupt: true }),
  });
}

export async function listSessions(q?: string): Promise<SessionSummary[]> {
  const params = q ? `?q=${encodeURIComponent(q)}` : '';
  const res = await fetch(`/api/sessions${params}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to list sessions: ${res.status} ${text}`);
  }
  return res.json() as Promise<SessionSummary[]>;
}

export async function createSession(): Promise<SessionSummary> {
  const res = await fetch('/api/sessions', { method: 'POST' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to create session: ${res.status} ${text}`);
  }
  return res.json() as Promise<SessionSummary>;
}

export async function getSession(sessionId: string): Promise<{ sessionId: string; title?: string; messages: unknown[] }> {
  const res = await fetch(`/api/sessions/${sessionId}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to get session: ${res.status} ${text}`);
  }
  return res.json();
}

export async function updateSession(sessionId: string, updates: { title?: string; pinned?: boolean }): Promise<void> {
  const res = await fetch(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to update session: ${res.status} ${text}`);
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to delete session: ${res.status} ${text}`);
  }
}
```

关键变更：
1. `runAgent` 返回 `Promise<Response>`（raw fetch response），不再返回 `Promise<RunResponse>`
2. 删除 `getStreamUrl` 函数
3. 删除 `import type { RunResponse } from './types'`

- [ ] **Step 2: 提交**

```bash
git add packages/web/src/lib/agent-client.ts
git commit -m "refactor(web): runAgent 返回 Response；删除 getStreamUrl"
```

---

### Task 9: Web 层 — 清理 `types.ts`

**Files:**
- Modify: `packages/web/src/lib/types.ts`

- [ ] **Step 1: 删除 `SSEEvent` 和 `RunResponse`**

```typescript
import type { AgentStreamChunk, ServerMessage, ContentPart, SessionSummary as CoreSessionSummary } from 'rem-agent-core';

export interface SessionSummary extends CoreSessionSummary {
  pinned?: boolean;
}

export type UIMessage = ServerMessage;

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

export type { AgentStreamChunk, ContentPart };
```

删除的内容：
```typescript
// 删除这两项：
export interface RunResponse { sessionId: string; streamUrl: string }
export interface SSEEvent { event?: string; data: string }
```

- [ ] **Step 2: 提交**

```bash
git add packages/web/src/lib/types.ts
git commit -m "refactor(web): types.ts 删除 SSEEvent 和 RunResponse"
```

---

### Task 10: Web 层 — 更新 `session-store.ts`

**Files:**
- Modify: `packages/web/src/lib/session-store.ts`

- [ ] **Step 1: `sendMessage` 不再调用 `runAgent`，移除 `streamUrl` 管理**

找到 `sendMessage` 方法（约第 89-131 行），做以下修改：

1. 删除 `import { runAgent }` 中的 `runAgent`：

```typescript
import {
  listSessions, createSession, getSession, updateSession,
  deleteSession, interruptAgent,
} from './agent-client';
```

2. 修改 `sendMessage` 方法，删除对 `runAgent` 的调用和返回值：

```typescript
sendMessage: (text: string) => {
    const { currentSessionId, messages } = get();
    if (!currentSessionId || get().streaming) return;

    const userMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      toolCalls: [],
      parts: [{ type: 'text', text } as ContentPart],
      status: 'done',
    };
    const assistantMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      toolCalls: [],
      parts: [] as ContentPart[],
      status: 'pending',
    };
    assistantMessageId = assistantMsg.id;

    set({
      messages: [...messages, userMsg, assistantMsg],
      error: null,
      streaming: true,
    });
  },
```

关键变更：
- 删除 `try { const result = await runAgent(...) } catch { ... }` 整个块
- 在 `set` 中直接设置 `streaming: true`
- `sendMessage` 返回类型从 `Promise<{ streamUrl: string } | undefined>` 改为 `void`
- Store type 中的 `sendMessage` 签名同步更新

3. 更新 Store type 中 `sendMessage` 的签名（约第 26 行）：

```typescript
sendMessage: (text: string) => void;
```

- [ ] **Step 2: 提交**

```bash
git add packages/web/src/lib/session-store.ts
git commit -m "refactor(web): sendMessage 不再管理 streamUrl，由 chat-panel 统一触发流消费"
```

---

### Task 11: Web 层 — 更新 `chat-panel.tsx`

**Files:**
- Modify: `packages/web/src/components/chat/chat-panel.tsx`

- [ ] **Step 1: 改为一体化 POST + 流消费**

```typescript
'use client';

import { useSessionStore } from '@/lib/session-store';
import { useEffect } from 'react';
import { MessageList } from './message-list';
import { InputBox } from './input-box';
import { useSSE } from '@/lib/use-sse';

export function ChatPanel() {
  const streaming = useSessionStore((s) => s.streaming);
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const messages = useSessionStore((s) => s.messages);
  const reconnecting = useSessionStore((s) => s.reconnecting);
  const serverError = useSessionStore((s) => s.serverError);
  const onChunk = useSessionStore((s) => s.onChunk);
  const setReconnecting = useSessionStore((s) => s.setReconnecting);
  const { connect, disconnect } = useSSE();

  useEffect(() => {
    if (!streaming || !currentSessionId) return;
    const lastUserMsg = messages.filter((m) => m.role === 'user').pop();
    if (!lastUserMsg) return;

    connect(
      '/api/agent/run',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSessionId, content: lastUserMsg.content }),
      },
      (chunk) => onChunk(chunk),
      (err) => {
        console.error('SSE error:', err);
        onChunk({ type: 'error', error: err } as any);
      },
      (status) => {
        setReconnecting(status === 'reconnecting');
      },
    );

    return () => disconnect();
  }, [streaming, currentSessionId]); // 故意不依赖 messages，避免流消费期间重连

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <header className="flex items-center gap-3 px-4 h-12 border-b border-bd flex-shrink-0">
        <span className="text-sm font-medium text-tx truncate flex-1">Rem Agent</span>
        {reconnecting && (
          <span className="text-xs text-warn bg-warn-bg px-2 py-0.5 rounded-chip animate-pulse">正在重连...</span>
        )}
        {serverError && (
          <span className="text-xs text-err bg-err-bg px-2 py-0.5 rounded-chip">服务异常</span>
        )}
      </header>
      <MessageList />
      <InputBox />
    </div>
  );
}
```

关键变更：
1. 删除 `import { getStreamUrl } from '@/lib/agent-client'`
2. 新增 `const messages = useSessionStore((s) => s.messages)`
3. `connect` 调用新增第二个参数 `options`（POST method + body）
4. `useEffect` 依赖仅 `[streaming, currentSessionId]`，不包含 `messages`

- [ ] **Step 2: 提交**

```bash
git add packages/web/src/components/chat/chat-panel.tsx
git commit -m "refactor(web): chat-panel 一体化 POST + SSE 流消费，删除 getStreamUrl 依赖"
```

---

### Task 12: Web 层 — 更新 POST handler 和删除 GET stream route

**Files:**
- Modify: `packages/web/src/app/api/agent/run/route.ts`
- Delete: `packages/web/src/app/api/stream/[sessionId]/route.ts`

- [ ] **Step 1: 更新 POST handler**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import type { AgentService } from 'rem-agent-bridge';
import { createSSEResponse } from 'rem-agent-bridge';
import { getContainer } from '@/lib/container';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, content, interrupt } = body as {
      sessionId: string;
      content?: string;
      interrupt?: boolean;
    };

    const container = await getContainer();
    const agentService = container.resolve<AgentService>('agentService');

    if (interrupt) {
      const result = agentService.interrupt(sessionId);
      return NextResponse.json({ sessionId, interrupted: result.interrupted });
    }

    if (!content || !sessionId) {
      return NextResponse.json({ error: 'sessionId and content are required' }, { status: 400 });
    }

    const { stream } = agentService.run({ sessionId, content });
    agentService.addUserMessage(sessionId, content);

    return createSSEResponse(stream.fullStream);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
```

关键变更：
1. `agentService.run()` 不再 `await`（`run` 已是同步函数）
2. 解构 `{ stream }` 替代 `await agentService.run(...)` 的返回值
3. 导入 `createSSEResponse`，用 `stream.fullStream` 调用它返回 SSE Response

- [ ] **Step 2: 删除 GET stream route**

```bash
rm packages/web/src/app/api/stream/\[sessionId\]/route.ts
```
确认 `packages/web/src/app/api/stream/` 目录为空后也可删除空目录。

- [ ] **Step 3: 提交**

```bash
git add packages/web/src/app/api/agent/run/route.ts
git rm packages/web/src/app/api/stream/\[sessionId\]/route.ts
git commit -m "refactor(web): POST /api/agent/run 直接返回 SSE stream；删除 GET /api/stream/[id]"
```

---

### Task 13: 类型检查与测试

- [ ] **Step 1: 检查是否有遗留引用**

```bash
rg "streamUrl" packages/web/src/ packages/tui/src/
rg "getStreamUrl" packages/
rg "RunResponse" packages/web/src/ packages/bridge/src/
rg "activeStreams" packages/bridge/src/
rg "from.*stream-parser" packages/web/src/
rg "from.*agent-client.*getStreamUrl" packages/web/src/
```
Expected: 除 plan 文档和 spec 外，没有残留引用。

- [ ] **Step 2: Bridge 类型检查**

```bash
pnpm --filter rem-agent-bridge typecheck
```
Expected: 通过。

- [ ] **Step 3: Web 类型检查**

```bash
pnpm --filter rem-agent-web typecheck
```
Expected: 通过。

- [ ] **Step 4: 运行 Bridge 测试**

```bash
pnpm --filter rem-agent-bridge test
```
Expected: 全部通过。

- [ ] **Step 5: 提交**（如有修复）

```bash
git add -A
git commit -m "fix: 清理残留引用，确保 typecheck 和 test 通过"
```

---

### Task 14: TUI 验证

**Files:**
- No changes needed (inspect-only)

- [ ] **Step 1: TUI 类型检查**

```bash
pnpm --filter rem-agent-tui typecheck
```
Expected: 通过。`AgentClient.run()` 的返回类型 `Promise<AsyncIterable<AgentStreamChunk>>` 未变，TUI 无需修改。

---

## 验收检查清单

- [ ] POST `/api/agent/run` 返回 `Content-Type: text/event-stream`
- [ ] 客户端一次 fetch 即可消费完整 agent 流（不再有 `streamUrl` 两步）
- [ ] `web` 使用 `parseSSEStream` 来自 bridge re-export，无独立实现
- [ ] TUI `AgentClient.run()` 接口不变，无需修改即可工作
- [ ] `interrupt` 功能正常
- [ ] `pnpm typecheck` 全仓通过
- [ ] `pnpm test` 全仓通过
