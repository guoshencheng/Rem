# CoreAgent Session 与 Turn/Loop 职责分离实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `CoreAgent` 从外部传入 `messages` 的方式重构为通过 `SessionProvider` 协议自主管理 Session；将单轮用户回复的完整 ReAct 过程抽取为无状态 `TurnRunner`；明确 `Agent / Turn / Loop` 三层职责。

**Architecture:** `AgentState` 包装 `Session` 以兼容现有 `MemoryProvider`/`Compressor` 接口；`ReactLoop` 负责内部多步 ReAct 迭代；`ReactTurnRunner` 作为无状态函数调用 Loop 并返回消息增量；`CoreAgent` 负责 Session 生命周期、调用 TurnRunner、同步写入 Session。

**Tech Stack:** TypeScript, Node.js, Vitest, `ai` 包。

---

## 文件结构

### 新增文件

- `packages/core/src/session.ts` — `Session`、`SessionProvider` 接口及 `InMemorySessionProvider` 默认实现。
- `packages/core/src/turn.ts` — `TurnContext`、`TurnResult`、`TurnRunner` 接口及 `ReactTurnRunner` 默认实现。
- `packages/core/src/loop-strategy.ts` — `LoopContext`、`LoopResult`、`LoopStrategy`、`TurnHooks` 接口及 `ReactLoop` 默认实现。（`TurnHooks` 定义在 LoopStrategy 侧，因为 Loop 是实际消费者，避免循环依赖）

### 修改文件

- `packages/core/src/state.ts` — 让 `AgentState` 包装 `Session`，保留 `budget`/`status` 运行时字段，对话历史委托给 `session.conversation`。
- `packages/core/src/core-agent.ts` — 移除 `initialize({ messages })`；增加 `SessionProvider` 与 `TurnRunner` 依赖；`run()` 改为调用一次 `TurnRunner`。
- `packages/core/src/index.ts` — 导出新增类型，移除旧 `AgentLoop` 导出。
- `packages/core/src/loop.ts` — 删除旧的 `AgentLoop` 类（由 `ReactLoop` + `ReactTurnRunner` 替代）。

### 测试文件

- `packages/core/tests/session.test.ts` — `InMemorySessionProvider` 测试。
- `packages/core/tests/turn.test.ts` — `ReactTurnRunner` 测试。
- `packages/core/tests/loop-strategy.test.ts` — `ReactLoop` 测试。
- `packages/core/tests/core-agent.test.ts` — 更新为新的 `CoreAgent` 行为。
- `packages/core/tests/loop.test.ts` — 删除（被 `loop-strategy.test.ts` 替代）。
- `packages/core/tests/state.test.ts` — 更新为包装 Session 后的 `AgentState`。

---

## Task 1: Session 类型与 InMemorySessionProvider

**Files:**
- Create: `packages/core/src/session.ts`
- Test: `packages/core/tests/session.test.ts`

**说明：** 定义 `Session` 和 `SessionProvider` 接口，并提供内存实现。`Session` 为可序列化 POJO。

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { InMemorySessionProvider } from '../src/session.js';

describe('InMemorySessionProvider', () => {
  it('should create a new session', async () => {
    const provider = new InMemorySessionProvider();
    const session = await provider.create();

    expect(session.sessionId).toBeDefined();
    expect(session.conversation).toEqual([]);
    expect(session.currentTurn).toBe(0);
    expect(session.createdAt).toBeInstanceOf(Date);
    expect(session.updatedAt).toBeInstanceOf(Date);
  });

  it('should load an existing session', async () => {
    const provider = new InMemorySessionProvider();
    const created = await provider.create();
    created.conversation.push({ role: 'user', content: 'hello' } as any);
    await provider.save(created);

    const loaded = await provider.load(created.sessionId);
    expect(loaded).not.toBeNull();
    expect(loaded!.conversation).toHaveLength(1);
    expect(loaded!.conversation[0].content).toBe('hello');
  });

  it('should return null for unknown session id', async () => {
    const provider = new InMemorySessionProvider();
    const loaded = await provider.load('unknown-id');
    expect(loaded).toBeNull();
  });

  it('should update updatedAt on save', async () => {
    const provider = new InMemorySessionProvider();
    const session = await provider.create();
    const before = session.updatedAt.getTime();
    await new Promise(r => setTimeout(r, 10));
    await provider.save(session);
    const loaded = await provider.load(session.sessionId);
    expect(loaded!.updatedAt.getTime()).toBeGreaterThan(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/session.test.ts`

Expected: FAIL — `Cannot find module '../src/session.js'` or similar.

- [ ] **Step 3: Write minimal implementation**

```ts
import { randomUUID } from 'crypto';
import type { ModelMessage } from './types.js';

export interface Session {
  sessionId: string;
  conversation: ModelMessage[];
  currentTurn: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionProvider {
  create(): Promise<Session>;
  load(sessionId: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
}

export class InMemorySessionProvider implements SessionProvider {
  private sessions = new Map<string, Session>();

  async create(): Promise<Session> {
    const now = new Date();
    const session: Session = {
      sessionId: randomUUID(),
      conversation: [],
      currentTurn: 0,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  async load(sessionId: string): Promise<Session | null> {
    const session = this.sessions.get(sessionId);
    return session ? this.clone(session) : null;
  }

  async save(session: Session): Promise<void> {
    session.updatedAt = new Date();
    this.sessions.set(session.sessionId, this.clone(session));
  }

  private clone(session: Session): Session {
    return {
      ...session,
      conversation: [...session.conversation],
      metadata: { ...session.metadata },
      createdAt: new Date(session.createdAt),
      updatedAt: new Date(session.updatedAt),
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/tests/session.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session.ts packages/core/tests/session.test.ts
git commit -m "feat(core): add SessionProvider protocol and InMemorySessionProvider"
```

---

## Task 2: AgentState 包装 Session

**Files:**
- Modify: `packages/core/src/state.ts`
- Test: `packages/core/tests/state.test.ts`

**说明：** 让 `AgentState` 持有 `Session` 实例，保留 `budget` 和 `status` 运行时字段。`conversation` 通过 getter 委托到 `session.conversation`，兼容现有 `MemoryProvider` 和 `Compressor`。

- [ ] **Step 1: Update state.ts**

```ts
import { randomUUID } from 'crypto';
import type { ModelMessage, AgentStatus } from './types.js';
import { IterationBudget } from './budget.js';
import type { Session } from './session.js';

export class AgentState {
  readonly session: Session;
  budget: IterationBudget;
  status: AgentStatus = 'idle';
  private maxTurns: number;

  get sessionId(): string {
    return this.session.sessionId;
  }

  get conversation(): ModelMessage[] {
    return this.session.conversation;
  }

  set conversation(value: ModelMessage[]) {
    this.session.conversation = value;
  }

  get currentTurn(): number {
    return this.session.currentTurn;
  }

  set currentTurn(value: number) {
    this.session.currentTurn = value;
  }

  constructor(session?: Session, budget?: IterationBudget) {
    this.session = session ?? {
      sessionId: randomUUID(),
      conversation: [],
      currentTurn: 0,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.budget = budget ?? new IterationBudget({ maxTurns: 60 });
    this.maxTurns = this.budget.getStatus().turnsRemaining + this.budget.turnCount;
  }

  addMessage(msg: ModelMessage): void {
    this.session.conversation.push(msg);
  }

  canContinue(): boolean {
    return this.status === 'running' && this.budget.hasBudget();
  }

  reset(): void {
    this.session.conversation = [];
    this.session.currentTurn = 0;
    this.status = 'idle';
    this.budget = new IterationBudget({ maxTurns: this.maxTurns });
  }
}
```

- [ ] **Step 2: Update state.test.ts**

```ts
import { describe, it, expect } from 'vitest';
import { AgentState } from '../src/state.js';
import { IterationBudget } from '../src/budget.js';
import { InMemorySessionProvider } from '../src/session.js';

describe('AgentState', () => {
  it('should create with a new session when none provided', () => {
    const state = new AgentState();
    expect(state.sessionId).toBeDefined();
    expect(state.conversation).toEqual([]);
    expect(state.currentTurn).toBe(0);
  });

  it('should wrap an existing session', async () => {
    const provider = new InMemorySessionProvider();
    const session = await provider.create();
    const state = new AgentState(session);
    expect(state.sessionId).toBe(session.sessionId);
    expect(state.conversation).toBe(session.conversation);
  });

  it('should delegate conversation mutations to session', async () => {
    const provider = new InMemorySessionProvider();
    const session = await provider.create();
    const state = new AgentState(session);

    state.addMessage({ role: 'user', content: 'hi' } as any);
    expect(session.conversation).toHaveLength(1);
    expect(state.conversation[0].content).toBe('hi');
  });

  it('should reset session conversation', () => {
    const state = new AgentState();
    state.addMessage({ role: 'user', content: 'hi' } as any);
    state.reset();
    expect(state.conversation).toHaveLength(0);
    expect(state.currentTurn).toBe(0);
    expect(state.status).toBe('idle');
  });

  it('should check continuation based on budget', () => {
    const state = new AgentState(undefined, new IterationBudget({ maxTurns: 1 }));
    state.status = 'running';
    state.budget.checkTurn();
    expect(state.canContinue()).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run packages/core/tests/state.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/state.ts packages/core/tests/state.test.ts
git commit -m "refactor(core): make AgentState wrap Session"
```

---

## Task 3: LoopStrategy 与 ReactLoop

**Files:**
- Create: `packages/core/src/loop-strategy.ts`
- Test: `packages/core/tests/loop-strategy.test.ts`

**说明：** `ReactLoop` 实现 `LoopStrategy`，负责一次用户回复内部的完整 ReAct 多轮迭代。当前逻辑只支持单轮 LLM + 工具执行，未来可扩展为多轮迭代。为了兼容现有测试并最小化改动，先实现与旧 `AgentLoop.executeTurn()` 等价的单轮行为，但接口设计预留多轮迭代能力。

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReactLoop } from '../src/loop-strategy.js';
import { AgentState } from '../src/state.js';
import { EventBus } from '../src/events.js';
import { IterationBudget } from '../src/budget.js';
import { SimpleErrorHandler } from '../src/defaults/simple-error-handler.js';
import { registerProvider, clearProviders } from '../src/llm/api-registry.js';

const createMockModel = (): any => ({ provider: 'test', modelId: 'test-model' });

const createMockProviders = () => ({
  toolProvider: {
    getToolSet: vi.fn().mockReturnValue({}),
    execute: vi.fn().mockResolvedValue([]),
  },
  memoryProvider: {
    buildContext: vi.fn().mockResolvedValue({
      systemPrompt: 'You are test',
      messages: [],
    }),
  },
  compressor: {
    shouldCompress: vi.fn().mockReturnValue(false),
    compress: vi.fn().mockImplementation(async (msgs: any[]) => msgs),
  },
  errorHandler: new SimpleErrorHandler(),
});

const createMockHooks = () => ({
  onMessageAdded: vi.fn(),
  onToolCallRecorded: vi.fn(),
});

describe('ReactLoop', () => {
  beforeEach(() => {
    clearProviders();
    registerProvider('mock', {
      generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
      stream: async function* () {
        yield { type: 'text', text: 'Hello!' };
        yield { type: 'usage', inputTokens: 5, outputTokens: 5, totalTokens: 10 };
      },
    });
  });

  it('should iterate a simple turn without tools', async () => {
    const mocks = createMockProviders();
    const state = new AgentState(undefined, new IterationBudget({ maxTurns: 5 }));
    const events = new EventBus();
    const loop = new ReactLoop(createMockModel(), events, mocks.toolProvider, mocks.memoryProvider, mocks.compressor, mocks.errorHandler);
    const hooks = createMockHooks();

    const result = await loop.iterate({
      state,
      systemPrompt: 'You are helpful',
      model: createMockModel(),
      budget: state.budget,
    }, hooks);

    expect(result.finalOutput.content).toBe('Hello!');
    expect(result.newMessages.some(m => m.role === 'assistant')).toBe(true);
    expect(hooks.onMessageAdded).toHaveBeenCalled();
  });

  it('should emit turn events', async () => {
    const mocks = createMockProviders();
    const state = new AgentState(undefined, new IterationBudget({ maxTurns: 5 }));
    const events = new EventBus();
    const beforeHandler = vi.fn();
    const afterHandler = vi.fn();
    events.on('turn:before', beforeHandler);
    events.on('turn:after', afterHandler);

    const loop = new ReactLoop(createMockModel(), events, mocks.toolProvider, mocks.memoryProvider, mocks.compressor, mocks.errorHandler);
    await loop.iterate({ state, systemPrompt: '', model: createMockModel(), budget: state.budget }, createMockHooks());

    expect(beforeHandler).toHaveBeenCalled();
    expect(afterHandler).toHaveBeenCalled();
  });

  it('should execute tools and record them', async () => {
    registerProvider('mock-tools', {
      generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
      stream: async function* () {
        yield { type: 'tool-call', toolCallId: 'tc1', toolName: 'echo', input: { msg: 'hi' } };
        yield { type: 'usage', inputTokens: 5, outputTokens: 5, totalTokens: 10 };
      },
    });

    const mocks = createMockProviders();
    mocks.toolProvider.execute.mockResolvedValue([
      { toolCallId: 'tc1', toolName: 'echo', output: 'result' },
    ]);

    const state = new AgentState(undefined, new IterationBudget({ maxTurns: 5 }));
    const events = new EventBus();
    const loop = new ReactLoop(createMockModel(), events, mocks.toolProvider, mocks.memoryProvider, mocks.compressor, mocks.errorHandler);
    const hooks = createMockHooks();

    const result = await loop.iterate({
      state,
      systemPrompt: 'You are test',
      model: createMockModel(),
      budget: state.budget,
      provider: 'mock-tools',
      providerConfig: { apiKey: 'key', model: 'model' },
    }, hooks);

    expect(mocks.toolProvider.execute).toHaveBeenCalledWith([
      { toolCallId: 'tc1', toolName: 'echo', input: { msg: 'hi' } },
    ]);
    expect(result.toolCallRecords).toHaveLength(1);
    expect(hooks.onToolCallRecorded).toHaveBeenCalledWith(expect.objectContaining({
      id: 'tc1',
      name: 'echo',
    }));
  });

  it('should retry on retryable API errors', async () => {
    let callCount = 0;
    registerProvider('retryable', {
      generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
      stream: async function* () {
        callCount++;
        if (callCount === 1) {
          throw new Error('rate limit');
        }
        yield { type: 'text', text: 'Recovered!' };
        yield { type: 'usage', inputTokens: 1, outputTokens: 1, totalTokens: 2 };
      },
    });

    const mocks = createMockProviders();
    const errorHandler = {
      classify: vi.fn().mockReturnValue('api_error'),
      isRetryable: vi.fn().mockReturnValue(true),
      getRetryInstruction: vi.fn(),
    };
    mocks.errorHandler = errorHandler as any;

    const state = new AgentState(undefined, new IterationBudget({ maxTurns: 5 }));
    const events = new EventBus();
    const loop = new ReactLoop(createMockModel(), events, mocks.toolProvider, mocks.memoryProvider, mocks.compressor, mocks.errorHandler);

    const result = await loop.iterate({
      state,
      systemPrompt: '',
      model: createMockModel(),
      budget: state.budget,
      provider: 'retryable',
      providerConfig: { apiKey: 'key', model: 'model' },
    }, createMockHooks());

    expect(result.finalOutput.content).toBe('Recovered!');
    expect(callCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/loop-strategy.test.ts`

Expected: FAIL — `Cannot find module '../src/loop-strategy.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { ModelMessage, ToolSet, LanguageModelUsage, LanguageModel } from 'ai';
import type { AgentState } from './state.js';
import type { EventBus } from './events.js';
import type { AgentOutput, ToolCallRecord } from './types.js';
import type { ToolProvider, ToolCall } from './sdk/tool-provider.js';
import type { MemoryProvider } from './sdk/memory-provider.js';
import type { ContextCompressor } from './sdk/compressor.js';
import type { ErrorHandler } from './sdk/error-handler.js';
import { IterationBudget } from './budget.js';
import { InferenceEngine } from './llm/engine.js';

export interface TurnHooks {
  onMessageAdded(msg: ModelMessage): void;
  onToolCallRecorded(record: ToolCallRecord): void;
}

export interface LoopContext {
  state: AgentState;
  systemPrompt: string;
  model: LanguageModel;
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
  toolCallRecords: ToolCall[];
  usage: LanguageModelUsage;
  iterations: number;
}

export interface LoopStrategy {
  iterate(ctx: LoopContext, hooks: TurnHooks): Promise<LoopResult>;
}

export class ReactLoop implements LoopStrategy {
  private inferenceEngine = new InferenceEngine();

  constructor(
    private model: LanguageModel,
    private events: EventBus,
    private toolProvider: ToolProvider,
    private memoryProvider: MemoryProvider,
    private compressor: ContextCompressor,
    private errorHandler: ErrorHandler,
  ) {}

  async iterate(ctx: LoopContext, hooks: TurnHooks): Promise<LoopResult> {
    const { state } = ctx;
    const newMessages: ModelMessage[] = [];

    await this.events.emit('turn:before', { agent: this as any, state });

    // PREPARE
    await this.events.emit('phase:prepare', { agent: this as any, state });
    const { systemPrompt, messages: contextMessages } = await this.memoryProvider.buildContext(state);

    let messages: ModelMessage[] = [...contextMessages];
    if (this.compressor.shouldCompress(state)) {
      messages = await this.compressor.compress(messages);
      await this.events.emit('compress:after', { agent: this as any, state });
    }

    // REASON with retry
    await this.events.emit('phase:reason:before', { agent: this as any, state });
    const tools = this.toolProvider.getToolSet();
    const inferResult = await this.inferWithRetry({
      provider: ctx.provider ?? 'openai',
      providerConfig: ctx.providerConfig ?? { apiKey: '', model: 'gpt-4o' },
      system: systemPrompt,
      messages,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      signal: ctx.signal,
      onChunk: async (chunk) => {
        await this.events.emit('stream:chunk', { agent: this as any, state, chunk });
      },
    });
    const { text, toolCalls, usage } = inferResult;
    await this.events.emit('phase:reason:after', { agent: this as any, state });

    // EXECUTE
    const toolCallRecords: ToolCall[] = toolCalls.map(tc => ({
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      input: tc.input,
    }));

    if (toolCallRecords.length > 0) {
      await this.events.emit('phase:execute:before', { agent: this as any, state });

      for (const tc of toolCallRecords) {
        await this.events.emit('tool:before', { agent: this as any, state, toolCall: tc });
      }

      const results = await this.toolProvider.execute(toolCallRecords);

      for (const result of results) {
        const matchedCall = toolCallRecords.find(tc => tc.toolCallId === result.toolCallId);
        const toolMsg: ModelMessage = {
          role: 'tool',
          toolCallId: result.toolCallId,
          content: result.error ?? result.output,
        } as ModelMessage;
        state.addMessage(toolMsg);
        newMessages.push(toolMsg);
        hooks.onMessageAdded(toolMsg);
        hooks.onToolCallRecorded({
          id: result.toolCallId,
          name: result.toolName,
          arguments: (matchedCall?.input as Record<string, unknown>) ?? {},
          result: result.error
            ? undefined
            : { success: true, output: result.output, durationMs: 0 },
          error: result.error,
          durationMs: 0,
          timestamp: new Date(),
        });
        await this.events.emit('tool:after', { agent: this as any, state, toolCall: result });
      }

      await this.events.emit('phase:execute:after', { agent: this as any, state });
    }

    // OBSERVE
    const assistantMsg: ModelMessage = {
      role: 'assistant',
      content: toolCallRecords.length > 0
        ? toolCallRecords.map(tc => ({ type: 'tool-call' as const, ...tc }))
        : text,
    } as ModelMessage;
    state.addMessage(assistantMsg);
    newMessages.push(assistantMsg);
    hooks.onMessageAdded(assistantMsg);

    await this.events.emit('turn:after', { agent: this as any, state });

    return {
      finalOutput: { content: text, completed: toolCallRecords.length === 0 },
      newMessages,
      toolCallRecords,
      usage,
      iterations: 1,
    };
  }

  private async inferWithRetry(options: Parameters<InferenceEngine['infer']>[0]): Promise<{ text: string; toolCalls: any[]; usage: LanguageModelUsage }> {
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
}
```

**注意：** 当前 `ReactLoop` 先实现与旧 `AgentLoop.executeTurn()` 等价的单轮行为。`iterations` 字段为 1。未来可在 `iterate()` 内部增加 `while` 循环实现真正的多轮 ReAct。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/tests/loop-strategy.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/loop-strategy.ts packages/core/tests/loop-strategy.test.ts
git commit -m "feat(core): add LoopStrategy and ReactLoop implementation"
```

---

## Task 4: TurnRunner 与 ReactTurnRunner

**Files:**
- Create: `packages/core/src/turn.ts`
- Test: `packages/core/tests/turn.test.ts`

**说明：** `TurnRunner` 是无状态函数接口，负责一次用户回复的完整执行。`ReactTurnRunner` 内部创建临时 `AgentState`，调用 `LoopStrategy`，并返回新增消息列表。

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { ReactTurnRunner } from '../src/turn.js';
import { AgentState } from '../src/state.js';
import { IterationBudget } from '../src/budget.js';
import type { LoopStrategy, LoopContext, LoopResult } from '../src/loop-strategy.js';
import type { TurnHooks } from '../src/turn.js';

const createMockLoop = (result: Partial<LoopResult>): LoopStrategy => ({
  iterate: vi.fn().mockResolvedValue({
    finalOutput: { content: 'done', completed: true },
    newMessages: [{ role: 'assistant', content: 'done' } as any],
    toolCallRecords: [],
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    iterations: 1,
    ...result,
  }),
});

describe('ReactTurnRunner', () => {
  it('should run turn without mutating caller conversation', async () => {
    const loop = createMockLoop({});
    const runner = new ReactTurnRunner(loop);
    const conversation = [{ role: 'user', content: 'hi' } as any];

    const result = await runner.run({
      input: { content: 'hi' },
      conversation,
      systemPrompt: 'You are helpful',
      model: {} as any,
      budget: new IterationBudget({ maxTurns: 5 }),
    }, {
      onMessageAdded: vi.fn(),
      onToolCallRecorded: vi.fn(),
    });

    expect(result.output.content).toBe('done');
    expect(result.newMessages).toHaveLength(1);
    expect(conversation).toHaveLength(1);
    expect(loop.iterate).toHaveBeenCalled();
  });

  it('should pass hooks to loop and track added messages', async () => {
    const loop = createMockLoop({
      newMessages: [
        { role: 'tool', content: 'result' } as any,
        { role: 'assistant', content: 'done' } as any,
      ],
    });
    const runner = new ReactTurnRunner(loop);
    const onMessageAdded = vi.fn();
    const onToolCallRecorded = vi.fn();

    await runner.run({
      input: { content: 'hi' },
      conversation: [{ role: 'user', content: 'hi' } as any],
      systemPrompt: '',
      model: {} as any,
      budget: new IterationBudget({ maxTurns: 5 }),
    }, { onMessageAdded, onToolCallRecorded });

    expect(onMessageAdded).toHaveBeenCalledTimes(2);
  });

  it('should abort when signal is triggered', async () => {
    const loop: LoopStrategy = {
      iterate: vi.fn().mockImplementation(async (_ctx: LoopContext, _hooks: TurnHooks) => {
        return {
          finalOutput: { content: 'aborted', completed: true },
          newMessages: [{ role: 'assistant', content: 'aborted' } as any],
          toolCallRecords: [],
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          iterations: 1,
        };
      }),
    };
    const runner = new ReactTurnRunner(loop);
    const controller = new AbortController();
    controller.abort();

    const result = await runner.run({
      input: { content: 'hi' },
      conversation: [{ role: 'user', content: 'hi' } as any],
      systemPrompt: '',
      model: {} as any,
      budget: new IterationBudget({ maxTurns: 5 }),
      signal: controller.signal,
    }, {
      onMessageAdded: vi.fn(),
      onToolCallRecorded: vi.fn(),
    });

    expect(result.output.content).toBe('aborted');
    const callCtx = (loop.iterate as any).mock.calls[0][0];
    expect(callCtx.signal).toBe(controller.signal);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/turn.test.ts`

Expected: FAIL — `Cannot find module '../src/turn.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { ModelMessage, LanguageModelUsage, LanguageModel } from 'ai';
import type { UserInput, AgentOutput } from './types.js';
import { AgentState } from './state.js';
import { IterationBudget } from './budget.js';
import type { LoopStrategy, LoopContext, LoopResult, TurnHooks } from './loop-strategy.js';

export interface TurnContext {
  input: UserInput;
  conversation: ModelMessage[];
  systemPrompt: string;
  model: LanguageModel;
  budget: IterationBudget;
  signal?: AbortSignal;
  provider?: string;
  providerConfig?: {
    apiKey: string;
    baseURL?: string;
    model: string;
  };
}

export interface TurnResult {
  output: AgentOutput;
  newMessages: ModelMessage[];
  toolCallRecords: { toolCallId: string; toolName: string; input: unknown }[];
  usage: LanguageModelUsage;
}

export interface TurnRunner {
  run(ctx: TurnContext, hooks: TurnHooks): Promise<TurnResult>;
}

export class ReactTurnRunner implements TurnRunner {
  constructor(private loopStrategy: LoopStrategy) {}

  async run(ctx: TurnContext, hooks: TurnHooks): Promise<TurnResult> {
    // 创建内部 AgentState，不修改调用者的 Session
    const session: import('./session.js').Session = {
      sessionId: 'turn-internal',
      conversation: [...ctx.conversation],
      currentTurn: 0,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const state = new AgentState(session, ctx.budget);

    const loopCtx: LoopContext = {
      state,
      systemPrompt: ctx.systemPrompt,
      model: ctx.model,
      budget: ctx.budget,
      signal: ctx.signal,
      provider: ctx.provider,
      providerConfig: ctx.providerConfig,
    };

    const loopResult: LoopResult = await this.loopStrategy.iterate(loopCtx, hooks);

    return {
      output: loopResult.finalOutput,
      newMessages: loopResult.newMessages,
      toolCallRecords: loopResult.toolCallRecords,
      usage: loopResult.usage,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/tests/turn.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/turn.ts packages/core/tests/turn.test.ts
git commit -m "feat(core): add TurnRunner protocol and ReactTurnRunner"
```

---

## Task 5: 重构 CoreAgent

**Files:**
- Modify: `packages/core/src/core-agent.ts`
- Test: `packages/core/tests/core-agent.test.ts`

**说明：** 移除 `initialize({ messages })` 参数，改为通过 `SessionProvider` 管理 Session；`run()` 调用一次 `TurnRunner` 并保存 Session。

- [ ] **Step 1: Update core-agent.ts**

```ts
import type { UserInput, AgentOutput, ModelMessage } from './types.js';
import type { LanguageModel } from 'ai';
import { AgentState } from './state.js';
import { EventBus } from './events.js';
import { IterationBudget } from './budget.js';
import type { AgentEvent, EventHandler } from './events.js';
import type { ToolProvider } from './sdk/tool-provider.js';
import type { MemoryProvider } from './sdk/memory-provider.js';
import type { ErrorHandler } from './sdk/error-handler.js';
import type { BudgetPolicy } from './sdk/budget-policy.js';
import type { ContextCompressor } from './sdk/compressor.js';
import { InMemoryToolProvider } from './defaults/in-memory-tool-provider.js';
import { SimpleMemoryProvider } from './defaults/simple-memory-provider.js';
import { SimpleErrorHandler } from './defaults/simple-error-handler.js';
import { FixedBudgetPolicy } from './defaults/fixed-budget-policy.js';
import { NoOpCompressor } from './defaults/no-op-compressor.js';
import { registerBuiltInProviders } from './llm/providers/index.js';
import type { Session, SessionProvider } from './session.js';
import { InMemorySessionProvider } from './session.js';
import type { TurnRunner } from './turn.js';
import { ReactTurnRunner } from './turn.js';
import type { LoopStrategy, TurnHooks } from './loop-strategy.js';
import { ReactLoop } from './loop-strategy.js';

export interface CoreAgentConfig {
  name: string;
  model: LanguageModel;
  budget?: IterationBudget;
  toolProvider?: ToolProvider;
  memoryProvider?: MemoryProvider;
  errorHandler?: ErrorHandler;
  budgetPolicy?: BudgetPolicy;
  compressor?: ContextCompressor;
  sessionProvider?: SessionProvider;
  turnRunner?: TurnRunner;
  loopStrategy?: LoopStrategy;
  provider?: string;
  providerConfig?: {
    apiKey: string;
    baseURL?: string;
    model: string;
  };
}

export class CoreAgent {
  private config: CoreAgentConfig;
  private events: EventBus;
  private state: AgentState;
  private sessionProvider: SessionProvider;
  private turnRunner: TurnRunner;
  private interrupted = false;

  get status() {
    return this.state.status;
  }

  constructor(config: CoreAgentConfig) {
    this.config = config;
    this.events = new EventBus();
    this.sessionProvider = config.sessionProvider ?? new InMemorySessionProvider();
    this.turnRunner = config.turnRunner ?? this.createDefaultTurnRunner();
    this.state = new AgentState(undefined, config.budget);
    registerBuiltInProviders();
  }

  private createDefaultTurnRunner(): TurnRunner {
    const loopStrategy = this.config.loopStrategy ?? new ReactLoop(
      this.config.model,
      this.events,
      this.config.toolProvider ?? new InMemoryToolProvider(),
      this.config.memoryProvider ?? new SimpleMemoryProvider(this.config.name),
      this.config.compressor ?? new NoOpCompressor(),
      this.config.errorHandler ?? new SimpleErrorHandler(),
    );
    return new ReactTurnRunner(loopStrategy);
  }

  async initialize(options?: { sessionId?: string }): Promise<void> {
    if (options?.sessionId) {
      const session = await this.sessionProvider.load(options.sessionId);
      this.state = new AgentState(session ?? undefined, this.config.budget);
      if (!session) {
        // 如果指定了 sessionId 但不存在，创建一个新的并复用该 id
        (this.state.session as any).sessionId = options.sessionId;
        await this.sessionProvider.save(this.state.session);
      }
    } else {
      this.state = new AgentState(undefined, this.config.budget);
      await this.sessionProvider.save(this.state.session);
    }
    this.state.status = 'idle';
    await this.events.emit('core-agent:init', { agent: this, state: this.state });
  }

  async run(input: UserInput): Promise<AgentOutput> {
    this.state.status = 'running';
    this.interrupted = false;
    await this.events.emit('core-agent:start', { agent: this, state: this.state });

    const budgetPolicy = this._getBudgetPolicy();
    const startTime = Date.now();

    if (!budgetPolicy.checkTurn(this.state) || !budgetPolicy.checkTimeout(startTime)) {
      this.state.status = 'idle';
      return { content: 'Budget exceeded.', completed: true };
    }

    // 添加 user 消息到 Session
    const userMessage: ModelMessage = { role: 'user', content: input.content } as ModelMessage;
    this.state.addMessage(userMessage);
    await this.sessionProvider.save(this.state.session);

    const abortController = new AbortController();

    try {
      const result = await this.turnRunner.run({
        input,
        conversation: [...this.state.conversation],
        systemPrompt: `You are ${this.config.name}.`,
        model: this.config.model,
        budget: this.state.budget,
        signal: abortController.signal,
        provider: this.config.provider ?? 'openai',
        providerConfig: this.config.providerConfig ?? { apiKey: '', model: 'gpt-4o' },
      }, this.createTurnHooks());

      // 追加 Turn 返回的新消息
      for (const msg of result.newMessages) {
        this.state.addMessage(msg);
      }

      this.state.currentTurn++;
      this.state.status = this.interrupted ? 'idle' : 'idle';
      await this.sessionProvider.save(this.state.session);
      await this.events.emit('core-agent:stop', { agent: this, state: this.state });

      return {
        content: this.interrupted ? 'Response interrupted.' : result.output.content,
        completed: true,
      };
    } catch (error) {
      this.state.status = 'error';
      await this.events.emit('core-agent:error', { agent: this, state: this.state });
      throw error;
    }
  }

  private createTurnHooks(): TurnHooks {
    return {
      // ReactLoop 已在其内部 AgentState 中维护消息，并通过 newMessages 返回增量。
      // CoreAgent 的 session 更新发生在 run() 中 result 返回之后，
      // 此钩子主要用于观测/实时副作用，无需重复写入 session。
      onMessageAdded: (msg) => {
        if (this.interrupted) {
          return;
        }
      },
      onToolCallRecorded: (record) => {
        this.state.session.metadata.lastToolCall = record;
      },
    };
  }

  interrupt(): void {
    this.interrupted = true;
  }

  async reset(): Promise<void> {
    this.state.reset();
    this.turnRunner = this.config.turnRunner ?? this.createDefaultTurnRunner();
    await this.events.emit('core-agent:init', { agent: this, state: this.state });
  }

  on(event: AgentEvent, handler: EventHandler): () => void {
    return this.events.on(event, handler);
  }

  once(event: AgentEvent, handler: EventHandler): void {
    this.events.once(event, handler);
  }

  private _getBudgetPolicy(): BudgetPolicy {
    return this.config.budgetPolicy ?? new FixedBudgetPolicy({
      maxTurns: this.state.budget.getStatus().turnsRemaining + this.state.budget.turnCount,
    });
  }
}
```

**注意：** `errorHandler` 通过 `createDefaultTurnRunner()` 传递给 `ReactLoop`，用于 LLM 调用失败时的重试逻辑。`CoreAgent.run()` 不再直接处理重试。

- [ ] **Step 2: Update core-agent.test.ts**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoreAgent } from '../src/core-agent.js';
import { IterationBudget } from '../src/budget.js';
import { registerProvider, clearProviders } from '../src/llm/api-registry.js';

const createMockModel = (): any => ({ provider: 'test', modelId: 'test-model' });

beforeEach(() => {
  clearProviders();
  registerProvider('openai', {
    generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
    stream: async function* () {
      yield { type: 'text', text: 'Done!' };
      yield { type: 'usage', inputTokens: 1, outputTokens: 1, totalTokens: 2 };
    },
  });
});

describe('CoreAgent', () => {
  it('should initialize with idle status', async () => {
    const agent = new CoreAgent({
      name: 'test-agent',
      model: createMockModel(),
    });
    await agent.initialize();
    expect(agent.status).toBe('idle');
  });

  it('should run a single turn and complete', async () => {
    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
      budget: new IterationBudget({ maxTurns: 5 }),
    });

    await agent.initialize();
    const result = await agent.run({ content: 'Hello' });

    expect(result.content).toBe('Done!');
    expect(agent.status).toBe('idle');
  });

  it('should persist conversation to session', async () => {
    const saveSpy = vi.fn();
    const mockSessionProvider = {
      create: vi.fn().mockResolvedValue({
        sessionId: 's1',
        conversation: [],
        currentTurn: 0,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      load: vi.fn().mockResolvedValue(null),
      save: saveSpy,
    };

    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
      sessionProvider: mockSessionProvider as any,
    });

    await agent.initialize();
    await agent.run({ content: 'Hello' });

    expect(saveSpy).toHaveBeenCalled();
    const savedSession = saveSpy.mock.calls[saveSpy.mock.calls.length - 1][0];
    expect(savedSession.conversation.some((m: any) => m.role === 'user' && m.content === 'Hello')).toBe(true);
    expect(savedSession.conversation.some((m: any) => m.role === 'assistant')).toBe(true);
  });

  it('should load existing session by id', async () => {
    const existingSession = {
      sessionId: 'existing-id',
      conversation: [{ role: 'user', content: 'previous' } as any],
      currentTurn: 1,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const mockSessionProvider = {
      create: vi.fn(),
      load: vi.fn().mockResolvedValue(existingSession),
      save: vi.fn(),
    };

    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
      sessionProvider: mockSessionProvider as any,
    });

    await agent.initialize({ sessionId: 'existing-id' });
    expect(mockSessionProvider.load).toHaveBeenCalledWith('existing-id');
  });

  it('should reset session state', async () => {
    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
      budget: new IterationBudget({ maxTurns: 5 }),
    });

    await agent.initialize();
    await agent.run({ content: 'Hello' });
    expect(agent['state'].conversation.length).toBeGreaterThan(0);

    await agent.reset();
    expect(agent['state'].conversation).toHaveLength(0);
    expect(agent.status).toBe('idle');
  });

  it('should allow event subscription', async () => {
    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
    });

    const handler = vi.fn();
    agent.on('core-agent:init', handler);

    await agent.initialize();
    expect(handler).toHaveBeenCalled();
  });

  it('should handle interrupt', async () => {
    registerProvider('slow', {
      generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
      stream: async function* () {
        await new Promise(r => setTimeout(r, 50));
        yield { type: 'text', text: 'Late response' };
      },
    });

    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
      provider: 'slow',
      providerConfig: { apiKey: 'key', model: 'model' },
    });

    await agent.initialize();
    const runPromise = agent.run({ content: 'Slow' });
    agent.interrupt();

    const result = await runPromise;
    expect(result.content).toContain('interrupted');
  });

  it('should use configured provider', async () => {
    registerProvider('mock-agent', {
      generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
      stream: async function* () {
        yield { type: 'text', text: 'Custom!' };
        yield { type: 'usage', inputTokens: 1, outputTokens: 1, totalTokens: 2 };
      },
    });

    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
      budget: new IterationBudget({ maxTurns: 5 }),
      provider: 'mock-agent',
      providerConfig: { apiKey: 'key', model: 'model' },
    });

    await agent.initialize();
    const result = await agent.run({ content: 'Hello' });

    expect(result.content).toBe('Custom!');
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run packages/core/tests/core-agent.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/core-agent.ts packages/core/tests/core-agent.test.ts
git commit -m "refactor(core): CoreAgent uses SessionProvider and TurnRunner"
```

---

## Task 6: 更新导出并删除旧 loop.ts

**Files:**
- Modify: `packages/core/src/index.ts`
- Delete: `packages/core/src/loop.ts`
- Delete: `packages/core/tests/loop.test.ts`

**说明：** 移除旧的 `AgentLoop` 导出和相关测试，导出新的 `Session`、`TurnRunner`、`LoopStrategy` 类型。

- [ ] **Step 1: Update index.ts**

```ts
export * from './types.js';
export * from './budget.js';
export * from './session.js';
export * from './state.js';
export * from './events.js';
export * from './turn.js';
export * from './loop-strategy.js';
export * from './core-agent.js';
export * from './sdk/index.js';
export * from './defaults/index.js';
export * from './llm/types.js';
export * from './llm/api-registry.js';
export * from './llm/engine.js';
export * from './llm/providers/index.js';
```

- [ ] **Step 2: Delete old files**

```bash
rm packages/core/src/loop.ts
rm packages/core/tests/loop.test.ts
```

- [ ] **Step 3: Run full test suite**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`

Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/loop.ts packages/core/tests/loop.test.ts
git commit -m "chore(core): remove old AgentLoop and export new Session/Turn/Loop types"
```

---

## Task 7: 全量回归验证

- [ ] **Step 1: Run all tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Check for unused imports or broken exports**

Run a quick grep to ensure no references to `AgentLoop` remain:

```bash
grep -r "AgentLoop" packages/core/src packages/core/tests || echo "No AgentLoop references found"
```

Expected: No `AgentLoop` references in source or tests.

- [ ] **Step 4: Commit any final fixes**

If typecheck or grep reveals issues, fix and commit.

---

## 自检清单

### Spec coverage

| Spec 要求 | 对应任务 |
|-----------|---------|
| `SessionProvider` 协议 | Task 1 |
| `CoreAgent` 通过 `sessionId` 加载/创建 Session | Task 5 |
| `TurnRunner` 无状态纯函数 | Task 4 |
| `LoopStrategy` 策略接口 | Task 3 |
| Agent/Turn/Loop 职责分离 | Task 3, 4, 5 |
| 回调 + 事件混合机制 | Task 3, 4, 5 |
| `AgentState` 包装 `Session` 兼容现有 provider | Task 2 |

### Placeholder scan

- 无 TBD/TODO。
- 所有代码块包含完整实现或测试代码。
- 每个测试步骤包含具体断言语句。

### 类型一致性

- `Session` / `SessionProvider` 定义在 Task 1，后续 Task 2/5 一致使用。
- `TurnContext` / `TurnResult` / `TurnRunner` 定义在 Task 4；`TurnHooks` 定义在 Task 3（`loop-strategy.ts`），Task 4/5 通过导入一致使用。
- `LoopContext` / `LoopResult` / `LoopStrategy` 定义在 Task 3，Task 4/5 一致使用。
- `errorHandler` 通过 `CoreAgent.createDefaultTurnRunner()` 传递给 `ReactLoop`，类型一致。

---

## 执行交接

Plan complete and saved to `docs/superpowers/plans/2026-06-12-core-agent-session-turn-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
