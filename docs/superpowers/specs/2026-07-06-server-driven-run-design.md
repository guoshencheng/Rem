# 服务端自驱动 Run 设计（解耦 driver 与客户端连接）

## 背景

当前 `AgentService.run()` 返回一个 SSE 流给 `/api/agent/run`，服务端"消费 core 输出流 → 更新 snapshot + 广播 bus"的循环，是被这个 HTTP 响应（经由 web 端 `send()` 的空消费）**反向拉动**的。

后果：发起 run 的客户端一旦刷新/断开，HTTP 请求 cancel，服务端消费循环随之停止，导致：
- bus 不再广播新 chunk；
- streaming snapshot 不再更新；
- 刷新后无法实时续接（尽管 core agent 逻辑仍在后台跑完并保存 JSONL）。

根因：**给 bus 喂数据的 driver 寄生在发起者的连接上。**

## 目标

1. 让 run 的 driver（消费 core fullStream → 更新 snapshot + 广播 bus）在服务端**独立后台运行**，不依赖任何客户端连接。
2. `/api/agent/run` 变为瞬时命令：触发后立即返回，不再承载长连接 SSE 流。
3. UI 继续只靠 `/api/agent/stream`（bus）作为唯一数据源（现状即如此）。
4. 刷新/断网/多 tab/慢客户端都不影响 agent 推进与实时广播。
5. core 层不改动。

## 非目标

- 不改 core（`runAgent` 已是独立后台 IIFE）。
- 不适配 serverless/edge（假设 long-running Node server）。
- 不改 `AgentService.stream()` / snapshot 推送逻辑（已实现，照旧）。
- **不做 tui 到 bus 的完整迁移**。tui 仅做最小编译修复以保持全仓可编译；其实时流式渲染暂时失效，列为后续 TODO。

## 关键洞察

`AgentStreamController.fullStream` 是**单消费者**模型（`createIterator` 用共享 `index`，多消费者互抢 chunk）。因此不可能既把流返回给发起者 HTTP、又在后台广播 bus——只能二选一。

现状选了"返回 HTTP 顺便广播"，导致 driver 寄生连接。而 bus 已覆盖所有客户端（含发起者自己：`send()` 不用 run 流 chunk 更新 UI）。所以 run 流对 UI 是**纯冗余**。

本设计把唯一的消费放到服务端后台，删除冗余的客户端消费与 SSE run 流。

## 架构对比

### 现状（连接寄生）

```
web send() ──POST /run──▶ AgentService.run() ──▶ createSSEResponse(wrapped)
   │                                                    │
   └── for await (_ of runStream)  ◀──SSE 拉动───────────┘
        (空消费, 反向驱动)                wrapped: for await (chunk of core.fullStream) {
                                            update snapshot; bus.publish(chunk)
                                          }
web UI ◀──/api/agent/stream (bus)──── bus.publish
```

刷新 → runStream cancel → wrapped 循环停 → snapshot/bus 停。

### 改后（服务端自驱动）

```
web send() ──POST /run──▶ AgentService.run():
                             register runRegistry
                             bus.publish(session-start)
                             coreRunAgent(...)
                             void drive(sessionId, result)   ← fire-and-forget
                             return { ok: true }             ← 立即返回
                          ┌────────────────────────────────┐
                          │ drive() 后台独立运行:            │
                          │  for await (chunk of fullStream){│
                          │    applyChunk                    │
                          │    update snapshot               │
                          │    bus.publish(chunk)            │
                          │    session-end / session-error   │
                          │  } finally { cleanup }           │
                          └────────────────────────────────┘
web UI ◀──/api/agent/stream (bus)──── bus.publish
```

刷新 → /run 早已返回，drive 在后台继续 → snapshot/bus 不受影响 → 续接成立。

## 组件设计

### `bridge/src/agent.ts` — `run()` 重构

```typescript
async run(sessionId: string, input: string): Promise<void> {
  const abortController = new AbortController();
  if (!runRegistry.register(sessionId, abortController)) {
    throw new ServiceError('Session is already running', 409);
  }

  bus.publish({ workspace: this.workspace, sessionId, type: 'session-start' });
  this.activityTracker.start(sessionId);

  let result: ReturnType<typeof coreRunAgent>;
  try {
    result = coreRunAgent({
      input: { content: input, timestamp: new Date() },
      sessionId,
      signal: abortController.signal,
      pm: this.providerManager,
    });
  } catch (err) {
    runRegistry.remove(sessionId);
    this.activityTracker.finish(sessionId);
    throw err;
  }

  // 后台自驱动，不依赖任何 HTTP 连接
  void this.drive(sessionId, result);
}
```

签名从 `Promise<AsyncIterable<AgentStreamChunk>>` 变为 `Promise<void>`。

### `bridge/src/agent.ts` — 新增私有 `drive()`

把原 `wrapped` 循环 + `result.output.finally` 清理逻辑合并到这里：

```typescript
private async drive(sessionId: string, result: ReturnType<typeof coreRunAgent>): Promise<void> {
  const workspace = this.workspace;
  try {
    for await (const chunk of result.stream.fullStream) {
      this.activityTracker.applyChunk(sessionId, chunk);

      if (chunk.type === 'message-start') {
        streamingSnapshots.start(sessionId, chunk.messageId);
      } else if (isContentChunk(chunk)) {
        const entry = streamingSnapshots.get(sessionId);
        if (entry) {
          try {
            streamingSnapshots.update(sessionId, reduceStreamChunk(entry.parts, chunk));
          } catch {
            // snapshot best-effort
          }
        }
      }

      bus.publish({ workspace, sessionId, type: 'chunk', chunk });

      if (chunk.type === 'finish') {
        streamingSnapshots.clear(sessionId);
        bus.publish({ workspace, sessionId, type: 'session-end' });
      }
      if (chunk.type === 'error') {
        streamingSnapshots.clear(sessionId);
        bus.publish({ workspace, sessionId, type: 'session-error', error: String(chunk.error) });
      }
    }
  } catch (err) {
    bus.publish({ workspace, sessionId, type: 'session-error', error: err instanceof Error ? err.message : String(err) });
  } finally {
    runRegistry.remove(sessionId);
    streamingSnapshots.clear(sessionId);
    this.activityTracker.finish(sessionId);
  }
}
```

> 注意：不再需要单独 await `result.output`。消费 `fullStream` 直到它以 `finish`/`error` 结束，等价于等 run 完成。core 的 output IIFE 独立跑，driver 只负责搬运。

### `bridge/src/agent-service.interface.ts`

`IAgentService.run` 返回类型 `Promise<AsyncIterable<AgentStreamChunk>>` → `Promise<void>`。

### `bridge/src/agent-remote-service.ts`

**当前实现依赖 run 的返回流**：`run()` 把 `/api/agent/run` 的响应 body 作为 SSE 解析，返回 `AsyncIterable<AgentStreamChunk>`（`parseSSEStream(bodyStream)` + `iterate()`）。本设计必须改：

```typescript
async run(sessionId: string, input: string): Promise<void> {
  const response = await fetch(`${this.baseUrl}/api/agent/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, content: input }),
  });
  if (!response.ok) {
    throw new Error(`Agent run failed: ${response.status}`);
  }
}
```

- 移除 `iterate()` 与对 body 的 `parseSSEStream` 解析。
- `parseSSEStream` 仍被 `stream()` 使用，**保留**；`parseAgentStreamEvent` 若仅 `run()` 用到则清理其 import（实现时核查 `stream()` 是否也用——当前 `stream()` 用 `JSON.parse`，不使用 `parseAgentStreamEvent`，故可移除该 import）。

### `web/src/app/api/agent/run/route.ts`

```typescript
export async function POST(request: NextRequest) {
  const { sessionId, content } = await request.json();
  if (!sessionId || typeof content !== 'string') {
    return new Response('Invalid request', { status: 400 });
  }
  const agentService = getAgentService();
  await agentService.run(sessionId, content);
  return Response.json({ ok: true });
}
```

不再 `createSSEResponse`。

### `web/src/lib/use-agent-bus.ts` — `send()`

```typescript
const send = useCallback(
  async (sessionId: string, content: string) => {
    await agentService.run(sessionId, content);
    // UI updates come from the broadcast bus, not from this call.
  },
  [agentService],
);
```

去掉空消费 `for await`。

### `tui/src/app.ts` — 最小编译修复（先不管 tui）

tui 是 run 流的**唯一直接消费者**，且不使用 bus：

```typescript
const stream = await this.agentService.run(this.sessionId, text);
for await (const chunk of stream) {
  this.handleChunk(chunk);
}
```

`run()` 改为 `void` 后此处编译失败。最小修复：

```typescript
await this.agentService.run(this.sessionId, text);
// TODO(server-driven-run): tui 尚未迁移到 bus，流式渲染暂时失效。
// 后续应订阅 AgentService.stream() 并按 BusEvent 渲染（含 message-start/snapshot/chunk）。
```

后果：tui 发消息后不再有流式增量显示（功能退化，不崩溃、可编译）。`handleChunk`/`startStreamMessage`/`endStream` 若因此变为未使用，实现时按最小改动保留或就地清理，以通过 `pnpm --filter rem-agent-tui typecheck`。此退化为用户明确接受。

### 不改动

- `AgentService.stream()`（bus 订阅 + snapshot 推送）——照旧。
- `streamingSnapshots`、`bus`、`runRegistry`——照旧。
- core 全部——不动。
- `createSSEResponse`——**保留**。它仍作为公共 API 从 `index.ts` 导出，并有独立测试（`client.test.ts`）。本设计仅让 run route 不再使用它。

> 确认结果：`createSSEResponse` 使用方为 run route（本次移除）、`index.ts` 导出、`client.test.ts` 测试。`stream()` 路由是内联构造 ReadableStream（不经 `createSSEResponse`）。因此移除 run route 用法后 `createSSEResponse` 仍非死代码，保留不动。

## 数据流（改后）

### 正常发消息
1. web `send()` → `POST /api/agent/run` → `AgentService.run()`。
2. run 注册 runRegistry、publish session-start、启动后台 `drive()`、返回 `{ok:true}`（HTTP 瞬时结束）。
3. `drive()` 后台消费 core fullStream：update snapshot + bus.publish(chunk)。
4. web 的 `/api/agent/stream` 订阅 bus，`handleEvent` 渲染 message-start/chunk/snapshot。
5. `drive()` 消费到 finish → clear snapshot + publish session-end → finally 清理。

### 刷新续接
1. 刷新 → 旧的 `/run`（已返回）与 `/stream` 连接断开，但 `drive()` 在后台继续。
2. 页面重连 `/api/agent/stream` → `stream()` 推送当前 snapshot（若有）。
3. `handleEvent` 用 messageId 恢复 streaming 消息，后续 chunk 继续追加。

## 边界情况

| 场景 | 处理 |
|---|---|
| 发起者刷新 | drive 后台继续；bus/snapshot 正常；重连收 snapshot 续接 |
| run 参数非法 | route 同步返回 400（在 run() 之前校验） |
| 同一 session 并发 run | `runRegistry.register` 返回 false → 抛 409 |
| driver 内部异常 | catch → publish session-error；finally 清理 |
| interrupt | `runRegistry.abort(sessionId)` → core signal abort → fullStream 以 error/finish 收束 → drive finally 清理 |
| agent 跑完后刷新 | snapshot 已清理，stream() 不推；getMessages 返回完整持久化 |

## 错误处理

- `run()` 中 `coreRunAgent` 同步抛错：清理 runRegistry/activity 后 rethrow（route 返回 500）。
- `drive()` 是 fire-and-forget，其内部 try/catch/finally 必须兜住所有异常，避免 unhandledRejection。
- driver 异常统一通过 bus `session-error` 反馈到 UI。

## 可观测性

保留结构化日志（可由当前临时 `[resume]` 日志转正）：
- driver 启动 / 结束（sessionId）。
- session-end / session-error。
- snapshot 推送（在 stream() 中，已具备）。

## 受影响的现有测试

- `packages/bridge/tests/agent-service-approval.test.ts`：当前 `const stream = await service.run(...)` 后 `for await` 消费流以检测 approval-request 并 resolve。需改为**订阅 `service.stream()`**（bus）观察 approval-request / approval-resolved / tool-result 事件，`run()` 改为 `await`（void）触发。
- `packages/bridge/tests/client.test.ts`：当前断言 `AgentRemoteService.run()` 返回可迭代 SSE 流。需改为断言 `run()` 触发 POST 并 resolve（void）；`createSSEResponse` 本身及其测试保留不动。

## 测试策略

1. **bridge 单元测试**：`run()` 立即 resolve（不阻塞等待流消费完）；调用后 `runRegistry.has(sessionId)` 为 true。
2. **drive 广播测试**：mock 一个 core result（fullStream 产出 message-start + text-delta + finish），调用 run，断言 bus 收到对应 chunk 事件、session-end；结束后 runRegistry 已清理、snapshot 已清理。
3. **并发保护测试**：连续两次 run 同一 session，第二次抛 409。
4. **断开无影响测试**：run 启动后不消费任何返回值，仅订阅 `stream()`（bus），断言仍能收到完整 chunk 序列直到 session-end（证明 driver 不依赖消费者）。
5. **approval 流程测试（改写）**：订阅 bus 观察 approval-request → resolveApproval → approval-resolved + tool-result。
6. **web 手动验证**：发消息生成中刷新，确认续接。

## 影响范围

- `packages/bridge/src/agent.ts`（run 重构 + drive）
- `packages/bridge/src/agent-service.interface.ts`（run 返回类型 → `Promise<void>`）
- `packages/bridge/src/agent-remote-service.ts`（run 改为命令，移除 SSE 解析）
- `packages/web/src/app/api/agent/run/route.ts`（返回 JSON）
- `packages/web/src/lib/use-agent-bus.ts`（send 去掉空消费）
- `packages/tui/src/app.ts`（最小编译修复；流式渲染 TODO）
- `packages/bridge/tests/agent-service-approval.test.ts`（改为订阅 bus）
- `packages/bridge/tests/client.test.ts`（改 run 断言为 void 触发）
- core：不动

---
