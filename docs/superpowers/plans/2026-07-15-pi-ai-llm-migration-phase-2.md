# pi-ai LLM 迁移 Phase 2：流式事件与循环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `AgentStreamChunk` / `ProviderChunk` 替换为 `AgentStreamEvent = AssistantMessageEvent | RemMetaEvent`，重写 `AgentStreamController`、`ReactLoop`、`AgentLiveState`、Bridge 与 Web 的流式消费，让 UI 直接消费 pi-ai 事件。

**Architecture:** `AgentStreamController` 改为 `AgentEventStreamController`，接受 `AssistantMessageEvent` 和 `RemMetaEvent`，提供 `text`/`usage`/`steps` promise 聚合。`LoopContext` 增加 `stream()`/`generate()` 入口，由 `ReactLoop` 直接消费 `AssistantMessageEventStream` 并实时追加 content block。`AgentLiveState`/`AgentState` 按 pi-ai 事件类型更新 snapshot 和 activity。Bridge 与 Web 按 pi-ai content block 类型渲染。

**Tech Stack:** TypeScript, `@earendil-works/pi-ai`, Next.js 15, React 19, Vitest

---

## File Structure

### 新增文件

| 文件 | 职责 |
|---|---|
| `packages/core/src/stream/agent-event-stream.ts` | 新的 `AgentEventStreamController` |
| `packages/core/src/stream/event-aggregators.ts` | 从 pi-ai 事件聚合 `text` / `usage` / `steps` |
| `packages/core/tests/stream/agent-event-stream.test.ts` | `AgentEventStreamController` 测试 |
| `packages/web/src/lib/pi-event-helpers.ts` | pi-ai 事件类型守卫（`isTextDelta`、`isToolCallEnd` 等） |

### 修改文件

| 文件 | 修改内容 |
|---|---|
| `packages/core/src/types.ts` | 删除旧 `AgentStreamChunk` / `ProviderChunk`；`AgentStream` 的 `fullStream` 改为 `AsyncIterable<AgentStreamEvent>` |
| `packages/core/src/stream/agent-stream.ts` | 重写为 `AgentEventStreamController` 或替换为新文件 |
| `packages/core/src/stream/stream-aggregators.ts` | 从 pi-ai 事件聚合 |
| `packages/core/src/state.ts` | `AgentLiveState.applyChunk` 处理 `AgentStreamEvent` |
| `packages/core/src/agent-state.ts` | `applyChunk` 处理 `AgentStreamEvent` |
| `packages/core/src/bus-events.ts` | snapshot 的 `parts` 改为 pi-ai content blocks；`chunk` 类型改为 `AgentStreamEvent` |
| `packages/core/src/reason/reason.ts` | 直接透传 `AssistantMessageEvent` 到 `emit`；不再转换旧 `ProviderChunk` |
| `packages/core/src/sdk/loop-strategy.ts` | `LoopContext` 增加 `stream` / `generate` |
| `packages/core/src/plugins/loop/react/index.ts` | 消费 `AssistantMessageEventStream` 并实时追加 content block |
| `packages/core/src/run-agent.ts` | 构建 `LoopContext` 时传入 `stream` / `generate` |
| `packages/bridge/src/types.ts` | `UIMessage.parts` 改为 `UiContentBlock[]` |
| `packages/bridge/src/sse.ts` | `parseAgentStreamEvent` 解析 `AgentStreamEvent`；旧 Error 转 `StreamErrorInfo` |
| `packages/bridge/src/stream-reducer.ts` | 从 pi-ai 事件更新 UI 状态 |
| `packages/bridge/src/client.ts` | 导出新类型与守卫 |
| `packages/web/src/lib/types.ts` | pi-ai 类型守卫 |
| `packages/web/src/lib/use-agents.ts` | 基于 `contentIndex` 维护 `contentBlocks` |
| `packages/web/src/components/chat/message-item.tsx` | 按 content blocks 渲染 |
| `packages/web/src/components/chat/tool-call-block.tsx` | 使用 `tool.arguments` / `tool.id`；支持 partial 参数 |
| `packages/web/src/components/chat/reasoning-block.tsx` | 接收 `thinking` 字符串 |

### 删除文件

| 文件 | 说明 |
|---|---|
| `packages/core/src/stream/agent-stream.ts` | 被 `agent-event-stream.ts` 替换 |
| `packages/core/src/stream/stream-aggregators.ts` | 被 `event-aggregators.ts` 替换（或原地重写） |

---

## Task 1: 更新 `types.ts` 删除旧事件类型

**Files:**
- Modify: `packages/core/src/types.ts`

- [ ] **Step 1: 删除 `AgentStreamChunk` 和 `ProviderChunk` 的 LLM 事件部分，保留 `RemMetaEvent`**

```ts
// 旧 AgentStreamChunk 和 ProviderChunk 删除，只保留 RemMetaEvent 兼容
export type AgentStreamChunk = AgentStreamEvent; // 临时别名，Phase 3 删除
export type ProviderChunk = never; // 不再使用
```

- [ ] **Step 2: 更新 `AgentStream` 接口**

```ts
export interface AgentStream {
  fullStream: AsyncIterable<AgentStreamEvent>;
  text: Promise<string>;
  usage: Promise<Usage>;
  steps: Promise<AgentStreamStepResult[]>;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types.ts
 git commit -m "types(core): replace AgentStreamChunk with AgentStreamEvent in Phase 2"
```

---

## Task 2: 创建 `AgentEventStreamController`

**Files:**
- Create: `packages/core/src/stream/agent-event-stream.ts`
- Test: `packages/core/tests/stream/agent-event-stream.test.ts`

- [ ] **Step 1: 编写 `agent-event-stream.ts`**

```ts
import type { AssistantMessageEvent, AssistantMessage } from '@earendil-works/pi-ai';
import type { AgentStreamEvent, RemMetaEvent, AgentStream, AgentOutput, AgentStreamStepResult } from '../types.js';
import { generateId } from '../shared/generate-id.js';

export class AgentEventStreamController {
  private queue: AgentStreamEvent[] = [];
  private resolvers: ((event: AgentStreamEvent) => void)[] = [];
  private _done = false;
  private _error: Error | null = null;
  private textPromise: Promise<string>;
  private usagePromise: Promise<import('@earendil-works/pi-ai').Usage>;
  private stepsPromise: Promise<AgentStreamStepResult[]>;
  private textResolve!: (value: string) => void;
  private usageResolve!: (value: import('@earendil-works/pi-ai').Usage) => void;
  private stepsResolve!: (value: AgentStreamStepResult[]) => void;

  constructor() {
    this.textPromise = new Promise((resolve) => (this.textResolve = resolve));
    this.usagePromise = new Promise((resolve) => (this.usageResolve = resolve));
    this.stepsPromise = new Promise((resolve) => (this.stepsResolve = resolve));
  }

  get stream(): AgentStream {
    return {
      fullStream: this.iterate(),
      text: this.textPromise,
      usage: this.usagePromise,
      steps: this.stepsPromise,
    };
  }

  emit(event: AgentStreamEvent): void {
    if (this._done) return;
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver(event);
    } else {
      this.queue.push(event);
    }
  }

  finish(output: AgentOutput, finalMessage?: AssistantMessage): void {
    if (finalMessage?.usage) this.usageResolve(finalMessage.usage);
    this.textResolve(finalMessage?.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('') ?? '');
    this.stepsResolve([]);
    this.emit({ type: 'finish', output });
    this._done = true;
  }

  fail(error: Error): void {
    this._error = error;
    this.emit({ type: 'error', error: { name: error.name, message: error.message, stack: error.stack } });
    this._done = true;
  }

  pushTitle(title: string): void {
    this.emit({ type: 'session-title', title });
  }

  private async *iterate(): AsyncIterable<AgentStreamEvent> {
    while (!this._done || this.queue.length > 0) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else {
        const event = await new Promise<AgentStreamEvent>((resolve) => this.resolvers.push(resolve));
        yield event;
      }
    }
    if (this._error) throw this._error;
  }
}
```

- [ ] **Step 2: 编写测试**

```ts
import { describe, it, expect } from 'vitest';
import { AgentEventStreamController } from '../../src/stream/agent-event-stream.js';

describe('AgentEventStreamController', () => {
  it('emits pi-ai text_delta events', async () => {
    const controller = new AgentEventStreamController();
    const events: any[] = [];
    controller.emit({ type: 'text_delta', contentIndex: 0, delta: 'hi', partial: {} as any });
    controller.finish({ content: 'hi', completed: true }, { content: [{ type: 'text', text: 'hi' }], usage: { input: 0, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 1, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } as any);
    for await (const event of controller.stream.fullStream) {
      events.push(event);
    }
    expect(events.some((e) => e.type === 'text_delta')).toBe(true);
    expect(await controller.stream.text).toBe('hi');
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/stream/agent-event-stream.ts packages/core/tests/stream/agent-event-stream.test.ts
 git commit -m "feat(stream): add AgentEventStreamController for pi-ai events"
```

---

## Task 3: 更新 `reason.ts` 直接透传 pi-ai 事件

**Files:**
- Modify: `packages/core/src/reason/reason.ts`

- [ ] **Step 1: 修改 `reason()` emit 类型为 `AgentStreamEvent`**

```ts
export interface ReasonParams {
  // ...
  emit: (event: AgentStreamEvent) => void;
}

export async function reason(params: ReasonParams): Promise<ReasonResult> {
  // ... model lookup, context build
  const stream = params.models.stream(model, context, { /* options */ });

  for await (const event of stream) {
    params.emit(event);
  }

  const message = await stream.result();
  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    throw new Error(message.errorMessage ?? `LLM stopped: ${message.stopReason}`);
  }

  return {
    text: message.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join(''),
    reasoning: message.content
      .filter((b): b is { type: 'thinking'; thinking: string } => b.type === 'thinking')
      .map((b) => b.thinking)
      .join('\n') || undefined,
    toolCalls: message.content
      .filter((b): b is { type: 'toolCall'; id: string; name: string; arguments: unknown } => b.type === 'toolCall')
      .map((b) => ({ toolCallId: b.id, toolName: b.name, input: b.arguments })),
    usage: message.usage,
    finishReason: message.stopReason ?? 'stop',
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/reason/reason.ts
 git commit -m "feat(reason): emit pi-ai AssistantMessageEvent directly"
```

---

## Task 4: 更新 `LoopContext` 与 `ReactLoop`

**Files:**
- Modify: `packages/core/src/sdk/loop-strategy.ts`
- Modify: `packages/core/src/plugins/loop/react/index.ts`

- [ ] **Step 1: 更新 `LoopContext` 增加 `stream` / `generate`**

```ts
import type { AssistantMessageEventStream, AssistantMessage, Message } from '@earendil-works/pi-ai';

export interface LoopContext {
  liveState: AgentLiveState;
  system: string;
  messages: Message[];

  stream: () => AssistantMessageEventStream;
  generate: () => Promise<AssistantMessage>;
  execute: (calls: ToolCall[]) => Promise<ToolResult[]>;
  emit: (event: AgentStreamEvent) => void | Promise<void>;

  addMessage: (role: 'assistant' | 'tool') => RemMessage;
  appendContent: (message: Message, block: TextContent | ThinkingContent | ToolCall) => void;
  resolveMessageId?: (message: Message) => string | undefined;

  signal?: AbortSignal;
  maxSteps?: number;
  workspaceRoot: string;
  readOnly?: boolean;
  agentName?: string;
  sessionId?: string;
}
```

- [ ] **Step 2: 重写 `ReactLoop.run`**

```ts
export class ReactLoop implements LoopStrategy {
  async run(ctx: LoopContext): Promise<LoopResult> {
    let content = '';
    let usage = emptyUsage();
    const assistantMsg = this.ensureAssistantMessage(ctx);
    ctx.emit({ type: 'message-start', step: 1, messageId: assistantMsg.messageId });

    let step = 1;
    const maxSteps = ctx.maxSteps ?? DEFAULT_MAX_STEPS;

    while (step <= maxSteps) {
      if (ctx.signal?.aborted) throw new Error('Aborted');
      ctx.emit({ type: 'step-start', step });

      const stream = ctx.stream();
      const toolCalls: ToolCall[] = [];
      for await (const event of stream) {
        ctx.emit(event);
        if (event.type === 'text_delta') content += event.delta;
        if (event.type === 'toolcall_end') {
          toolCalls.push({ toolCallId: event.toolCall.id, toolName: event.toolCall.name, input: event.toolCall.arguments });
        }
      }
      const message = await stream.result();
      usage = addUsage(usage, message.usage ?? emptyUsage());
      this.appendToAssistantMessage(ctx, assistantMsg, message);

      if (toolCalls.length === 0) {
        ctx.emit({ type: 'step-finish', step });
        break;
      }

      await ctx.execute(toolCalls);
      ctx.emit({ type: 'step-finish', step });
      step++;
    }

    return { content, usage };
  }

  private ensureAssistantMessage(ctx: LoopContext): RemMessage {
    const last = ctx.messages[ctx.messages.length - 1];
    if (last?.role === 'assistant') {
      const messageId = ctx.resolveMessageId?.(last) ?? 'unknown';
      return { messageId, message: last };
    }
    return ctx.addMessage('assistant');
  }

  private appendToAssistantMessage(ctx: LoopContext, assistantMsg: RemMessage, message: AssistantMessage): void {
    for (const block of message.content) {
      ctx.appendContent(assistantMsg.message, block);
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/sdk/loop-strategy.ts packages/core/src/plugins/loop/react/index.ts
 git commit -m "feat(react-loop): consume AssistantMessageEventStream directly"
```

---

## Task 5: 更新 `run-agent.ts` 构建新 `LoopContext`

**Files:**
- Modify: `packages/core/src/run-agent.ts`

- [ ] **Step 1: 替换 `AgentStreamController` 为 `AgentEventStreamController` 并传入 `stream`/`generate`**

```ts
import { AgentEventStreamController } from './stream/agent-event-stream.js';

const controller = new AgentEventStreamController();

const loopCtx: LoopContext = {
  // ... existing fields
  stream: () => {
    const model = ctx.models.getModel(effectiveModel.provider, effectiveModel.model);
    if (!model) throw new Error(`Unknown model: ${effectiveModel.provider}/${effectiveModel.model}`);
    const context: Context = {
      systemPrompt: systemPrompt,
      messages: msgs,
      tools: piTools,
    };
    return ctx.models.stream(model, context, {
      apiKey: effectiveModel.apiKey,
      baseURL: effectiveModel.baseURL,
      signal: params.signal,
      maxRetries: 0,
    });
  },
  generate: () => {
    const model = ctx.models.getModel(effectiveModel.provider, effectiveModel.model);
    if (!model) throw new Error(`Unknown model: ${effectiveModel.provider}/${effectiveModel.model}`);
    const context: Context = { systemPrompt, messages: msgs, tools: piTools };
    return ctx.models.complete(model, context, {
      apiKey: effectiveModel.apiKey,
      baseURL: effectiveModel.baseURL,
      signal: params.signal,
      maxRetries: 0,
    });
  },
  emit: (event) => controller.emit(event),
  // ...
};

controller.finish(output, finalAssistantMessage);
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/run-agent.ts
 git commit -m "feat(run-agent): build LoopContext with pi-ai stream and generate"
```

---

## Task 6: 更新 `AgentLiveState` / `AgentState` / `BusEvents`

**Files:**
- Modify: `packages/core/src/state.ts`
- Modify: `packages/core/src/agent-state.ts`
- Modify: `packages/core/src/bus-events.ts`

- [ ] **Step 1: 修改 `state.ts` 的 `applyChunk` 处理 `AgentStreamEvent`**

```ts
applyChunk(event: AgentStreamEvent): void {
  if (event.type === 'text_delta') this.activity = 'outputting';
  else if (event.type === 'thinking_delta') this.activity = 'thinking';
  else if (event.type === 'toolcall_start') {
    this.activity = 'calling-function';
    this.pendingToolCalls.add(event.partial.content[event.contentIndex].id ?? 'unknown');
  }
  // ...
}
```

- [ ] **Step 2: 修改 `bus-events.ts` 的 snapshot 类型**

```ts
export interface BusSnapshotEvent {
  type: 'snapshot';
  // ...
  parts: Array<TextContent | ThinkingContent | ToolCall>;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/state.ts packages/core/src/agent-state.ts packages/core/src/bus-events.ts
 git commit -m "feat(state): apply pi-ai AssistantMessageEvent to live state and bus"
```

---

## Task 7: 更新 Bridge 事件解析与类型

**Files:**
- Modify: `packages/bridge/src/types.ts`
- Modify: `packages/bridge/src/sse.ts`
- Modify: `packages/bridge/src/stream-reducer.ts`
- Modify: `packages/bridge/src/client.ts`

- [ ] **Step 1: 更新 `bridge/src/types.ts`**

```ts
import type { TextContent, ThinkingContent, ToolCall } from '@earendil-works/pi-ai';

export type UiContentBlock = TextContent | ThinkingContent | ToolCall;

export interface UIMessage {
  // ...
  parts: UiContentBlock[];
}

export type ServerStreamEvent = AgentStreamEvent; // re-export from core
```

- [ ] **Step 2: 更新 `sse.ts` 的 `parseAgentStreamEvent`**

```ts
export function parseAgentStreamEvent(data: string): AgentStreamEvent {
  try {
    return JSON.parse(data);
  } catch (err) {
    return { type: 'error', error: { name: 'ParseError', message: String(err) } };
  }
}
```

- [ ] **Step 3: 更新 `stream-reducer.ts` 从 pi-ai 事件更新 UI**

```ts
export function reduceStreamEvent(state: UIState, event: AgentStreamEvent): UIState {
  if (event.type === 'text_delta') {
    // append to contentBlocks[event.contentIndex]
  } else if (event.type === 'toolcall_end') {
    // add ToolCall block
  } else if (event.type === 'thinking_delta') {
    // add/append thinking block
  }
  return state;
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/bridge/src/types.ts packages/bridge/src/sse.ts packages/bridge/src/stream-reducer.ts packages/bridge/src/client.ts
 git commit -m "feat(bridge): adapt SSE and stream reducer to AgentStreamEvent"
```

---

## Task 8: 更新 Web UI 按 content blocks 渲染

**Files:**
- Modify: `packages/web/src/lib/types.ts`
- Modify: `packages/web/src/lib/use-agents.ts`
- Modify: `packages/web/src/components/chat/message-item.tsx`
- Modify: `packages/web/src/components/chat/tool-call-block.tsx`
- Modify: `packages/web/src/components/chat/reasoning-block.tsx`

- [ ] **Step 1: 创建 `packages/web/src/lib/pi-event-helpers.ts`**

```ts
import type { AssistantMessageEvent } from '@earendil-works/pi-ai';

export function isTextDelta(event: AssistantMessageEvent): boolean {
  return event.type === 'text_delta';
}

export function isThinkingDelta(event: AssistantMessageEvent): boolean {
  return event.type === 'thinking_delta';
}

export function isToolCallEnd(event: AssistantMessageEvent): boolean {
  return event.type === 'toolcall_end';
}
```

- [ ] **Step 2: 更新 `use-agents.ts` 基于 `contentIndex` 维护状态**

```ts
type ContentBlocks = Record<number, TextContent | ThinkingContent | ToolCall>;

// in reducer:
if (event.type === 'text_start') {
  state.blocks[event.contentIndex] = { type: 'text', text: '' };
} else if (event.type === 'text_delta') {
  const block = state.blocks[event.contentIndex];
  if (block?.type === 'text') block.text += event.delta;
}
```

- [ ] **Step 3: 更新 `message-item.tsx` 按 block 类型渲染**

```tsx
export function MessageItem({ message }: { message: UIMessage }) {
  return (
    <div>
      {message.parts.map((part, index) => {
        if (part.type === 'text') return <Markdown key={index}>{part.text}</Markdown>;
        if (part.type === 'thinking') return <ReasoningBlock key={index} thinking={part.thinking} />;
        if (part.type === 'toolCall') return <ToolCallBlock key={index} tool={part} />;
        return null;
      })}
    </div>
  );
}
```

- [ ] **Step 4: 更新 `tool-call-block.tsx` 使用 pi-ai ToolCall**

```tsx
export function ToolCallBlock({ tool }: { tool: ToolCall }) {
  return (
    <div>
      <div>{tool.name}</div>
      <pre>{JSON.stringify(tool.arguments, null, 2)}</pre>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/pi-event-helpers.ts packages/web/src/lib/types.ts packages/web/src/lib/use-agents.ts packages/web/src/components/chat/message-item.tsx packages/web/src/components/chat/tool-call-block.tsx packages/web/src/components/chat/reasoning-block.tsx
 git commit -m "feat(web): render messages from pi-ai content blocks"
```

---

## Task 9: 全量验证

- [ ] **Step 1: 类型检查**

```bash
pnpm typecheck
```

- [ ] **Step 2: 测试**

```bash
pnpm test
```

- [ ] **Step 3: 手动验证流式 UI**

```bash
# 启动 web + bridge，运行一次带工具调用的对话，确认 text / thinking / tool-call 流式显示正常
```

- [ ] **Step 4: Commit fixes**

```bash
git add .
 git commit -m "fix(core/bridge/web): Phase 2 pi-ai event stream fixes"
```

---

## Self-Review Checklist

- [ ] `AgentStreamEvent` 是 `AssistantMessageEvent | RemMetaEvent`；
- [ ] `AgentEventStreamController` 能 emit pi-ai 事件和 `RemMetaEvent`；
- [ ] `ReactLoop` 直接消费 `AssistantMessageEventStream`；
- [ ] `AgentLiveState.applyChunk` 按 pi-ai 事件更新 activity；
- [ ] Bridge SSE 能正确序列化/解析 `AgentStreamEvent`；
- [ ] Web 按 `contentIndex` 维护 content blocks，多 block 不合并；
- [ ] `pnpm typecheck` 和 `pnpm test` 全绿。

---

> Next: Phase 3 将删除旧类型、旧文件和 `deprecated/` 目录，完成数据迁移清理。详见 `2026-07-15-pi-ai-llm-migration-phase-3.md`。
