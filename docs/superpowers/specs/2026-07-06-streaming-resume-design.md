# 服务端 Streaming 续接设计（方案 B：Bus 推送 Snapshot + messageId 链路）

## 目标

页面刷新后，客户端能续接看到 Agent 正在生成的内容，不丢失已生成的部分，也不重复拼接。

具体要求：
- **客户端刷新（同进程）**：刷新后重新订阅 bus，服务端主动把当前内存中的 streaming snapshot 推送给它，客户端据此还原正在生成的 assistant 内容，并继续接收后续 chunk。
- **Agent 重启**：snapshot 是纯内存，重启即丢失，只展示 JSONL 中最后一个完整 step 的内容。
- **snapshot 与持久化 message 分离**：正在流式的内容只在内存，绝不写入 JSONL；JSONL 只保存已完成 step 的完整 message。
- **messageId 一致**：流式 message 与持久化 message 用同一个 id，避免刷新后重复拼接或产生两条。

## 非目标

- 不实现 chunk 级磁盘持久化或 replay log。
- 不支持 Agent 重启后恢复未完成的流式内容。
- 不改变 JSONL append-only 的持久化格式。

## 关键洞察

现有 `onStepFinish`（`run-agent.ts:178-185`）在每个 loop iteration 结束后才保存，此时 assistant message 内容已定型。所以持久化的 assistant message 永远完整，正在流式的内容天然不落盘。

本方案需要：
1. **core 小改动**：新增 `message-start` stream 事件，携带 assistant message 的 `id`，把 messageId 传出到 bridge/web。
2. **bridge**：内存维护 streaming snapshot（按 messageId），bus 新订阅者上线时推送。
3. **web**：消费 `message-start` / `snapshot`，用 messageId 定位 message，修复未初始化 session 的事件丢弃。

## 现有问题

### 问题 1：stream chunk 没有 messageId

`AgentStreamChunk`（`types.ts:42-61`）只有 `step` 和 `partId`，没有 assistant message 的 id。bridge 无法把 snapshot 关联到具体 message。刷新后 web 无法把 snapshot 对齐到 `getMessages()` 返回的持久化 message，可能重复。

### 问题 2：未初始化 session 的事件被丢弃

`use-agents.ts` 处理 bus 事件时：

```typescript
case 'chunk': {
  if (!state) {
    ensureSession(event.sessionId);  // 异步，不 await
    state = map.get(event.sessionId); // 仍是 undefined
    if (!state) return;               // 直接丢弃当前 chunk
  }
  ...
}
```

`ensureSession` 是异步的，事件到达时 state 尚未建立，当前事件被丢弃。对"从未打开、但正在后台运行"的 session，chunk 会持续丢失。

## 架构图

### 1. messageId 链路

```
core                          bridge                       web
────                          ──────                       ───
create assistant msg (id=M)
   │
   ├─ emit message-start{M} ──▶ record currentMsgId[s]=M ──▶ ensure msg(id=M, streaming)
   │                            reset snapshot[s]=[]
   │
streaming chunk ─────────────▶ snapshot[s]=reduce(...)  ──▶ append to msg M
   │                            bus.publish(chunk)
   │
 (new subscriber connects) ──▶ yield snapshot{M, parts} ──▶ set msg M.parts = parts
   │
step finish
   │
onStepFinish save (JSONL, id=M)
   │
run finally ─────────────────▶ clear snapshot[s]
```

### 2. 刷新后续接流程

```
┌──────────────────────── 页面刷新 ────────────────────────┐

  client 重新 mount
        │
        ├─────────────────────────────┐
        ▼                             ▼
┌──────────────────┐      ┌──────────────────────────────┐
│ getMessages()    │      │ 重新订阅 /api/agent/stream    │
│ 加载已完成历史    │      │ AgentService.stream()         │
│ (done messages)  │      └──────────────┬───────────────┘
└────────┬─────────┘                    │ 订阅后立即同步推送：
         │                              ▼
         │              ┌──────────────────────────────────┐
         │              │ 遍历运行中 session               │
         │              │ yield {type:'snapshot',          │
         │              │   sessionId, messageId, parts}   │
         │              └──────────────┬───────────────────┘
         ▼                             ▼
┌──────────────────────────────────────────────────────────┐
│ client 处理 snapshot 事件（用 messageId 定位）:           │
│  - 若已有 msg(id=messageId): 更新 parts                   │
│  - 否则: 新建 assistant msg(id=messageId, streaming)      │
└──────────────────────────┬───────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────┐
│ 后续 chunk 到达: 仅对 status==streaming 的 msg 追加        │
│ → 无缝续接，不丢失、不重复                                │
└──────────────────────────────────────────────────────────┘
```

### 3. Snapshot 生命周期时序

```
time ─────────────────────────────────────────────────────────▶

message-start{M}
   │
   ├── snapshot[s] = []   currentMsgId[s] = M
   │
   ▼
streaming
   ├── chunk 1 ──▶ snapshot[s] = reduceStreamChunk([], c1)
   ├── chunk 2 ──▶ snapshot[s] = reduceStreamChunk(..., c2)
   │      ▲
   │      └── 新订阅者上线 → 推送 snapshot{M, parts}
   ├── chunk 3 ──▶ snapshot 更新
   │
   ▼
step 完成
   │
   ├── core: onStepFinish 保存完整 assistant msg(id=M) 到 JSONL
   │  （多步时下一步会 emit 新的 message-start{M2}，重置 snapshot）
   │
   ▼
run finally
   │
   └── clear snapshot[s]、currentMsgId[s]
```

## 组件设计

### core：新增 `message-start` 事件

**`packages/core/src/types.ts`** — `AgentStreamChunk` 增加：

```typescript
  | { type: 'message-start'; step: number; messageId: string }
```

**`packages/core/src/stream/agent-stream.ts`** — `AgentStreamController` 增加方法：

```typescript
messageStart(messageId: string, step: number): void {
  if (this.finished) return;
  this.enqueue({ type: 'message-start', step, messageId });
}
```

**发出时机**：在 assistant message 被创建时。

- `turn.ts`：第一条 assistant placeholder 在 `run()` 内创建后（当前 `turn.ts:51-53`），调用 `controller.messageStart(assistantMsg.id, 1)`。
- `loop-strategy.ts`：`getOrCreateAssistantMessage` 新建（非复用）分支里，需要能拿到 controller 和 step。把 controller/step 传入或在 `iterate()` 内新建后调用 `controller.messageStart(msg.id, step)`。

> 复用已有 assistant message（第一步复用 turn 创建的那条）时**不重复发** message-start。只有真正新建 message 才发。

### bridge：`streaming-snapshots.ts`（新增）

按 sessionId 保存当前 streaming message 的 id 和累积 parts（纯内存）：

```typescript
import type { ContentPart } from 'rem-agent-core';

interface SnapshotEntry {
  messageId: string;
  parts: ContentPart[];
}

class StreamingSnapshots {
  private map = new Map<string, SnapshotEntry>();

  start(sessionId: string, messageId: string): void {
    this.map.set(sessionId, { messageId, parts: [] });
  }

  update(sessionId: string, parts: ContentPart[]): void {
    const entry = this.map.get(sessionId);
    if (entry) entry.parts = parts;
  }

  get(sessionId: string): SnapshotEntry | undefined {
    return this.map.get(sessionId);
  }

  clear(sessionId: string): void {
    this.map.delete(sessionId);
  }

  runningSessionIds(): string[] {
    return [...this.map.keys()];
  }
}

const globalKey = Symbol.for('rem.streaming-snapshots');
export const streamingSnapshots: StreamingSnapshots =
  (globalThis as Record<symbol, StreamingSnapshots>)[globalKey]
  ?? ((globalThis as Record<symbol, StreamingSnapshots>)[globalKey] = new StreamingSnapshots());
```

### bridge：`types.ts` 新增 snapshot 事件

```typescript
export type BusEvent =
  | { workspace: string; sessionId: string; type: 'chunk'; chunk: AgentStreamChunk }
  | { workspace: string; sessionId: string; type: 'session-start' }
  | { workspace: string; sessionId: string; type: 'session-end' }
  | { workspace: string; sessionId: string; type: 'session-error'; error: string }
  | { workspace: string; sessionId: string; type: 'activity-change'; activity: SessionActivity }
  | { workspace: string; sessionId: string; type: 'snapshot'; messageId: string; parts: ContentPart[] };
```

### bridge：`AgentService.run()`

```typescript
for await (const chunk of result.stream.fullStream) {
  yield chunk;
  self.activityTracker.applyChunk(sessionId, chunk);

  if (chunk.type === 'message-start') {
    streamingSnapshots.start(sessionId, chunk.messageId);
  } else if (isContentChunk(chunk)) {
    const entry = streamingSnapshots.get(sessionId);
    if (entry) {
      streamingSnapshots.update(sessionId, reduceStreamChunk(entry.parts, chunk));
    }
  }

  bus.publish({ workspace, sessionId, type: 'chunk', chunk });
  ...
}

// finally
result.output.catch(() => {}).finally(() => {
  runRegistry.remove(sessionId);
  streamingSnapshots.clear(sessionId);
  self.activityTracker.finish(sessionId);
});
```

`isContentChunk`（沿用之前删除的白名单）：

```typescript
function isContentChunk(chunk: AgentStreamChunk): boolean {
  return chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' ||
    chunk.type === 'tool-call' || chunk.type === 'tool-result' ||
    chunk.type === 'text-start' || chunk.type === 'reasoning-start' ||
    chunk.type === 'tool-call-start' || chunk.type === 'tool-result-start';
}
```

### bridge：`AgentService.stream()`（快照/增量原子性）

订阅与读取 snapshot 之间**不能有 await**，保证不漏不重：

```typescript
async *stream(): AsyncIterable<BusEvent> {
  const queue: BusEvent[] = [];
  let resolveNext: ((event: BusEvent) => void) | null = null;

  // 1. 先同步订阅，后续事件进入 queue
  const unsub = bus.subscribe((event) => {
    if (event.workspace !== this.workspace) return;
    if (resolveNext) { resolveNext(event); resolveNext = null; }
    else { queue.push(event); }
  });

  try {
    // 2. 同步读取并 yield 当前 snapshot（与 subscribe 之间无 await）
    const snapshotEvents: BusEvent[] = [];
    for (const sessionId of streamingSnapshots.runningSessionIds()) {
      const entry = streamingSnapshots.get(sessionId);
      if (entry && entry.parts.length > 0) {
        snapshotEvents.push({
          workspace: this.workspace, sessionId,
          type: 'snapshot', messageId: entry.messageId, parts: entry.parts,
        });
      }
    }
    for (const ev of snapshotEvents) yield ev;

    // 3. 消费 queue + 后续事件
    while (true) {
      if (queue.length > 0) yield queue.shift()!;
      else yield await new Promise<BusEvent>((r) => { resolveNext = r; });
    }
  } finally {
    unsub();
  }
}
```

**原子性说明**：JS 单线程，`bus.subscribe` 到 `streamingSnapshots.get` 之间同步无 await，中间不会有新 chunk 被 `run()` 处理。snapshot 反映订阅时刻状态，订阅后到达的 chunk 进入 queue，严丝合缝。

### web：`use-agents.ts`

**统一事件处理 + messageId 定位**

把 bus 事件处理体抽为 `handleEvent(event)`。核心用 messageId 定位 message：

```typescript
// message-start chunk：确保存在一条 streaming assistant msg
function ensureAssistantMessage(state, messageId) {
  const existing = state.messages.find(m => m.id === messageId);
  if (existing) return;
  state.messages = [...state.messages, {
    id: messageId, role: 'assistant', parts: [], status: 'streaming',
  }];
}

// snapshot 事件
case 'snapshot': {
  if (!state) { bufferEvent(event); return; }
  ensureAssistantMessage(state, event.messageId);
  state.messages = state.messages.map(m =>
    m.id === event.messageId && m.status === 'streaming'
      ? { ...m, parts: event.parts } : m);
  notifyChange();
  break;
}

// chunk 事件：仅对 streaming 的目标 msg 追加
case 'chunk': {
  if (!state) { bufferEvent(event); return; }
  const chunk = event.chunk;
  if (chunk.type === 'message-start') {
    ensureAssistantMessage(state, chunk.messageId);
    currentMsgIdRef.current.set(event.sessionId, chunk.messageId);
  } else {
    const msgId = currentMsgIdRef.current.get(event.sessionId);
    state.messages = state.messages.map(m =>
      m.id === msgId && m.status === 'streaming'
        ? { ...m, parts: reduceStreamChunk(m.parts, chunk),
            status: chunk.type === 'finish' ? 'done' : chunk.type === 'error' ? 'error' : 'streaming' }
        : m);
  }
  // activity/status 更新逻辑保持
  notifyChange();
  break;
}
```

> `done` 或持久化来的 msg 不匹配 `status==='streaming'`，因此不会被 chunk 修改，杜绝重复拼接。

**修复未初始化 session 的事件丢弃（bufferEvent）**

```typescript
const pendingEventsRef = useRef<Map<string, BusEvent[]>>(new Map());
const loadingRef = useRef<Set<string>>(new Set());

function bufferEvent(event: BusEvent) {
  const buf = pendingEventsRef.current.get(event.sessionId) ?? [];
  buf.push(event);
  pendingEventsRef.current.set(event.sessionId, buf);
  if (!loadingRef.current.has(event.sessionId)) {
    loadingRef.current.add(event.sessionId);
    ensureSession(event.sessionId).then(() => {
      loadingRef.current.delete(event.sessionId);
      const pending = pendingEventsRef.current.get(event.sessionId) ?? [];
      pendingEventsRef.current.delete(event.sessionId);
      for (const e of pending) handleEvent(e); // 原始顺序 replay
    });
  }
}
```

- buffer 保存完整事件序列（含 `message-start` chunk、content chunk、snapshot）。
- `ensureSession` 幂等（已有 `if (map.has) return`），`loadingRef` 去重并发。
- flush 时按原始顺序走 `handleEvent`，靠 messageId + `status==='streaming'` 保证幂等；若 `getMessages` 已返回 done 的同 id msg，则后续该 msg 的 chunk 不再拼接。

**refreshSession 合并（防止覆盖正在流式的 msg）**

```typescript
const refreshSession = async (sessionId) => {
  const persisted = await agentService.getMessages(sessionId);
  const state = sessionMapRef.current.get(sessionId);
  if (!state) return;
  const persistedIds = new Set(persisted.map(m => m.id));
  // 保留正在 streaming 且尚未落盘的 msg
  const streamingTail = state.messages.filter(
    m => m.status === 'streaming' && !persistedIds.has(m.id));
  state.messages = [...persisted.map(m => ({ ...m, status: 'done' })), ...streamingTail];
  notifyChange();
};
```

### `getMessages()` 不改

`AgentSessionManager.getMessages()` 仍只返回 JSONL 持久化内容，status 视为 done。snapshot 完全走 bus 通道，二者分离。

## 边界情况

| 场景 | 处理 |
|---|---|
| 刷新时 run 已结束 | snapshot 已清理，stream() 不推送；getMessages 返回完整持久化内容 |
| 刷新时 run 在 loading（还没 chunk） | snapshot parts 为空，stream() 跳过推送；message-start 到达时 web 建空 streaming msg |
| 刷新时 run 在 tool 执行阶段 | snapshot 含 tool-call parts，推送后 web 展示 tool-call |
| 多步 ReAct 中刷新 | 已完成步在 JSONL（getMessages 返回，done）；当前步靠 snapshot（messageId 唯一），拼接不冲突 |
| 从未打开的后台 session 收到 chunk | bufferEvent 缓存 + ensureSession，加载后按序 flush，不丢弃 |
| 流式结束后 refreshSession | 持久化含该 messageId → 用 done 版本；streaming 版本因 id 已存在被替换，不重复 |
| Agent 重启 | snapshot 丢失，只展示 JSONL 最后完整 step |

## 错误处理

- `streamingSnapshots.get` 返回 undefined 或 parts 空时，`stream()` 不推送 snapshot。
- `reduceStreamChunk` 异常时跳过该 chunk 的 snapshot 更新（不影响 bus 广播）。
- `bufferEvent` 的 `ensureSession` 失败时，pending 事件丢弃并清理 loading 标记，避免泄漏。

## 测试策略

1. **core 测试**：创建 assistant message 时发出 `message-start` 且 messageId == message.id；复用不重复发。
2. **streaming-snapshots 单元测试**：start/update/get/clear/runningSessionIds 行为。
3. **AgentService.run 测试**：message-start 重置 snapshot；content chunk 更新 snapshot；run 结束清理。
4. **AgentService.stream 测试**：新订阅者先收到运行中 session 的 snapshot（带 messageId），再收到后续 chunk，无重复无遗漏。
5. **事件丢弃修复测试**：未初始化 session 连续发 message-start + 多个 chunk，验证 flush 后全部处理，无丢失、无重复。
6. **web refreshSession 合并测试**：持久化含/不含流式 messageId 两种情况，验证不覆盖、不重复。

## 影响范围

- `packages/core/src/types.ts`（新增 `message-start` chunk 类型）
- `packages/core/src/stream/agent-stream.ts`（`messageStart` 方法）
- `packages/core/src/turn.ts`（第一条 assistant msg 发 message-start）
- `packages/core/src/loop-strategy.ts`（新建 assistant msg 发 message-start）
- `packages/bridge/src/streaming-snapshots.ts`（新增）
- `packages/bridge/src/types.ts`（新增 `snapshot` 事件）
- `packages/bridge/src/agent.ts`（run 维护 snapshot、stream 推送、finally 清理）
- `packages/web/src/lib/use-agents.ts`（message-start/snapshot 处理、messageId 定位、bufferEvent、refreshSession 合并）
- 相关测试文件

---
