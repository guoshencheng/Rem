# Streaming 续接实现计划（方案 B + messageId 链路）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 页面刷新后能续接 Agent 正在生成的内容，不丢失、不重复，通过 messageId 贯穿 core→bridge→web。

**Architecture:** core 新增 `message-start` stream 事件携带 assistant message id；bridge 内存维护 streaming snapshot（按 messageId），bus 新订阅者上线时推送 snapshot；web 用 messageId 定位 message、修复未初始化 session 的事件丢弃、refreshSession 合并保留流式消息。core 持久化逻辑不变。

**Tech Stack:** TypeScript, Node.js, vitest, Next.js/React（web）

---

## 文件结构

```
packages/core/src/
├── types.ts                      # 修改：AgentStreamChunk 增加 message-start
├── stream/agent-stream.ts        # 修改：messageStart() 方法
├── turn.ts                       # 修改：第一条 assistant msg 发 message-start
└── loop-strategy.ts              # 修改：新建 assistant msg 发 message-start

packages/bridge/src/
├── streaming-snapshots.ts        # 新增：内存 snapshot 存储
├── types.ts                      # 修改：BusEvent 增加 snapshot
└── agent.ts                      # 修改：run 维护 snapshot、stream 推送、finally 清理

packages/web/src/lib/
└── use-agents.ts                 # 修改：message-start/snapshot 处理、bufferEvent、refreshSession 合并

tests:
packages/core/tests/agent-stream.test.ts        # 修改：message-start 测试
packages/bridge/tests/streaming-snapshots.test.ts # 新增
packages/bridge/tests/agent-service-stream.test.ts # 新增：snapshot 推送
```

---

## Task 1: core 新增 `message-start` chunk 类型与 controller 方法

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/stream/agent-stream.ts`
- Test: `packages/core/tests/agent-stream.test.ts`

- [ ] **Step 1: 写失败测试**

在 `packages/core/tests/agent-stream.test.ts` 的 describe 内追加：

```typescript
  it('emits message-start with messageId', async () => {
    const controller = new AgentStreamController();
    controller.messageStart('msg-1', 1);
    controller.append({ type: 'text-delta', step: 1, text: 'hi' });
    controller.finish({ content: 'done', completed: true });

    const chunks = [];
    for await (const chunk of controller.stream.fullStream) {
      chunks.push(chunk);
    }

    const ms = chunks.find(c => c.type === 'message-start') as { type: 'message-start'; step: number; messageId: string } | undefined;
    expect(ms).toBeDefined();
    expect(ms!.messageId).toBe('msg-1');
    expect(ms!.step).toBe(1);
    expect(chunks[0].type).toBe('message-start');
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/core/tests/agent-stream.test.ts`
Expected: FAIL，`controller.messageStart is not a function`。

- [ ] **Step 3: 增加类型**

在 `packages/core/src/types.ts` 的 `AgentStreamChunk` 联合类型中，`step-start` 之后加入一行：

```typescript
  | { type: 'message-start'; step: number; messageId: string }
```

- [ ] **Step 4: 增加 controller 方法**

在 `packages/core/src/stream/agent-stream.ts` 的 `AgentStreamController` 类中，`stepStart` 方法之前加入：

```typescript
  messageStart(messageId: string, step: number): void {
    if (this.finished) return;
    this.lastStep = step;
    this.enqueue({ type: 'message-start', step, messageId });
  }
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm vitest run packages/core/tests/agent-stream.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/types.ts packages/core/src/stream/agent-stream.ts packages/core/tests/agent-stream.test.ts
git commit -m "feat(core): add message-start stream chunk with messageId"
```

---

## Task 2: core 在创建 assistant message 时发出 message-start

**Files:**
- Modify: `packages/core/src/turn.ts:51-53`
- Modify: `packages/core/src/loop-strategy.ts`
- Test: `packages/core/tests/turn.test.ts`

**Context:** 第一条 assistant message 在 `turn.ts:51` 创建；后续步的 assistant message 在 `loop-strategy.ts` 的 `getOrCreateAssistantMessage` 新建。两处都要发 message-start，且复用已有 message 时**不重复发**。

- [ ] **Step 1: 写失败测试**

查看 `packages/core/tests/turn.test.ts` 现有结构，在其 describe 内追加一个测试（若文件用了 mock loopStrategy，参照现有写法）：

```typescript
  it('emits message-start for the first assistant message', async () => {
    const controller = new AgentStreamController();
    const runner = new ReactTurnRunner({
      async iterate(_ctx, _hooks, _controller, _step) {
        return { content: 'hi', newMessages: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, inputTokenDetails: {}, outputTokenDetails: {} } };
      },
    });

    const runPromise = runner.run(
      {
        input: { content: 'hello' },
        conversation: [],
        systemPrompt: 'x',
        budget: new IterationBudget({ maxTurns: 10 }),
        workspaceRoot: '/tmp',
      } as any,
      { onMessageAdded: () => {}, onToolCallRecorded: () => {} },
      controller,
    );

    await runPromise;
    controller.finish({ content: 'hi', completed: true });

    const chunks = [];
    for await (const chunk of controller.stream.fullStream) chunks.push(chunk);
    const ms = chunks.filter(c => c.type === 'message-start');
    expect(ms).toHaveLength(1);
    expect((ms[0] as any).messageId).toBeDefined();
  });
```

> 检查 `turn.test.ts` 顶部已有的 import；如缺 `AgentStreamController`、`IterationBudget`、`ReactTurnRunner`，按现有测试补齐。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/core/tests/turn.test.ts`
Expected: FAIL，message-start 数量为 0。

- [ ] **Step 3: turn.ts 发出第一条 message-start**

在 `packages/core/src/turn.ts` 第 51-53 行：

```typescript
    const assistantMsg: ModelMessage = { id: generateId(), role: 'assistant', content: [] };
    state.addMessage(assistantMsg);
    hooks.onMessageAdded(assistantMsg);
    controller.messageStart(assistantMsg.id, 1);
```

- [ ] **Step 4: loop-strategy 新建时发出 message-start**

在 `packages/core/src/loop-strategy.ts`，把 `getOrCreateAssistantMessage` 改为接收 controller 和 step，并在新建时发出：

找到（约 226-232 行）：

```typescript
  private getOrCreateAssistantMessage(state: AgentState): ModelMessage {
    const last = state.conversation[state.conversation.length - 1];
    if (last?.role === 'assistant') return last as ModelMessage;
    const msg: ModelMessage = { id: generateId(), role: 'assistant', content: [] };
    state.addMessage(msg);
    return msg;
  }
```

改为：

```typescript
  private getOrCreateAssistantMessage(state: AgentState, controller: AgentStreamController, step: number): ModelMessage {
    const last = state.conversation[state.conversation.length - 1];
    if (last?.role === 'assistant') return last as ModelMessage;
    const msg: ModelMessage = { id: generateId(), role: 'assistant', content: [] };
    state.addMessage(msg);
    controller.messageStart(msg.id, step);
    return msg;
  }
```

并更新调用点（约第 80 行）：

```typescript
    const assistantMsg = this.getOrCreateAssistantMessage(ctx.state, controller, step);
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm vitest run packages/core/tests/turn.test.ts`
Expected: PASS

- [ ] **Step 6: 全量 core 测试与类型检查**

Run: `pnpm --filter rem-agent-core typecheck && pnpm vitest run packages/core`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add packages/core/src/turn.ts packages/core/src/loop-strategy.ts packages/core/tests/turn.test.ts
git commit -m "feat(core): emit message-start when assistant message is created"
```

---

## Task 3: bridge 新增 StreamingSnapshots 模块

**Files:**
- Create: `packages/bridge/src/streaming-snapshots.ts`
- Test: `packages/bridge/tests/streaming-snapshots.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `packages/bridge/tests/streaming-snapshots.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { streamingSnapshots } from '../src/streaming-snapshots.js';
import type { ContentPart } from 'rem-agent-core';

describe('streamingSnapshots', () => {
  beforeEach(() => {
    for (const id of streamingSnapshots.runningSessionIds()) {
      streamingSnapshots.clear(id);
    }
  });

  it('starts, updates, gets and clears a snapshot', () => {
    streamingSnapshots.start('s1', 'm1');
    expect(streamingSnapshots.get('s1')).toEqual({ messageId: 'm1', parts: [] });

    const parts: ContentPart[] = [{ type: 'text', text: 'hi' }];
    streamingSnapshots.update('s1', parts);
    expect(streamingSnapshots.get('s1')).toEqual({ messageId: 'm1', parts });

    streamingSnapshots.clear('s1');
    expect(streamingSnapshots.get('s1')).toBeUndefined();
  });

  it('start resets parts for a new message', () => {
    streamingSnapshots.start('s1', 'm1');
    streamingSnapshots.update('s1', [{ type: 'text', text: 'a' }]);
    streamingSnapshots.start('s1', 'm2');
    expect(streamingSnapshots.get('s1')).toEqual({ messageId: 'm2', parts: [] });
  });

  it('lists running session ids', () => {
    streamingSnapshots.start('s1', 'm1');
    streamingSnapshots.start('s2', 'm2');
    expect(streamingSnapshots.runningSessionIds().sort()).toEqual(['s1', 's2']);
  });

  it('update on unknown session is a no-op', () => {
    streamingSnapshots.update('missing', [{ type: 'text', text: 'x' }]);
    expect(streamingSnapshots.get('missing')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/bridge/tests/streaming-snapshots.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现模块**

创建 `packages/bridge/src/streaming-snapshots.ts`：

```typescript
import type { ContentPart } from 'rem-agent-core';

export interface SnapshotEntry {
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

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run packages/bridge/tests/streaming-snapshots.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/bridge/src/streaming-snapshots.ts packages/bridge/tests/streaming-snapshots.test.ts
git commit -m "feat(bridge): add StreamingSnapshots in-memory store"
```

---

## Task 4: bridge types 增加 snapshot 事件

**Files:**
- Modify: `packages/bridge/src/types.ts`

- [ ] **Step 1: 增加事件类型**

在 `packages/bridge/src/types.ts` 的 `BusEvent` 联合类型末尾增加一行（注意 `ContentPart` 已在文件顶部 import）：

```typescript
  | { workspace: string; sessionId: string; type: 'snapshot'; messageId: string; parts: ContentPart[] };
```

将原本 `activity-change` 那一行末尾的 `;` 改为 `|`，保证联合类型语法正确。最终形如：

```typescript
export type BusEvent =
  | { workspace: string; sessionId: string; type: 'chunk'; chunk: AgentStreamChunk }
  | { workspace: string; sessionId: string; type: 'session-start' }
  | { workspace: string; sessionId: string; type: 'session-end' }
  | { workspace: string; sessionId: string; type: 'session-error'; error: string }
  | { workspace: string; sessionId: string; type: 'activity-change'; activity: SessionActivity }
  | { workspace: string; sessionId: string; type: 'snapshot'; messageId: string; parts: ContentPart[] };
```

- [ ] **Step 2: 类型检查**

Run: `pnpm --filter rem-agent-bridge typecheck`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add packages/bridge/src/types.ts
git commit -m "feat(bridge): add snapshot bus event type"
```

---

## Task 5: bridge AgentService 维护并推送 snapshot

**Files:**
- Modify: `packages/bridge/src/agent.ts`
- Test: `packages/bridge/tests/agent-service-stream.test.ts`

**Context:** `run()` 消费 stream 时，遇到 `message-start` 调 `streamingSnapshots.start`，遇到内容 chunk 调 `update`；`finally` 里 `clear`。`stream()` 订阅后同步推送当前运行中 session 的 snapshot。

- [ ] **Step 1: 写失败测试**

创建 `packages/bridge/tests/agent-service-stream.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { streamingSnapshots } from '../src/streaming-snapshots.js';
import { bus } from '../src/broadcast-bus.js';
import type { BusEvent } from '../src/types.js';

describe('AgentService.stream snapshot push', () => {
  beforeEach(() => {
    for (const id of streamingSnapshots.runningSessionIds()) streamingSnapshots.clear(id);
  });

  it('pushes current snapshot to a new subscriber before subsequent chunks', async () => {
    // 模拟一个正在运行、已有部分内容的 session
    streamingSnapshots.start('s1', 'm1');
    streamingSnapshots.update('s1', [{ type: 'text', text: 'hello' }]);

    // 直接验证 snapshot 推送逻辑：构造一个 stream 消费器
    const received: BusEvent[] = [];
    const service = makeServiceForWorkspace('default');
    const iterator = service.stream()[Symbol.asyncIterator]();

    // 第一个事件应是 snapshot
    const first = await iterator.next();
    received.push(first.value as BusEvent);

    expect(first.value).toMatchObject({
      type: 'snapshot',
      sessionId: 's1',
      messageId: 'm1',
      parts: [{ type: 'text', text: 'hello' }],
    });

    // 之后 publish 一个 chunk，应能收到
    queueMicrotask(() => bus.publish({ workspace: 'default', sessionId: 's1', type: 'session-end' }));
    const second = await iterator.next();
    expect((second.value as BusEvent).type).toBe('session-end');
  });
});
```

在文件顶部加一个构造 helper（避免依赖完整 ProviderManager）：

```typescript
import { AgentService } from '../src/agent.js';
import type { ProviderManager } from 'rem-agent-core';

function makeServiceForWorkspace(workspace: string): AgentService {
  // stream() 只用到 this.workspace，用最小桩即可
  const pmStub = {} as unknown as ProviderManager;
  const service = Object.create(AgentService.prototype) as AgentService;
  (service as unknown as { workspace: string }).workspace = workspace;
  return service;
}
```

> 说明：`stream()` 只依赖 `this.workspace` 与全局 `bus`/`streamingSnapshots`，因此可用 `Object.create` 绕过构造函数，避免搭建完整 ProviderManager。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/bridge/tests/agent-service-stream.test.ts`
Expected: FAIL，`stream()` 尚未推送 snapshot。

- [ ] **Step 3: 修改 run() 维护 snapshot**

在 `packages/bridge/src/agent.ts` 顶部 import 增加：

```typescript
import { streamingSnapshots } from './streaming-snapshots.js';
import { reduceStreamChunk } from './stream-reducer.js';
```

在 `run()` 的 `for await (const chunk of result.stream.fullStream)` 循环体内，`self.activityTracker.applyChunk(...)` 之后、`bus.publish(...)` 之前插入：

```typescript
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
```

在 `result.output.catch(...).finally(...)` 内增加清理：

```typescript
    result.output.catch(() => {}).finally(() => {
      runRegistry.remove(sessionId);
      streamingSnapshots.clear(sessionId);
      self.activityTracker.finish(sessionId);
    });
```

在文件底部（class 外）加入 `isContentChunk` 辅助函数：

```typescript
function isContentChunk(chunk: AgentStreamChunk): boolean {
  return chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' ||
    chunk.type === 'tool-call' || chunk.type === 'tool-result' ||
    chunk.type === 'text-start' || chunk.type === 'reasoning-start' ||
    chunk.type === 'tool-call-start' || chunk.type === 'tool-result-start';
}
```

> `AgentStreamChunk` 已在 agent.ts 顶部 import。

- [ ] **Step 4: 修改 stream() 推送 snapshot**

把 `packages/bridge/src/agent.ts` 的 `stream()` 方法替换为：

```typescript
  async *stream(): AsyncIterable<BusEvent> {
    const queue: BusEvent[] = [];
    let resolveNext: ((event: BusEvent) => void) | null = null;

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
      // 订阅后同步读取快照，与 subscribe 之间无 await，保证不漏不重
      const snapshotEvents: BusEvent[] = [];
      for (const sessionId of streamingSnapshots.runningSessionIds()) {
        const entry = streamingSnapshots.get(sessionId);
        if (entry && entry.parts.length > 0) {
          snapshotEvents.push({
            workspace: this.workspace,
            sessionId,
            type: 'snapshot',
            messageId: entry.messageId,
            parts: entry.parts,
          });
        }
      }
      for (const ev of snapshotEvents) {
        yield ev;
      }

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
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm vitest run packages/bridge/tests/agent-service-stream.test.ts`
Expected: PASS

- [ ] **Step 6: bridge 类型检查与全量测试**

Run: `pnpm --filter rem-agent-bridge typecheck && pnpm vitest run packages/bridge`
Expected: PASS（agent-service-approval 的 ENOTEMPTY 若偶发，重跑一次）

- [ ] **Step 7: 提交**

```bash
git add packages/bridge/src/agent.ts packages/bridge/tests/agent-service-stream.test.ts
git commit -m "feat(bridge): maintain and push streaming snapshot on new subscriber"
```

---

## Task 6: web 端消费 message-start / snapshot 并修复事件丢弃

**Files:**
- Modify: `packages/web/src/lib/use-agents.ts`

**Context:** web 无测试基础设施，改动通过 `pnpm --filter rem-agent-web typecheck`（若存在）与手动验证保证。核心：用 messageId 定位 message，未初始化 session 事件走 buffer，refreshSession 保留流式消息。

- [ ] **Step 1: 增加 refs 与 handleEvent 抽取**

在 `useAgents` 内、`useEffect` 订阅之前，增加：

```typescript
  const currentMsgIdRef = useRef<Map<string, string>>(new Map());
  const pendingEventsRef = useRef<Map<string, BusEvent[]>>(new Map());
  const loadingRef = useRef<Set<string>>(new Set());
```

- [ ] **Step 2: 增加 ensureAssistantMessage 与 bufferEvent 辅助**

在 `useAgents` 内定义（`ensureSession` 之后）：

```typescript
  const ensureAssistantMessage = useCallback((state: SessionState, messageId: string) => {
    if (state.messages.some((m) => m.id === messageId)) return;
    state.messages = [...state.messages, {
      id: messageId,
      role: 'assistant',
      parts: [],
      status: 'streaming',
    }];
  }, []);

  const bufferEvent = useCallback((event: BusEvent) => {
    const buf = pendingEventsRef.current.get(event.sessionId) ?? [];
    buf.push(event);
    pendingEventsRef.current.set(event.sessionId, buf);
    if (!loadingRef.current.has(event.sessionId)) {
      loadingRef.current.add(event.sessionId);
      ensureSession(event.sessionId).then(() => {
        loadingRef.current.delete(event.sessionId);
        const pending = pendingEventsRef.current.get(event.sessionId) ?? [];
        pendingEventsRef.current.delete(event.sessionId);
        for (const e of pending) handleEventRef.current(e);
      }).catch(() => {
        loadingRef.current.delete(event.sessionId);
        pendingEventsRef.current.delete(event.sessionId);
      });
    }
  }, [ensureSession]);
```

- [ ] **Step 3: 用 ref 持有 handleEvent 以支持 buffer flush 回调**

在 `useAgents` 内增加：

```typescript
  const handleEventRef = useRef<(event: BusEvent) => void>(() => {});
```

- [ ] **Step 4: 重写 bus 订阅的事件处理为 handleEvent**

把现有 `useEffect(() => { const unsubEvent = bus.onEvent((event) => { ... }) ... })` 中的事件处理体抽成 `handleEvent`，并处理 `snapshot` 与 `message-start`。用以下实现替换该 `useEffect` 内的 `onEvent` 回调体：

```typescript
    const handleEvent = (event: BusEvent) => {
      if (event.workspace !== workspace) return;
      const map = sessionMapRef.current;
      let state = map.get(event.sessionId);

      switch (event.type) {
        case 'session-start': {
          if (!state) { bufferEvent(event); return; }
          state.status = 'loading';
          state.activity = state.activity ?? 'pending';
          notifyChange();
          break;
        }
        case 'snapshot': {
          if (!state) { bufferEvent(event); return; }
          ensureAssistantMessage(state, event.messageId);
          state.messages = state.messages.map((m) =>
            m.id === event.messageId && m.status === 'streaming'
              ? { ...m, parts: event.parts }
              : m);
          notifyChange();
          break;
        }
        case 'chunk': {
          if (!state) { bufferEvent(event); return; }
          const chunk = event.chunk;
          if (chunk.type === 'message-start') {
            ensureAssistantMessage(state, chunk.messageId);
            currentMsgIdRef.current.set(event.sessionId, chunk.messageId);
          } else {
            const msgId = currentMsgIdRef.current.get(event.sessionId);
            if (msgId) {
              state.messages = state.messages.map((m) =>
                m.id === msgId && m.status === 'streaming'
                  ? {
                      ...m,
                      parts: reduceStreamChunk(m.parts, chunk),
                      status: chunk.type === 'finish' ? 'done'
                        : chunk.type === 'error' ? 'error'
                        : 'streaming',
                      error: chunk.type === 'error' ? String(chunk.error) : m.error,
                    }
                  : m);
            }
          }
          applyChunkSideEffects(state, event.chunk);
          notifyChange();
          break;
        }
        case 'session-end': {
          if (!state) return;
          state.status = 'done';
          state.activity = 'idle';
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
        case 'activity-change': {
          if (!state) { bufferEvent(event); return; }
          state.activity = event.activity;
          setSessionList((prev) =>
            prev.map((s) => s.sessionId === event.sessionId ? { ...s, activity: event.activity } : s));
          notifyChange();
          break;
        }
      }
    };

    handleEventRef.current = handleEvent;
    const unsubEvent = bus.onEvent(handleEvent);
```

- [ ] **Step 5: 抽出 applyChunkSideEffects（原 chunk 分支里的 activity/approval 逻辑）**

在 `useAgents` 内定义，把原 `case 'chunk'` 里处理 `approval-request` / `approval-resolved` / activity 的逻辑搬进来：

```typescript
  const applyChunkSideEffects = useCallback((state: SessionState, chunk: BusEvent extends { type: 'chunk'; chunk: infer C } ? C : never) => {
    if (chunk.type === 'approval-request') {
      if (!state.pendingApprovals.some((r) => r.approvalId === chunk.request.approvalId)) {
        state.pendingApprovals.push(chunk.request);
      }
    } else if (chunk.type === 'approval-resolved') {
      state.pendingApprovals = state.pendingApprovals.filter((r) => r.approvalId !== chunk.approvalId);
    } else if (chunk.type === 'finish' || chunk.type === 'error') {
      state.status = chunk.type === 'finish' ? 'done' : 'error';
      state.activity = 'idle';
      state.pendingToolCalls.clear();
    } else if (chunk.type === 'reasoning-start' || chunk.type === 'reasoning-delta') {
      state.activity = 'thinking';
    } else if (chunk.type === 'tool-call-start' || chunk.type === 'tool-call') {
      state.activity = 'calling-function';
      state.pendingToolCalls.add(chunk.toolCallId);
    } else if (chunk.type === 'tool-result-start' || chunk.type === 'tool-result' || chunk.type === 'tool-result-finish') {
      state.pendingToolCalls.delete(chunk.toolCallId);
      if (state.pendingToolCalls.size > 0) state.activity = 'calling-function';
    } else if (chunk.type === 'text-start' || chunk.type === 'text-delta') {
      if (state.pendingToolCalls.size === 0) state.activity = 'outputting';
    }
  }, []);
```

> 若上面的条件类型写法在本仓库 TS 配置下报错，改为直接用 `AgentStreamChunk` 类型：`chunk: AgentStreamChunk`，并从 `rem-agent-bridge/client` import 该类型。

- [ ] **Step 6: 修改 refreshSession 合并逻辑**

把 `refreshSession` 替换为保留流式消息的版本：

```typescript
  const refreshSession = useCallback(
    async (sessionId: string) => {
      try {
        const persisted = await agentService.getMessages(sessionId);
        const state = sessionMapRef.current.get(sessionId);
        if (!state) return;
        const persistedIds = new Set(persisted.map((m) => m.id));
        const streamingTail = state.messages.filter(
          (m) => m.status === 'streaming' && !persistedIds.has(m.id));
        state.messages = [
          ...persisted.map((m) => ({ ...m, status: 'done' as const })),
          ...streamingTail,
        ];
        notifyChange();
      } catch {
        // ignore refresh errors
      }
    },
    [agentService, notifyChange],
  );
```

- [ ] **Step 7: 类型检查**

Run: `pnpm --filter rem-agent-web typecheck 2>/dev/null || pnpm --filter rem-agent-web run build`
Expected: PASS（若 web 无 typecheck script，用 build 验证编译）

- [ ] **Step 8: 提交**

```bash
git add packages/web/src/lib/use-agents.ts
git commit -m "feat(web): resume streaming via message-start/snapshot and fix dropped events"
```

---

## Task 7: 全仓类型检查与测试

**Files:** 全仓

- [ ] **Step 1: 类型检查**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 2: 运行测试**

Run: `pnpm test`
Expected: PASS（`agent-service-approval` 的 ENOTEMPTY 若偶发，重跑）

- [ ] **Step 3: 手动验证 streaming 续接（可选但推荐）**

启动 web，发送一条会较长输出的消息，在生成中刷新页面，确认：
- 刷新后已生成的文字仍在展示。
- 后续 chunk 继续追加，无重复、无丢失。
- 生成结束后再次刷新，展示完整内容且不重复。

---

## Spec 覆盖自检

| Spec 要求 | 对应 Task |
|---|---|
| core 新增 message-start 携带 messageId | Task 1 |
| 创建 assistant message 时发出 message-start（复用不发） | Task 2 |
| bridge 内存 snapshot（按 messageId） | Task 3 |
| snapshot bus 事件 | Task 4 |
| run 维护 snapshot + stream 推送 + finally 清理 | Task 5 |
| stream 快照/增量原子性 | Task 5 Step 4 |
| web 用 messageId 定位、message-start/snapshot 处理 | Task 6 |
| 未初始化 session 事件丢弃修复（bufferEvent） | Task 6 |
| refreshSession 合并保留流式消息 | Task 6 |
| 只对 streaming msg 拼接、done 不改 | Task 6 Step 4 |
| getMessages 不改 | 不涉及 |

---

## 执行方式选择

Plan complete and saved to `docs/superpowers/plans/2026-07-06-streaming-resume-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
