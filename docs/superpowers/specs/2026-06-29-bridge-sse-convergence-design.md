# Bridge SSE 收敛 + 直接 POST 流式响应 设计

日期：2026-06-29
状态：已确认

## 背景

当前流式响应的生命周期分两步：客户端先 `POST /api/agent/run` 拿到 `{ streamUrl }`，再 `GET /api/stream/[id]` 拉取 SSE 流。这种两步模式存在以下问题：

1. **竞态条件**：`activeStreams.set()` 和客户端 GET 之间无协调，可能出现 `"No active stream"` 错误
2. **`fullStream` getter 多次调用**：`AgentStreamController.stream` 是 getter，每次访问都创建新迭代器，`runAgent()` 和 `AgentService.run()` 各触发一次
3. **代码重复**：`bridge` 和 `web` 各有独立的 `parseSSEStream` / `parseAgentStreamEvent` 实现，逻辑略有分歧
4. **不必要的 HTTP 往返**：两次请求增加了延迟和出错面

### 目标

- 一次请求完成：POST 直接返回 SSE stream，消除第二步 GET
- SSE 相关逻辑统一收敛到 `bridge` 包，`web` 和 `tui` 共用同一套实现
- 为后续方案 2（事件缓冲区续接）预留扩展点

## 参考

Vercel AI SDK 的 `streamText()` + `pipeDataStreamToResponse()` 模式：POST handler 直接返回 `Content-Type: text/event-stream` 的流式响应，客户端通过 `fetch` + `getReader()` 一行消费。

## 架构变更

```
变更前：
  客户端 ──POST { sessionId, content }──► 服务端
          ◄── JSON { streamUrl } ──────
  客户端 ──GET streamUrl───────────────► 服务端
          ◄── SSE events ──────────────

变更后：
  客户端 ──POST { sessionId, content }──► 服务端
          ◄── SSE events ────────────── (一次完成)
```

模块归属：
```
bridge (共享层)
  ├── sse.ts          — parseSSEStream、parseAgentStreamEvent（唯一实现）
  ├── response.ts     — createSSEResponse()（新）
  ├── client.ts       — AgentClient.run() 改为直接消费 POST 流
  └── agent.ts        — AgentService.run() 去 async，直接返回 { stream, output }

web (Next.js UI)
  ├── route.ts (POST) — 使用 createSSEResponse() 返回流
  ├── use-sse.ts      — 改为支持 POST 请求
  ├── session-store   — 移除 streamUrl 管理
  ├── chat-panel.tsx  — 一体化 POST + 流消费
  ├── stream-parser.ts — 删除（从 bridge re-export）
  ├── agent-client.ts  — 简化，删除 getStreamUrl
  └── route.ts (GET stream) — 删除（后续方案 2 再加回）

tui (Terminal UI)
  └── app.ts          — AgentClient.run() 自动适配新接口（无需改动）
```

## 详细变更

### Bridge 层

#### 1. `bridge/src/sse.ts` — 统一 SSE 解析

合并 `web/src/lib/stream-parser.ts` 的健壮特性：
- 支持多行 `data:` 字段（用 `\n` 连接）
- `done` 后处理残留缓冲区
- 正确按空行分割 SSE 事件

导出保持：
```typescript
export interface SSEEvent { event?: string; data: string }
export function parseSSEStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncIterable<SSEEvent>
export function parseAgentStreamEvent(event: SSEEvent): AgentStreamChunk
```

#### 2. `bridge/src/response.ts`（新）— SSE 响应构造

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
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ type: 'error', error: message })}\n\n`));
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

#### 3. `bridge/src/client.ts` — `AgentClient.run()` 直接消费 POST 流

改为 `fetch(POST)` → `response.body.getReader()` → `parseSSEStream`，不再解析 JSON 取 `streamUrl`。

`AgentClient.consumeStream()` 私有方法删除。

#### 4. `bridge/src/agent.ts` — `AgentService.run()` 简化

- `run()` 去掉 `async` 关键字，返回类型从 `Promise<RunResult>` 改为 `{ stream: AgentStream; output: Promise<AgentOutput> }`（直接透出 `coreRunAgent` 的 `stream` 字段，供 POST handler 取 `stream.fullStream`）
- 删除 `activeStreams` Map 及 `getStream()` 方法
- `result.output.finally(...)` 链式调用保留（`output` 本身是 Promise，无需 `async` 包装）
- `tapFullStream`、`addUserMessage`、`msgCache`、`activeRuns` 保留

#### 5. `bridge/src/index.ts` — 新增导出

```typescript
export { createSSEResponse } from './response.js';
```

### Web 层

#### 6. `web/src/app/api/agent/run/route.ts` — POST 直接返回 SSE

```typescript
import { createSSEResponse } from 'rem-agent-bridge';

export async function POST(request: NextRequest) {
  // ... 参数解析不变 ...
  if (interrupt) { /* 不变 */ }
  if (!content || !sessionId) { /* 不变 */ }

  const { stream } = agentService.run({ sessionId, content });
  agentService.addUserMessage(sessionId, content);
  return createSSEResponse(stream.fullStream);
}
```

#### 7. `web/src/app/api/stream/[sessionId]/route.ts` — 删除

后续实现方案 2（续接）时再加回，届时可能改为带 cursor 参数的 GET。

#### 8. `web/src/lib/stream-parser.ts` — 删除

改为：
```typescript
export { parseSSEStream, parseAgentStreamEvent } from 'rem-agent-bridge';
```
或由调用方直接从 bridge 导入。

#### 9. `web/src/lib/use-sse.ts` — 支持 POST

`connect` 签名扩展，新增第二个参数 `options`（RequestInit 子集）：

```typescript
connect(
  url: string,
  options: { method?: string; body?: string; headers?: Record<string, string> },
  onChunk: ChunkHandler,
  onError?: (err: Error) => void,
  onStatus?: StatusHandler,
)
```

内部改为 `fetch(url, { method, body, headers, signal: abort.signal })`。options 为空时退化为当前 GET 行为。

#### 10. `web/src/lib/agent-client.ts` — 简化

- 删除 `getStreamUrl()`
- `runAgent` 不再返回 `RunResponse`，改为返回原始 `fetch` 的 `Response` 对象，由调用方（`useSSE`）直接从 `response.body` 读取流

#### 11. `web/src/lib/session-store.ts` — 移除 streamUrl 管理

`sendMessage` 不再调用 `runAgent()`，不再返回 `streamUrl`。仅负责：
- 添加 user/assistant UI 消息
- 设置 `streaming: true`

流消费由 `chat-panel.tsx` 的 `useEffect` 统一触发。

#### 12. `web/src/components/chat/chat-panel.tsx` — 一体化 POST + 流消费

```typescript
useEffect(() => {
  if (!streaming || !currentSessionId) return;
  const lastUserMsg = messages.find(m => m.role === 'user');
  if (!lastUserMsg) return;

  connect(
    '/api/agent/run',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentSessionId, content: lastUserMsg.content }),
    },
    onChunk,
    onError,
    onStatus,
  );
  return () => disconnect();
}, [streaming, currentSessionId]); // 故意不依赖 messages，避免流消费期间重连
```

注意：useEffect 依赖仅 `[streaming, currentSessionId]`，不包含 `messages`。`messages` 在流消费期间会频繁变化（每个 chunk 更新），纳入依赖会导致反复重连。

## 扩展点

当前设计为方案 2（续接）预留：

- `createSSEResponse` 可扩展为接收一个 `onChunk` 回调，用于同步写入 ring buffer
- `bridge/src/response.ts` 可导出 `createResumableSSEResponse`，接收额外的 buffer/store 参数
- SSE 事件序列号（`id:` 字段）方案 2 时再加，不影响当前实现

## 影响范围

| 包 | 新增 | 修改 | 删除 |
|---|---|---|---|
| bridge | `response.ts` | `sse.ts`, `client.ts`, `agent.ts`, `index.ts` | — |
| web | — | `route.ts`(POST), `use-sse.ts`, `agent-client.ts`, `session-store.ts`, `chat-panel.tsx` | `stream-parser.ts`, `route.ts`(GET stream) |
| core | — | — | — |
| tui | — | — | — |

## 验收标准

1. POST `/api/agent/run` 返回 `Content-Type: text/event-stream` 的流式响应
2. 客户端一次 fetch 即可消费完整的 agent 流
3. `web` 不再有独立的 SSE 解析代码，统一从 `bridge` 导入
4. `tui` 的 `AgentClient.run()` 不新增参数即可工作（内部自动适配新接口）
5. `interrupt` 功能不受影响
6. 现有测试通过
