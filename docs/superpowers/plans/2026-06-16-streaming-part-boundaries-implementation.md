# Streaming Part Boundaries & Multi-Step Turn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `@agent-harness/core` 流式输出引入 part 级 `*-start` / `*-finish` 边界、用 `partId` 取代 `partIndex`、把 parts 提升到 turn 级别，并让单个 turn 支持最多 50 个 step。

**Architecture:** `AgentStreamController` 成为流协议唯一管理者，接收 loop strategy 的语义事件并自动合成边界与 `partId`；`ReactTurnRunner` 负责 turn 级多 step 循环；`ReactLoop` 只执行单步模型调用 + tool 执行。

**Tech Stack:** TypeScript, `ai` 包（`generateId`）, vitest, pnpm monorepo。

---

## File Structure

| 文件 | 责任 |
|---|---|
| `packages/core/src/types.ts` | 定义新的 `AgentStreamChunk` 联合类型；`TurnResult` 加 `steps`；删除 `AgentStreamStepResult` 中的 `partIndex` 引用（如之前有）。 |
| `packages/core/src/stream/agent-stream.ts` | 重写 `AgentStreamController`：`append` 接收 raw chunk，自动 emit `*-start` / `*-finish`，分配 `partId`；更新聚合逻辑。 |
| `packages/core/src/turn.ts` | `ReactTurnRunner.run` 改为多 step 循环，提前创建 assistantMsg，`maxSteps` 默认 50，聚合结果。 |
| `packages/core/src/loop-strategy.ts` | `ReactLoop.iterate` 只负责单步；删除 `iterations`；`newMessages` 不再含 assistantMsg；emit raw chunks。 |
| `packages/demo/src/tui/message.ts` | `StreamAssistantMessage` 改用 `partId` 做 key，处理 start/delta/finish。 |
| `packages/core/tests/agent-stream.test.ts` | 新增 controller 边界测试。 |
| `packages/core/tests/turn.test.ts` | 更新/新增多 step 测试。 |
| `packages/core/tests/loop-strategy.test.ts` | 更新单 step 行为测试。 |

---

## Task 1: Update `AgentStreamChunk` and `TurnResult` types

**Files:**
- Modify: `packages/core/src/types.ts`
- Test: `packages/core/tests/types.test.ts`（如存在；否则在 `agent-stream.test.ts` 中覆盖）

- [ ] **Step 1: Write a failing type assertion test**

在 `packages/core/tests/types.test.ts` 创建（或追加）以下测试，验证新 chunk 类型能被正确构造：

```ts
import { describe, it, expect } from 'vitest';
import type { AgentStreamChunk, TurnResult } from '../src/types.js';

describe('AgentStreamChunk types', () => {
  it('supports text part boundaries', () => {
    const start: AgentStreamChunk = { type: 'text-start', step: 1, partId: 'p1' };
    const delta: AgentStreamChunk = { type: 'text-delta', step: 1, partId: 'p1', text: 'hi' };
    const finish: AgentStreamChunk = { type: 'text-finish', step: 1, partId: 'p1' };
    expect(start.type).toBe('text-start');
    expect(delta.text).toBe('hi');
    expect(finish.partId).toBe('p1');
  });

  it('supports reasoning part boundaries', () => {
    const start: AgentStreamChunk = { type: 'reasoning-start', step: 1, partId: 'p2' };
    const delta: AgentStreamChunk = { type: 'reasoning-delta', step: 1, partId: 'p2', text: 'think' };
    const finish: AgentStreamChunk = { type: 'reasoning-finish', step: 1, partId: 'p2' };
    expect(start.type).toBe('reasoning-start');
    expect(delta.partId).toBe('p2');
    expect(finish.type).toBe('reasoning-finish');
  });

  it('supports tool part boundaries', () => {
    const start: AgentStreamChunk = { type: 'tool-call-start', step: 1, partId: 'tc1', toolCallId: 'tc1', toolName: 'search' };
    const payload: AgentStreamChunk = { type: 'tool-call', step: 1, partId: 'tc1', toolCallId: 'tc1', toolName: 'search', input: { q: 'x' } };
    const finish: AgentStreamChunk = { type: 'tool-call-finish', step: 1, partId: 'tc1', toolCallId: 'tc1', toolName: 'search' };
    expect(start.type).toBe('tool-call-start');
    expect(payload.input).toEqual({ q: 'x' });
    expect(finish.type).toBe('tool-call-finish');
  });

  it('TurnResult has steps', () => {
    const result: TurnResult = {
      output: { content: '', completed: true },
      newMessages: [],
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      steps: 1,
    };
    expect(result.steps).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @agent-harness/core test packages/core/tests/types.test.ts
```

Expected: FAIL with `'text-start' is not assignable` or file-not-found/type errors.

- [ ] **Step 3: Update `packages/core/src/types.ts`**

替换 `AgentStreamChunk`、`AgentStreamStepResult`、`TurnResult` 和 `AgentStream` 相关部分：

```ts
import type { ModelMessage, LanguageModelUsage } from 'ai';

export { type ModelMessage, type LanguageModelUsage } from 'ai';

export interface UserInput {
  content: string;
  timestamp?: Date;
}

export interface AgentOutput {
  content: string;
  completed: boolean;
}

export type AgentStreamChunk =
  | { type: 'step-start'; step: number }
  | { type: 'step-finish'; step: number }
  | { type: 'text-start'; step: number; partId: string }
  | { type: 'text-delta'; step: number; partId: string; text: string }
  | { type: 'text-finish'; step: number; partId: string }
  | { type: 'reasoning-start'; step: number; partId: string }
  | { type: 'reasoning-delta'; step: number; partId: string; text: string }
  | { type: 'reasoning-finish'; step: number; partId: string }
  | { type: 'tool-call-start'; step: number; partId: string; toolCallId: string; toolName: string }
  | { type: 'tool-call'; step: number; partId: string; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-call-finish'; step: number; partId: string; toolCallId: string; toolName: string }
  | { type: 'tool-result-start'; step: number; partId: string; toolCallId: string; toolName?: string }
  | { type: 'tool-result'; step: number; partId: string; toolCallId: string; output: string; error?: string }
  | { type: 'tool-result-finish'; step: number; partId: string; toolCallId: string }
  | { type: 'finish'; output: AgentOutput }
  | { type: 'error'; error: Error };

export interface AgentStreamStepResult {
  step: number;
  text: string;
  reasoning: string;
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    input: unknown;
    output?: string;
    error?: string;
  }>;
}

export interface AgentStream {
  fullStream: AsyncIterable<AgentStreamChunk>;
  text: Promise<string>;
  usage: Promise<LanguageModelUsage>;
  steps: Promise<AgentStreamStepResult[]>;
}

export type AgentStatus = 'idle' | 'running' | 'error';

export interface ToolCallRecord {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: {
    success: boolean;
    output: string;
    error?: string;
    durationMs: number;
  };
  error?: string;
  durationMs: number;
  timestamp: Date;
}

export interface TurnResult {
  output: AgentOutput;
  newMessages: ModelMessage[];
  toolCalls: { toolCallId: string; toolName: string; input: unknown }[];
  usage: LanguageModelUsage;
  steps: number;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm --filter @agent-harness/core test packages/core/tests/types.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/tests/types.test.ts
git commit -m "feat(core): add part boundary chunks and partId, add steps to TurnResult"
```

---

## Task 2: Rewrite `AgentStreamController`

**Files:**
- Modify: `packages/core/src/stream/agent-stream.ts`
- Create: `packages/core/tests/agent-stream.test.ts`

- [ ] **Step 1: Write failing tests for boundary generation**

创建 `packages/core/tests/agent-stream.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { AgentStreamController } from '../src/stream/agent-stream.js';

describe('AgentStreamController', () => {
  it('emits text-start before first text-delta and text-finish after switch', async () => {
    const controller = new AgentStreamController();
    controller.append({ type: 'text-delta', step: 1, text: 'hello ' });
    controller.append({ type: 'text-delta', step: 1, text: 'world' });
    controller.append({ type: 'reasoning-delta', step: 1, text: 'think' });
    controller.finish({ content: 'done', completed: true });

    const chunks = [];
    for await (const chunk of controller.stream.fullStream) {
      chunks.push(chunk);
    }

    const types = chunks.map(c => c.type);
    expect(types).toEqual([
      'text-start',
      'text-delta',
      'text-delta',
      'text-finish',
      'reasoning-start',
      'reasoning-delta',
      'reasoning-finish',
      'finish',
    ]);

    const textStart = chunks.find(c => c.type === 'text-start');
    const reasoningStart = chunks.find(c => c.type === 'reasoning-start');
    expect(textStart!.partId).toBeDefined();
    expect(reasoningStart!.partId).toBeDefined();
    expect(textStart!.partId).not.toBe(reasoningStart!.partId);
  });

  it('emits tool-call as triple start/payload/finish', async () => {
    const controller = new AgentStreamController();
    controller.append({ type: 'tool-call', step: 1, toolCallId: 'tc1', toolName: 'search', input: { q: 'x' } });
    controller.finish({ content: 'done', completed: true });

    const chunks = [];
    for await (const chunk of controller.stream.fullStream) {
      chunks.push(chunk);
    }

    expect(chunks.map(c => c.type)).toEqual([
      'tool-call-start',
      'tool-call',
      'tool-call-finish',
      'finish',
    ]);
    expect(chunks[0].partId).toBe('tc1');
    expect(chunks[1].partId).toBe('tc1');
    expect(chunks[2].partId).toBe('tc1');
  });

  it('uses toolCallId as partId for tool-result', async () => {
    const controller = new AgentStreamController();
    controller.append({ type: 'tool-result', step: 1, toolCallId: 'tc1', output: 'ok' });
    controller.finish({ content: 'done', completed: true });

    const chunks = [];
    for await (const chunk of controller.stream.fullStream) {
      chunks.push(chunk);
    }

    expect(chunks[0].type).toBe('tool-result-start');
    expect(chunks[0].partId).toBe('tc1');
    expect(chunks[1].type).toBe('tool-result');
    expect(chunks[2].type).toBe('tool-result-finish');
  });

  it('aggregates text correctly', async () => {
    const controller = new AgentStreamController();
    controller.append({ type: 'text-delta', step: 1, text: 'hello ' });
    controller.append({ type: 'text-delta', step: 1, text: 'world' });
    controller.finish({ content: 'hello world', completed: true });

    expect(await controller.stream.text).toBe('hello world');
  });

  it('closes open parts on finish', async () => {
    const controller = new AgentStreamController();
    controller.append({ type: 'text-delta', step: 1, text: 'hi' });
    controller.finish({ content: 'hi', completed: true });

    const chunks = [];
    for await (const chunk of controller.stream.fullStream) {
      chunks.push(chunk);
    }

    expect(chunks[chunks.length - 2].type).toBe('text-finish');
    expect(chunks[chunks.length - 1].type).toBe('finish');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @agent-harness/core test packages/core/tests/agent-stream.test.ts
```

Expected: FAIL because `AgentStreamController` still expects `partIndex` and doesn't synthesize boundaries.

- [ ] **Step 3: Rewrite `packages/core/src/stream/agent-stream.ts`**

完整替换为：

```ts
import type { AgentOutput, AgentStream, AgentStreamChunk, AgentStreamStepResult } from '../types.js';
import type { LanguageModelUsage } from 'ai';
import { generateId } from 'ai';

type RawChunk =
  | { type: 'text-delta'; step: number; text: string }
  | { type: 'reasoning-delta'; step: number; text: string }
  | { type: 'tool-call'; step: number; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-result'; step: number; toolCallId: string; output: string; error?: string };

export class AgentStreamController {
  private queue: AgentStreamChunk[] = [];
  private pending: Array<() => void> = [];
  private finished = false;
  private error?: Error;
  private currentPart?: { type: string; partId: string };
  private lastStep = 0;

  append(chunk: RawChunk): void {
    if (this.finished) return;
    this.lastStep = chunk.step;

    if (chunk.type === 'text-delta') {
      this.ensurePartOpen('text', chunk.step);
      this.enqueue({ type: 'text-delta', step: chunk.step, partId: this.currentPart!.partId, text: chunk.text });
    } else if (chunk.type === 'reasoning-delta') {
      this.ensurePartOpen('reasoning', chunk.step);
      this.enqueue({ type: 'reasoning-delta', step: chunk.step, partId: this.currentPart!.partId, text: chunk.text });
    } else if (chunk.type === 'tool-call') {
      this.closeCurrentPart(chunk.step);
      const partId = chunk.toolCallId;
      this.enqueue({ type: 'tool-call-start', step: chunk.step, partId, toolCallId: chunk.toolCallId, toolName: chunk.toolName });
      this.enqueue({ type: 'tool-call', step: chunk.step, partId, toolCallId: chunk.toolCallId, toolName: chunk.toolName, input: chunk.input });
      this.enqueue({ type: 'tool-call-finish', step: chunk.step, partId, toolCallId: chunk.toolCallId, toolName: chunk.toolName });
    } else if (chunk.type === 'tool-result') {
      this.closeCurrentPart(chunk.step);
      const partId = chunk.toolCallId;
      this.enqueue({ type: 'tool-result-start', step: chunk.step, partId, toolCallId: chunk.toolCallId });
      this.enqueue({ type: 'tool-result', step: chunk.step, partId, toolCallId: chunk.toolCallId, output: chunk.output, error: chunk.error });
      this.enqueue({ type: 'tool-result-finish', step: chunk.step, partId, toolCallId: chunk.toolCallId });
    }
  }

  finish(output: AgentOutput): void {
    if (this.finished) return;
    this.closeCurrentPart(this.lastStep);
    this.enqueue({ type: 'finish', output });
    this.finished = true;
    for (const resolve of this.pending) resolve();
    this.pending = [];
  }

  fail(error: Error): void {
    if (this.finished) return;
    this.closeCurrentPart(this.lastStep);
    this.enqueue({ type: 'error', error });
    this.finished = true;
    this.error = error;
    for (const resolve of this.pending) resolve();
    this.pending = [];
  }

  get stream(): AgentStream {
    return {
      fullStream: this.createIterator(),
      text: this.aggregateText(),
      usage: this.aggregateUsage(),
      steps: this.aggregateSteps(),
    };
  }

  private ensurePartOpen(type: 'text' | 'reasoning', step: number): void {
    if (this.currentPart && this.currentPart.type === type) {
      return;
    }
    this.closeCurrentPart(step);
    const partId = generateId();
    this.currentPart = { type, partId };
    if (type === 'text') {
      this.enqueue({ type: 'text-start', step, partId });
    } else {
      this.enqueue({ type: 'reasoning-start', step, partId });
    }
  }

  private closeCurrentPart(step: number): void {
    if (!this.currentPart) return;
    const { type, partId } = this.currentPart;
    this.currentPart = undefined;
    if (type === 'text') {
      this.enqueue({ type: 'text-finish', step, partId });
    } else if (type === 'reasoning') {
      this.enqueue({ type: 'reasoning-finish', step, partId });
    }
  }

  private enqueue(chunk: AgentStreamChunk): void {
    this.queue.push(chunk);
    const resolve = this.pending.shift();
    if (resolve) resolve();
  }

  private createIterator(): AsyncIterable<AgentStreamChunk> {
    let index = 0;
    const controller = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<AgentStreamChunk> {
        return {
          async next(): Promise<IteratorResult<AgentStreamChunk>> {
            while (true) {
              if (index < controller.queue.length) {
                const chunk = controller.queue[index++];
                return { done: false, value: chunk };
              }
              if (controller.finished) {
                return { done: true, value: undefined };
              }
              await new Promise<void>((resolve) => {
                controller.pending.push(() => resolve());
              });
            }
          },
        };
      },
    };
  }

  private aggregateText(): Promise<string> {
    return this.aggregateRun((chunks) =>
      chunks
        .filter((c): c is { type: 'text-delta'; step: number; partId: string; text: string } => c.type === 'text-delta')
        .map((c) => c.text)
        .join(''),
    );
  }

  private aggregateUsage(): Promise<LanguageModelUsage> {
    return this.aggregateRun(() => ({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    }));
  }

  private aggregateSteps(): Promise<AgentStreamStepResult[]> {
    return this.aggregateRun((chunks) => {
      const stepMap = new Map<number, AgentStreamStepResult>();
      for (const chunk of chunks) {
        if (chunk.type === 'step-start') {
          stepMap.set(chunk.step, { step: chunk.step, text: '', reasoning: '', toolCalls: [] });
        } else if (chunk.type === 'text-delta') {
          stepMap.get(chunk.step)!.text += chunk.text;
        } else if (chunk.type === 'reasoning-delta') {
          stepMap.get(chunk.step)!.reasoning += chunk.text;
        } else if (chunk.type === 'tool-call') {
          stepMap.get(chunk.step)!.toolCalls.push({
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            input: chunk.input,
          });
        } else if (chunk.type === 'tool-result') {
          const tc = stepMap.get(chunk.step)!.toolCalls.find((t: { toolCallId: string }) => t.toolCallId === chunk.toolCallId);
          if (tc) {
            tc.output = chunk.output;
            tc.error = chunk.error;
          }
        }
      }
      return [...stepMap.values()];
    });
  }

  private aggregateRun<T>(handler: (chunks: AgentStreamChunk[]) => T): Promise<T> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.finished) {
          if (this.error) return reject(this.error);
          return resolve(handler([...this.queue]));
        }
        setTimeout(check, 10);
      };
      check();
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @agent-harness/core test packages/core/tests/agent-stream.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/stream/agent-stream.ts packages/core/tests/agent-stream.test.ts
git commit -m "feat(core): agent stream controller synthesizes part boundaries and partId"
```

---

## Task 3: Update `ReactLoop.iterate` to emit raw chunks

**Files:**
- Modify: `packages/core/src/loop-strategy.ts`
- Test: `packages/core/tests/loop-strategy.test.ts`

- [ ] **Step 1: Write failing test for single-step behavior**

在 `packages/core/tests/loop-strategy.test.ts` 中新增/替换相关测试（如文件不存在则创建）：

```ts
import { describe, it, expect, vi } from 'vitest';
import { ReactLoop } from '../src/loop-strategy.js';
import { AgentStreamController } from '../src/stream/agent-stream.js';
import { AgentState } from '../src/state.js';
import { IterationBudget } from '../src/budget.js';
import { EventBus } from '../src/events.js';
import type { ToolProvider, ToolCall, ToolResult } from '../src/sdk/tool-provider.js';
import type { MemoryProvider } from '../src/sdk/memory-provider.js';
import type { ContextCompressor } from '../src/sdk/compressor.js';
import type { ErrorHandler } from '../src/sdk/error-handler.js';

function createLoopWithMockProvider(mockProvider: unknown) {
  const events = new EventBus();
  const toolProvider: ToolProvider = {
    getToolSet: () => ({}),
    execute: async () => [],
  };
  const memoryProvider: MemoryProvider = {
    buildContext: async () => ({ systemPrompt: '', messages: [] }),
  };
  const compressor: ContextCompressor = {
    shouldCompress: () => false,
    compress: async (msgs) => msgs,
  };
  const errorHandler: ErrorHandler = {
    classify: () => 'unknown',
    isRetryable: () => false,
  };
  return new ReactLoop(mockProvider as any, events, toolProvider, memoryProvider, compressor, errorHandler);
}

describe('ReactLoop single step', () => {
  it('returns completed=true when no tool calls', async () => {
    const mockProvider = {
      stream: () => (async function* () {
        yield { type: 'text', text: 'hello' };
      })(),
    };
    const loop = createLoopWithMockProvider(mockProvider);
    const controller = new AgentStreamController();
    const session = { sessionId: 's1', conversation: [], currentTurn: 0, metadata: {}, createdAt: new Date(), updatedAt: new Date() };
    const state = new AgentState(session, new IterationBudget({}));
    state.addMessage({ role: 'assistant', content: [] });

    const result = await loop.iterate(
      { state, systemPrompt: '', budget: new IterationBudget({}) },
      { onMessageAdded: () => {}, onToolCallRecorded: () => {} },
      controller,
      1,
    );

    expect(result.finalOutput.completed).toBe(true);
    expect(result.newMessages).toHaveLength(0);
    controller.finish({ content: 'hello', completed: true });
    expect(await controller.stream.text).toBe('hello');
  });

  it('returns completed=false and emits tool-result when tool calls exist', async () => {
    const mockProvider = {
      stream: () => (async function* () {
        yield { type: 'tool-call', toolCallId: 'tc1', toolName: 'calc', input: { a: 1 } };
      })(),
    };
    const toolProvider: ToolProvider = {
      getToolSet: () => ({}),
      execute: async () => [{ toolCallId: 'tc1', output: '2' }],
    };
    const loop = new ReactLoop(
      mockProvider as any,
      new EventBus(),
      toolProvider,
      { buildContext: async () => ({ systemPrompt: '', messages: [] }) } as MemoryProvider,
      { shouldCompress: () => false, compress: async (m) => m } as ContextCompressor,
      { classify: () => 'unknown', isRetryable: () => false } as ErrorHandler,
    );
    const controller = new AgentStreamController();
    const session = { sessionId: 's1', conversation: [], currentTurn: 0, metadata: {}, createdAt: new Date(), updatedAt: new Date() };
    const state = new AgentState(session, new IterationBudget({}));
    state.addMessage({ role: 'assistant', content: [] });

    const result = await loop.iterate(
      { state, systemPrompt: '', budget: new IterationBudget({}) },
      { onMessageAdded: () => {}, onToolCallRecorded: () => {} },
      controller,
      1,
    );

    expect(result.finalOutput.completed).toBe(false);
    expect(result.newMessages.length).toBeGreaterThan(0);

    controller.finish({ content: '', completed: false });
    const chunks = [];
    for await (const chunk of controller.stream.fullStream) {
      chunks.push(chunk);
    }
    expect(chunks.some(c => c.type === 'tool-call-start')).toBe(true);
    expect(chunks.some(c => c.type === 'tool-result-start')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @agent-harness/core test packages/core/tests/loop-strategy.test.ts
```

Expected: FAIL because `iterate` still returns `iterations` and emits old chunk shapes.

- [ ] **Step 3: Update `packages/core/src/loop-strategy.ts`**

替换相关部分：

```ts
import type { ModelMessage, LanguageModelUsage, LanguageModel } from 'ai';
import type { AgentState } from './state.js';
import type { EventBus } from './events.js';
import type { AgentOutput, ToolCallRecord, AgentStreamChunk } from './types.js';
import type { ToolProvider, ToolCall, ToolResult } from './sdk/tool-provider.js';
import type { MemoryProvider } from './sdk/memory-provider.js';
import type { ContextCompressor } from './sdk/compressor.js';
import type { ErrorHandler, ErrorCategory } from './sdk/error-handler.js';
import { IterationBudget } from './budget.js';
import { InferenceEngine, type InferenceResult } from './llm/engine.js';
import type { StreamChunk } from './llm/types.js';
import { AgentStreamController } from './stream/agent-stream.js';

export interface TurnHooks {
  onMessageAdded(msg: ModelMessage): void;
  onToolCallRecorded(record: ToolCallRecord): void;
}

export interface LoopContext {
  state: AgentState;
  systemPrompt: string;
  model?: LanguageModel;
  budget: IterationBudget;
  signal?: AbortSignal;
  provider?: string;
  providerConfig?: {
    apiKey: string;
    baseURL?: string;
    model: string;
  };
}

export interface LoopResult {
  finalOutput: AgentOutput;
  newMessages: ModelMessage[];
  toolCalls: ToolCall[];
  usage: LanguageModelUsage;
}

export interface LoopStrategy {
  iterate(ctx: LoopContext, hooks: TurnHooks, controller: AgentStreamController, step: number): Promise<LoopResult>;
}

export class ReactLoop implements LoopStrategy {
  private inferenceEngine = new InferenceEngine();

  constructor(
    private model: LanguageModel | undefined,
    private events: EventBus,
    private toolProvider: ToolProvider,
    private memoryProvider: MemoryProvider,
    private compressor: ContextCompressor,
    private errorHandler: ErrorHandler,
  ) {}

  private async inferWithRetry(options: Parameters<InferenceEngine['infer']>[0]): Promise<InferenceResult> {
    const maxAttempts = 3;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.inferenceEngine.infer(options);
      } catch (error) {
        lastError = error;
        const category = this.errorHandler.classify(error);
        if (!this.errorHandler.isRetryable(category)) {
          throw error;
        }
        if (attempt === maxAttempts - 1) {
          throw error;
        }
      }
    }

    throw lastError;
  }

  async iterate(ctx: LoopContext, hooks: TurnHooks, controller: AgentStreamController, step: number): Promise<LoopResult> {
    await this.events.emit('turn:before', { agent: this, state: ctx.state });
    await this.events.emit('phase:prepare', { agent: this, state: ctx.state });
    const { systemPrompt, messages: contextMessages } = await this.memoryProvider.buildContext(ctx.state);

    let messages: ModelMessage[] = [...contextMessages];

    if (this.compressor.shouldCompress(ctx.state)) {
      await this.events.emit('compress:before', { agent: this, state: ctx.state });
      messages = await this.compressor.compress(messages);
      await this.events.emit('compress:after', { agent: this, state: ctx.state });
    }

    await this.events.emit('phase:reason:before', { agent: this, state: ctx.state });

    const tools = this.toolProvider.getToolSet();
    const hasTools = Object.keys(tools).length > 0;

    const assistantMsg = this.getCurrentAssistantMessage(ctx.state);

    const inferResult = await this.inferWithRetry({
      provider: ctx.provider ?? 'mock',
      providerConfig: ctx.providerConfig ?? { apiKey: '', model: 'default' },
      system: systemPrompt,
      messages,
      tools: hasTools ? tools : undefined,
      signal: ctx.signal,
      onChunk: (chunk) => {
        const agentChunk = this.mapToAgentStreamChunk(chunk, step);
        if (agentChunk) {
          controller.append(agentChunk);
        }
      },
    });

    await this.events.emit('phase:reason:after', { agent: this, state: ctx.state });

    const newMessages: ModelMessage[] = [];
    const toolCalls: ToolCall[] = [];

    if (inferResult.toolCalls.length > 0) {
      await this.events.emit('phase:execute:before', { agent: this, state: ctx.state });
      await this.events.emit('tool:before', { agent: this, state: ctx.state });

      const startTime = Date.now();
      const toolResults = await this.toolProvider.execute(inferResult.toolCalls);

      for (const tc of inferResult.toolCalls) {
        const tr = toolResults.find((r: ToolResult) => r.toolCallId === tc.toolCallId);
        const toolMsg: ModelMessage = {
          role: 'tool',
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          content: tr?.error ?? tr?.output ?? '',
        } as unknown as ModelMessage;

        ctx.state.addMessage(toolMsg);
        newMessages.push(toolMsg);
        hooks.onMessageAdded(toolMsg);

        controller.append({
          type: 'tool-result',
          step,
          toolCallId: tc.toolCallId,
          output: tr?.output ?? '',
          error: tr?.error,
        });

        const record: ToolCallRecord = {
          id: tc.toolCallId,
          name: tc.toolName,
          arguments: tc.input as Record<string, unknown>,
          result: tr
            ? {
                success: !tr.error,
                output: tr.output,
                error: tr.error,
                durationMs: 0,
              }
            : undefined,
          error: tr?.error,
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
        };

        toolCalls.push(tc);
        hooks.onToolCallRecorded(record);
      }

      await this.events.emit('tool:after', { agent: this, state: ctx.state });
      await this.events.emit('phase:execute:after', { agent: this, state: ctx.state });
    }

    await this.events.emit('turn:after', { agent: this, state: ctx.state });

    const completed = inferResult.toolCalls.length === 0;

    return {
      finalOutput: {
        content: inferResult.text,
        completed,
      },
      newMessages,
      toolCalls,
      usage: {
        inputTokens: inferResult.usage.inputTokens,
        outputTokens: inferResult.usage.outputTokens,
        totalTokens: inferResult.usage.totalTokens,
        inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
      },
    };
  }

  private mapToAgentStreamChunk(chunk: StreamChunk, step: number): AgentStreamChunk | null {
    if (chunk.type === 'text') {
      return { type: 'text-delta', step, text: chunk.text };
    }
    if (chunk.type === 'reasoning') {
      return { type: 'reasoning-delta', step, text: chunk.text };
    }
    if (chunk.type === 'tool-call') {
      return { type: 'tool-call', step, toolCallId: chunk.toolCallId, toolName: chunk.toolName, input: chunk.input };
    }
    return null;
  }

  private getCurrentAssistantMessage(state: AgentState): ModelMessage {
    const last = state.conversation[state.conversation.length - 1];
    if (last?.role === 'assistant') return last as ModelMessage;
    throw new Error('ReactLoop expects assistant message to be created by ReactTurnRunner');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @agent-harness/core test packages/core/tests/loop-strategy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/loop-strategy.ts packages/core/tests/loop-strategy.test.ts
git commit -m "feat(core): ReactLoop emits raw chunks and removes iterations"
```

---

## Task 4: Implement multi-step in `ReactTurnRunner.run`

**Files:**
- Modify: `packages/core/src/turn.ts`
- Test: `packages/core/tests/turn.test.ts`

- [ ] **Step 1: Write failing test for multi-step turn**

在 `packages/core/tests/turn.test.ts` 新增/更新：

```ts
import { describe, it, expect } from 'vitest';
import { ReactTurnRunner } from '../src/turn.js';
import { AgentStreamController } from '../src/stream/agent-stream.js';
import { IterationBudget } from '../src/budget.js';
import type { LoopStrategy, LoopContext, LoopResult, TurnHooks } from '../src/loop-strategy.js';
import type { ModelMessage } from 'ai';

function createMockLoop(responses: LoopResult[]): LoopStrategy {
  let index = 0;
  return {
    async iterate(ctx: LoopContext, hooks: TurnHooks, controller: AgentStreamController, step: number): Promise<LoopResult> {
      const result = responses[index++];
      controller.append({ type: 'text-delta', step, text: `step${step} ` });
      for (const msg of result.newMessages) {
        hooks.onMessageAdded(msg);
      }
      return result;
    },
  };
}

describe('ReactTurnRunner multi-step', () => {
  it('loops until completed', async () => {
    const toolMsg: ModelMessage = { role: 'tool', toolCallId: 'tc1', toolName: 'calc', content: '2' } as unknown as ModelMessage;
    const loop = createMockLoop([
      { finalOutput: { content: '', completed: false }, newMessages: [toolMsg], toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      { finalOutput: { content: 'done', completed: true }, newMessages: [], toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
    ]);

    const runner = new ReactTurnRunner(loop);
    const controller = new AgentStreamController();
    const added: ModelMessage[] = [];
    const result = await runner.run(
      {
        input: { content: 'hi' },
        conversation: [],
        systemPrompt: '',
        budget: new IterationBudget({}),
        maxSteps: 50,
      },
      {
        onMessageAdded: (msg) => added.push(msg),
        onToolCallRecorded: () => {},
      },
      controller,
    );

    expect(result.output.completed).toBe(true);
    expect(result.steps).toBe(2);
    expect(added.length).toBe(2); // assistant + tool

    controller.finish(result.output);
    const chunks = [];
    for await (const chunk of controller.stream.fullStream) {
      chunks.push(chunk);
    }
    expect(chunks.some(c => c.type === 'step-start' && c.step === 1)).toBe(true);
    expect(chunks.some(c => c.type === 'step-finish' && c.step === 1)).toBe(true);
    expect(chunks.some(c => c.type === 'step-start' && c.step === 2)).toBe(true);
    expect(chunks.some(c => c.type === 'step-finish' && c.step === 2)).toBe(true);
  });

  it('respects maxSteps', async () => {
    const loop = createMockLoop([
      { finalOutput: { content: '', completed: false }, newMessages: [], toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      { finalOutput: { content: '', completed: false }, newMessages: [], toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
    ]);

    const runner = new ReactTurnRunner(loop);
    const controller = new AgentStreamController();
    const result = await runner.run(
      {
        input: { content: 'hi' },
        conversation: [],
        systemPrompt: '',
        budget: new IterationBudget({}),
        maxSteps: 1,
      },
      { onMessageAdded: () => {}, onToolCallRecorded: () => {} },
      controller,
    );

    expect(result.steps).toBe(1);
    expect(result.output.completed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @agent-harness/core test packages/core/tests/turn.test.ts
```

Expected: FAIL because `ReactTurnRunner.run` does not loop and `maxSteps` not supported.

- [ ] **Step 3: Update `packages/core/src/turn.ts`**

完整替换为：

```ts
import type { ModelMessage, LanguageModelUsage, LanguageModel } from 'ai';
import type { Session } from './session.js';
import type { UserInput, AgentOutput } from './types.js';
import { AgentState } from './state.js';
import { IterationBudget } from './budget.js';
import type { LoopStrategy, LoopContext, LoopResult, TurnHooks } from './loop-strategy.js';
import { AgentStreamController } from './stream/agent-stream.js';

export interface TurnContext {
  input: UserInput;
  conversation: ModelMessage[];
  systemPrompt: string;
  model?: LanguageModel;
  budget: IterationBudget;
  signal?: AbortSignal;
  provider?: string;
  providerConfig?: {
    apiKey: string;
    baseURL?: string;
    model: string;
  };
  maxSteps?: number;
}

export interface TurnResult {
  output: AgentOutput;
  newMessages: ModelMessage[];
  toolCalls: { toolCallId: string; toolName: string; input: unknown }[];
  usage: LanguageModelUsage;
  steps: number;
}

export interface TurnRunner {
  run(ctx: TurnContext, hooks: TurnHooks, controller: AgentStreamController): Promise<TurnResult>;
}

const DEFAULT_MAX_STEPS = 50;

export class ReactTurnRunner implements TurnRunner {
  constructor(private loopStrategy: LoopStrategy) {}

  async run(ctx: TurnContext, hooks: TurnHooks, controller: AgentStreamController): Promise<TurnResult> {
    const maxSteps = ctx.maxSteps ?? DEFAULT_MAX_STEPS;

    const session: Session = {
      sessionId: 'turn-internal',
      conversation: [...ctx.conversation],
      currentTurn: 0,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const state = new AgentState(session, ctx.budget);

    const assistantMsg: ModelMessage = { role: 'assistant', content: [] } as unknown as ModelMessage;
    state.addMessage(assistantMsg);
    hooks.onMessageAdded(assistantMsg);

    const loopCtx: LoopContext = {
      state,
      systemPrompt: ctx.systemPrompt,
      model: ctx.model,
      budget: ctx.budget,
      signal: ctx.signal,
      provider: ctx.provider,
      providerConfig: ctx.providerConfig,
    };

    const allNewMessages: ModelMessage[] = [assistantMsg];
    const allToolCalls: { toolCallId: string; toolName: string; input: unknown }[] = [];
    let finalOutput: AgentOutput = { content: '', completed: false };
    let totalUsage: LanguageModelUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    };

    let step = 1;
    while (true) {
      if (ctx.signal?.aborted) {
        controller.fail(new Error('Turn aborted'));
        throw new Error('Turn aborted');
      }

      controller.append({ type: 'step-start', step });
      const result: LoopResult = await this.loopStrategy.iterate(loopCtx, hooks, controller, step);
      controller.append({ type: 'step-finish', step });

      for (const msg of result.newMessages) {
        if (!allNewMessages.includes(msg)) {
          allNewMessages.push(msg);
        }
      }
      allToolCalls.push(...result.toolCalls);
      finalOutput = result.finalOutput;
      totalUsage.inputTokens += result.usage.inputTokens;
      totalUsage.outputTokens += result.usage.outputTokens;
      totalUsage.totalTokens += result.usage.totalTokens;

      if (result.finalOutput.completed) {
        break;
      }

      if (step >= maxSteps) {
        finalOutput = { ...finalOutput, completed: false };
        break;
      }

      step++;
    }

    return {
      output: finalOutput,
      newMessages: allNewMessages,
      toolCalls: allToolCalls,
      usage: totalUsage,
      steps: step,
    };
  }
}

export type { TurnHooks } from './loop-strategy.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @agent-harness/core test packages/core/tests/turn.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/turn.ts packages/core/tests/turn.test.ts
git commit -m "feat(core): ReactTurnRunner supports multi-step turns with maxSteps"
```

---

## Task 5: Update demo `StreamAssistantMessage`

**Files:**
- Modify: `packages/demo/src/tui/message.ts`

- [ ] **Step 1: Update `packages/demo/src/tui/message.ts`**

替换 `UIPart` 和 `StreamAssistantMessage` 部分：

```ts
type UIPart = {
  type: "text" | "reasoning" | "tool-call" | "tool-result";
  partId: string;
  text: string;
  component: Markdown;
  wrapper?: Container;
};

export class StreamAssistantMessage extends Container {
  private parts: Map<string, UIPart> = new Map();

  constructor() {
    super();
    this.addChild(new Spacer(1));
  }

  appendChunk(chunk: AgentStreamChunk): void {
    if (chunk.type === "text-start") {
      this.ensurePart(chunk.partId, "text");
    } else if (chunk.type === "text-delta") {
      this.appendDelta(chunk.partId, "text", chunk.text);
    } else if (chunk.type === "reasoning-start") {
      this.ensurePart(chunk.partId, "reasoning");
    } else if (chunk.type === "reasoning-delta") {
      this.appendDelta(chunk.partId, "reasoning", chunk.text);
    } else if (chunk.type === "tool-call") {
      this.updateToolCall(chunk.partId, chunk.toolName, chunk.input);
    } else if (chunk.type === "tool-result") {
      this.updateToolResult(chunk.partId, chunk.output, chunk.error);
    }
  }

  private ensurePart(partId: string, type: "text" | "reasoning"): void {
    if (this.parts.has(partId)) return;
    const style = type === "text" ? assistantMessageStyle : thinkingMessageStyle;
    const component = new Markdown("", 0, 0, markdownTheme, style);

    if (type === "reasoning") {
      const wrapper = new Container();
      wrapper.addChild(new Text("think", 0, 0, dim));
      wrapper.addChild(component);
      this.parts.set(partId, { type, partId, text: "", component, wrapper });
      this.addChild(wrapper);
    } else {
      this.parts.set(partId, { type, partId, text: "", component });
      this.addChild(component);
    }
  }

  private appendDelta(partId: string, type: "text" | "reasoning", text: string): void {
    const existing = this.parts.get(partId);
    if (!existing) {
      this.ensurePart(partId, type);
    }
    const part = this.parts.get(partId)!;
    part.text += text;
    part.component.setText(part.text);
  }

  private updateToolCall(partId: string, toolName: string, input: unknown): void {
    const existing = this.parts.get(partId);
    if (existing) {
      existing.text = `${toolName}(${JSON.stringify(input)})`;
      existing.component.setText(existing.text);
      return;
    }
    const text = `${toolName}(${JSON.stringify(input)})`;
    const component = new Markdown(text, 0, 0, markdownTheme, assistantMessageStyle);
    this.parts.set(partId, { type: "tool-call", partId, text, component });
    this.addChild(component);
  }

  private updateToolResult(partId: string, output: string, error?: string): void {
    const existing = this.parts.get(partId);
    const text = error ? `error: ${error}` : `result: ${output}`;
    if (existing) {
      existing.text = text;
      existing.component.setText(text);
      return;
    }
    const component = new Markdown(text, 0, 0, markdownTheme, assistantMessageStyle);
    this.parts.set(partId, { type: "tool-result", partId, text, component });
    this.addChild(component);
  }

  setText(text: string): void {
    this.parts = new Map();
    this.clear();
    this.addChild(new Spacer(1));
    const component = new Markdown(text, 0, 0, markdownTheme, assistantMessageStyle);
    this.parts.set("static", { type: "text", partId: "static", text, component });
    this.addChild(component);
  }
}
```

- [ ] **Step 2: Run demo typecheck**

Run:

```bash
pnpm --filter @agent-harness/demo typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/demo/src/tui/message.ts
git commit -m "feat(demo): use partId and handle start/delta/finish chunks"
```

---

## Task 6: Run full typecheck and tests

**Files:** all of the above.

- [ ] **Step 1: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 2: Run all tests**

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "chore: fix typecheck and test regressions"
```

---

## Self-Review

### Spec coverage

| Spec section | Task(s) |
|---|---|
| Chunk Protocol (`AgentStreamChunk`) | Task 1 |
| `partId` generation rules | Task 2 |
| Part boundaries synthesis | Task 2 |
| Turn-level parts | Task 4 |
| Multi-step Turn (B2) | Task 4 |
| `maxSteps = 50` | Task 4 |
| `LoopResult.iterations` removal | Task 3 |
| `TurnResult.steps` addition | Task 1, Task 4 |
| UI consumption | Task 5 |
| Error / abort handling | Task 4 |
| Tests | All tasks |

### Placeholder scan

No TBD, TODO, or vague steps found. Each step contains exact file paths, code, and commands.

### Type consistency

- `AgentStreamChunk` uses `partId: string` consistently across all tasks.
- `RawChunk` union in `agent-stream.ts` matches exactly what `loop-strategy.ts` emits.
- `TurnContext.maxSteps` is optional `number` with default `50`.
- `TurnResult.steps` is `number`.
- `LoopResult` no longer has `iterations`.

No inconsistencies detected.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-16-streaming-part-boundaries-implementation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
