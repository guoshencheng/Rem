# Agent Core P0 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Core 可运行：一条请求能走完 输入→推理→工具执行→输出的完整链路。

**Architecture:** 纯接口驱动方案。Core 层（loop + harness）作为编排骨架，所有可扩展点通过 SDK 策略接口抽象。P0 提供内存版默认实现，让核心链路立即跑通。

**Tech Stack:** TypeScript ESM, Vercel AI SDK (`ai` 6.0.199), Vitest

---

## 文件结构

```
packages/core/src/
├── sdk/
│   ├── tool-provider.ts       # ToolProvider 接口
│   ├── memory-provider.ts     # MemoryProvider 接口
│   ├── error-handler.ts       # ErrorHandler 接口 + ErrorCategory
│   ├── budget-policy.ts       # BudgetPolicy 接口
│   ├── compressor.ts          # ContextCompressor 接口
│   └── index.ts               # SDK 层统一导出
├── defaults/
│   ├── in-memory-tool-provider.ts   # InMemoryToolProvider 实现
│   ├── simple-memory-provider.ts    # SimpleMemoryProvider 实现
│   ├── simple-error-handler.ts      # SimpleErrorHandler 实现
│   ├── fixed-budget-policy.ts       # FixedBudgetPolicy 实现
│   ├── no-op-compressor.ts          # NoOpCompressor 实现
│   └── index.ts                     # 默认实现统一导出
├── types.ts                   # 扩展：新增 ToolCall / ToolResult / ToolDefinition
├── loop.ts                    # 改造：注入策略接口 + 消息组装 + 工具执行
├── core-agent.ts              # 改造：注入策略接口 + 外层错误决策
├── state.ts                   # 不变（设计文档状态）
├── events.ts                  # 不变
├── budget.ts                  # 不变（FixedBudgetPolicy 内部委托）
└── index.ts                   # 更新：导出 SDK + defaults

packages/core/tests/
├── in-memory-tool-provider.test.ts
├── simple-memory-provider.test.ts
├── simple-error-handler.test.ts
├── fixed-budget-policy.test.ts
├── no-op-compressor.test.ts
├── loop.test.ts               # 更新：工具执行场景
└── core-agent.test.ts         # 更新：策略注入 + 错误恢复场景
```

---

## Task 1: SDK 接口定义

**Files:**
- Create: `packages/core/src/sdk/tool-provider.ts`
- Create: `packages/core/src/sdk/memory-provider.ts`
- Create: `packages/core/src/sdk/error-handler.ts`
- Create: `packages/core/src/sdk/budget-policy.ts`
- Create: `packages/core/src/sdk/compressor.ts`
- Create: `packages/core/src/sdk/index.ts`

- [ ] **Step 1: 创建 `src/sdk/tool-provider.ts`**

```typescript
import type { ToolSet } from 'ai';
import type { ModelMessage } from '../types.js';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface ToolResult {
  toolCallId: string;
  toolName: string;
  output: string;
  error?: string;
}

export interface ToolProvider {
  register(tool: ToolDefinition, executor: (input: unknown) => Promise<string>): void;
  getToolSet(): ToolSet;
  execute(calls: ToolCall[]): Promise<ToolResult[]>;
}
```

- [ ] **Step 2: 创建 `src/sdk/memory-provider.ts`**

```typescript
import type { ModelMessage } from '../types.js';
import type { AgentState } from '../state.js';

export interface MemoryContext {
  systemPrompt: string;
  messages: ModelMessage[];
}

export interface MemoryProvider {
  buildContext(state: AgentState): Promise<MemoryContext>;
}
```

- [ ] **Step 3: 创建 `src/sdk/error-handler.ts`**

```typescript
export type ErrorCategory =
  | 'api_error'
  | 'invalid_response'
  | 'planning_only'
  | 'reasoning_only'
  | 'empty_response'
  | 'tool_error'
  | 'timeout'
  | 'unknown';

export interface ErrorHandler {
  classify(error: unknown): ErrorCategory;
  isRetryable(category: ErrorCategory): boolean;
  getRetryInstruction(category: ErrorCategory): string | undefined;
}
```

- [ ] **Step 4: 创建 `src/sdk/budget-policy.ts`**

```typescript
import type { AgentState } from '../state.js';

export interface BudgetStatus {
  turnsRemaining: number;
  consecutiveErrors: number;
  atRisk: boolean;
  reason?: string;
}

export interface BudgetPolicy {
  checkTurn(state: AgentState): boolean;
  checkTimeout(startTime: number): boolean;
  shouldCircuitBreak(state: AgentState): boolean;
  getStatus(state: AgentState): BudgetStatus;
}
```

- [ ] **Step 5: 创建 `src/sdk/compressor.ts`**

```typescript
import type { ModelMessage } from '../types.js';
import type { AgentState } from '../state.js';

export interface ContextCompressor {
  shouldCompress(state: AgentState): boolean;
  compress(messages: ModelMessage[]): Promise<ModelMessage[]>;
}
```

- [ ] **Step 6: 创建 `src/sdk/index.ts`**

```typescript
export * from './tool-provider.js';
export * from './memory-provider.js';
export * from './error-handler.js';
export * from './budget-policy.js';
export * from './compressor.js';
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/sdk/
git commit -m "feat(sdk): define strategy interfaces for Tool, Memory, Error, Budget, Compressor

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: InMemoryToolProvider

**Files:**
- Create: `packages/core/src/defaults/in-memory-tool-provider.ts`
- Create: `packages/core/tests/in-memory-tool-provider.test.ts`

- [ ] **Step 1: 写测试**

Create `packages/core/tests/in-memory-tool-provider.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { InMemoryToolProvider } from '../src/defaults/in-memory-tool-provider.js';

describe('InMemoryToolProvider', () => {
  it('should register and retrieve a tool', () => {
    const provider = new InMemoryToolProvider();
    provider.register(
      { name: 'echo', description: 'Echo input', parameters: { type: 'object' } },
      async (input) => JSON.stringify(input),
    );

    const toolSet = provider.getToolSet();
    expect(toolSet).toHaveProperty('echo');
    expect(toolSet.echo.description).toBe('Echo input');
  });

  it('should execute a registered tool', async () => {
    const provider = new InMemoryToolProvider();
    provider.register(
      { name: 'add', description: 'Add two numbers', parameters: { type: 'object' } },
      async (input: any) => String(input.a + input.b),
    );

    const results = await provider.execute([
      { toolCallId: 'tc1', toolName: 'add', input: { a: 1, b: 2 } },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].output).toBe('3');
    expect(results[0].toolCallId).toBe('tc1');
  });

  it('should return error for unregistered tool', async () => {
    const provider = new InMemoryToolProvider();
    const results = await provider.execute([
      { toolCallId: 'tc1', toolName: 'unknown', input: {} },
    ]);

    expect(results[0].error).toContain('not found');
  });

  it('should execute multiple tools serially', async () => {
    const provider = new InMemoryToolProvider();
    const order: number[] = [];

    provider.register(
      { name: 'first', description: '', parameters: {} },
      async () => { order.push(1); return '1'; },
    );
    provider.register(
      { name: 'second', description: '', parameters: {} },
      async () => { order.push(2); return '2'; },
    );

    await provider.execute([
      { toolCallId: 'tc1', toolName: 'first', input: {} },
      { toolCallId: 'tc2', toolName: 'second', input: {} },
    ]);

    expect(order).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: 运行测试（应失败）**

```bash
cd packages/core && npx vitest run tests/in-memory-tool-provider.test.ts
```

Expected: FAIL — `InMemoryToolProvider` not found

- [ ] **Step 3: 实现 InMemoryToolProvider**

Create `packages/core/src/defaults/in-memory-tool-provider.ts`:

```typescript
import { tool, type ToolSet } from 'ai';
import type { ToolProvider, ToolDefinition, ToolCall, ToolResult } from '../sdk/tool-provider.js';

export class InMemoryToolProvider implements ToolProvider {
  private tools = new Map<string, { def: ToolDefinition; executor: (input: unknown) => Promise<string> }>();

  register(def: ToolDefinition, executor: (input: unknown) => Promise<string>): void {
    this.tools.set(def.name, { def, executor });
  }

  getToolSet(): ToolSet {
    const result: ToolSet = {};
    for (const [name, { def }] of this.tools) {
      result[name] = tool({
        description: def.description,
        parameters: def.parameters as any,
      });
    }
    return result;
  }

  async execute(calls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const call of calls) {
      const registered = this.tools.get(call.toolName);
      if (!registered) {
        results.push({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: '',
          error: `Tool "${call.toolName}" not found`,
        });
        continue;
      }
      try {
        const output = await registered.executor(call.input);
        results.push({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output,
        });
      } catch (err) {
        results.push({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: '',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return results;
  }
}
```

- [ ] **Step 4: 运行测试（应通过）**

```bash
cd packages/core && npx vitest run tests/in-memory-tool-provider.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/defaults/in-memory-tool-provider.ts packages/core/tests/in-memory-tool-provider.test.ts
git commit -m "feat(tools): add InMemoryToolProvider with serial execution

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: SimpleMemoryProvider

**Files:**
- Create: `packages/core/src/defaults/simple-memory-provider.ts`
- Create: `packages/core/tests/simple-memory-provider.test.ts`

- [ ] **Step 1: 写测试**

Create `packages/core/tests/simple-memory-provider.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SimpleMemoryProvider } from '../src/defaults/simple-memory-provider.js';
import { AgentState } from '../src/state.js';
import { IterationBudget } from '../src/budget.js';

describe('SimpleMemoryProvider', () => {
  it('should build context with system prompt and conversation', async () => {
    const provider = new SimpleMemoryProvider('TestAgent');
    const state = new AgentState(new IterationBudget({ maxTurns: 5 }));
    state.addMessage({ role: 'user', content: 'Hello' });

    const ctx = await provider.buildContext(state);

    expect(ctx.systemPrompt).toBe('You are TestAgent.');
    expect(ctx.messages).toHaveLength(1);
    expect(ctx.messages[0].role).toBe('user');
  });

  it('should return empty messages for fresh state', async () => {
    const provider = new SimpleMemoryProvider('Agent');
    const state = new AgentState();

    const ctx = await provider.buildContext(state);

    expect(ctx.messages).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行测试（应失败）**

```bash
cd packages/core && npx vitest run tests/simple-memory-provider.test.ts
```

Expected: FAIL — `SimpleMemoryProvider` not found

- [ ] **Step 3: 实现 SimpleMemoryProvider**

Create `packages/core/src/defaults/simple-memory-provider.ts`:

```typescript
import type { MemoryProvider, MemoryContext } from '../sdk/memory-provider.js';
import type { AgentState } from '../state.js';

export class SimpleMemoryProvider implements MemoryProvider {
  constructor(private agentName: string) {}

  async buildContext(state: AgentState): Promise<MemoryContext> {
    return {
      systemPrompt: `You are ${this.agentName}.`,
      messages: state.conversation,
    };
  }
}
```

- [ ] **Step 4: 运行测试（应通过）**

```bash
cd packages/core && npx vitest run tests/simple-memory-provider.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/defaults/simple-memory-provider.ts packages/core/tests/simple-memory-provider.test.ts
git commit -m "feat(memory): add SimpleMemoryProvider

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: SimpleErrorHandler

**Files:**
- Create: `packages/core/src/defaults/simple-error-handler.ts`
- Create: `packages/core/tests/simple-error-handler.test.ts`

- [ ] **Step 1: 写测试**

Create `packages/core/tests/simple-error-handler.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SimpleErrorHandler } from '../src/defaults/simple-error-handler.js';
import { APICallError } from 'ai';

describe('SimpleErrorHandler', () => {
  const handler = new SimpleErrorHandler();

  it('should classify APICallError as api_error', () => {
    const error = new APICallError({ message: 'rate limit', url: 'http://test' });
    expect(handler.classify(error)).toBe('api_error');
  });

  it('should classify generic Error as unknown', () => {
    expect(handler.classify(new Error('oops'))).toBe('unknown');
  });

  it('should classify string as unknown', () => {
    expect(handler.classify('string error')).toBe('unknown');
  });

  it('should mark api_error as retryable', () => {
    expect(handler.isRetryable('api_error')).toBe(true);
  });

  it('should mark unknown as not retryable', () => {
    expect(handler.isRetryable('unknown')).toBe(false);
  });

  it('should return undefined retry instruction for all categories', () => {
    expect(handler.getRetryInstruction('api_error')).toBeUndefined();
    expect(handler.getRetryInstruction('planning_only')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试（应失败）**

```bash
cd packages/core && npx vitest run tests/simple-error-handler.test.ts
```

Expected: FAIL — `SimpleErrorHandler` not found

- [ ] **Step 3: 实现 SimpleErrorHandler**

Create `packages/core/src/defaults/simple-error-handler.ts`:

```typescript
import { APICallError } from 'ai';
import type { ErrorHandler, ErrorCategory } from '../sdk/error-handler.js';

export class SimpleErrorHandler implements ErrorHandler {
  classify(error: unknown): ErrorCategory {
    if (error instanceof APICallError) return 'api_error';
    return 'unknown';
  }

  isRetryable(category: ErrorCategory): boolean {
    return category === 'api_error';
  }

  getRetryInstruction(): string | undefined {
    return undefined;
  }
}
```

- [ ] **Step 4: 运行测试（应通过）**

```bash
cd packages/core && npx vitest run tests/simple-error-handler.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/defaults/simple-error-handler.ts packages/core/tests/simple-error-handler.test.ts
git commit -m "feat(errors): add SimpleErrorHandler with basic classification

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: FixedBudgetPolicy

**Files:**
- Create: `packages/core/src/defaults/fixed-budget-policy.ts`
- Create: `packages/core/tests/fixed-budget-policy.test.ts`

- [ ] **Step 1: 写测试**

Create `packages/core/tests/fixed-budget-policy.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { FixedBudgetPolicy } from '../src/defaults/fixed-budget-policy.js';
import { AgentState } from '../src/state.js';
import { IterationBudget } from '../src/budget.js';

describe('FixedBudgetPolicy', () => {
  it('should allow turn when under max turns', () => {
    const policy = new FixedBudgetPolicy({ maxTurns: 5 });
    const state = new AgentState(new IterationBudget({ maxTurns: 5 }));
    state.currentTurn = 3;

    expect(policy.checkTurn(state)).toBe(true);
  });

  it('should deny turn when max turns reached', () => {
    const policy = new FixedBudgetPolicy({ maxTurns: 5 });
    const state = new AgentState(new IterationBudget({ maxTurns: 5 }));
    state.currentTurn = 5;

    expect(policy.checkTurn(state)).toBe(false);
  });

  it('should report atRisk when turns low', () => {
    const policy = new FixedBudgetPolicy({ maxTurns: 5 });
    const state = new AgentState(new IterationBudget({ maxTurns: 5 }));
    state.currentTurn = 3;

    const status = policy.getStatus(state);
    expect(status.atRisk).toBe(true);
    expect(status.turnsRemaining).toBe(2);
  });

  it('should check timeout', () => {
    const policy = new FixedBudgetPolicy({ maxTurns: 5, timeoutMs: 1000 });
    const start = Date.now();

    expect(policy.checkTimeout(start)).toBe(true);
    expect(policy.checkTimeout(start - 2000)).toBe(false);
  });

  it('should not circuit break in P0', () => {
    const policy = new FixedBudgetPolicy({ maxTurns: 5 });
    const state = new AgentState();

    expect(policy.shouldCircuitBreak(state)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试（应失败）**

```bash
cd packages/core && npx vitest run tests/fixed-budget-policy.test.ts
```

Expected: FAIL — `FixedBudgetPolicy` not found

- [ ] **Step 3: 实现 FixedBudgetPolicy**

Create `packages/core/src/defaults/fixed-budget-policy.ts`:

```typescript
import type { BudgetPolicy, BudgetStatus } from '../sdk/budget-policy.js';
import type { AgentState } from '../state.js';

export interface FixedBudgetConfig {
  maxTurns: number;
  timeoutMs?: number;
}

export class FixedBudgetPolicy implements BudgetPolicy {
  private maxTurns: number;
  private timeoutMs: number;

  constructor(config: FixedBudgetConfig) {
    this.maxTurns = config.maxTurns;
    this.timeoutMs = config.timeoutMs ?? 300_000; // 5 minutes default
  }

  checkTurn(state: AgentState): boolean {
    return state.currentTurn < this.maxTurns;
  }

  checkTimeout(startTime: number): boolean {
    return Date.now() - startTime < this.timeoutMs;
  }

  shouldCircuitBreak(): boolean {
    return false; // P0: no circuit breaker
  }

  getStatus(state: AgentState): BudgetStatus {
    const turnsRemaining = Math.max(0, this.maxTurns - state.currentTurn);
    const atRisk = turnsRemaining <= 3;
    return {
      turnsRemaining,
      consecutiveErrors: 0,
      atRisk,
      reason: turnsRemaining === 0 ? 'max_turns exceeded' : undefined,
    };
  }
}
```

- [ ] **Step 4: 运行测试（应通过）**

```bash
cd packages/core && npx vitest run tests/fixed-budget-policy.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/defaults/fixed-budget-policy.ts packages/core/tests/fixed-budget-policy.test.ts
git commit -m "feat(budget): add FixedBudgetPolicy

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: NoOpCompressor

**Files:**
- Create: `packages/core/src/defaults/no-op-compressor.ts`
- Create: `packages/core/tests/no-op-compressor.test.ts`

- [ ] **Step 1: 写测试**

Create `packages/core/tests/no-op-compressor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { NoOpCompressor } from '../src/defaults/no-op-compressor.js';
import { AgentState } from '../src/state.js';
import { IterationBudget } from '../src/budget.js';

describe('NoOpCompressor', () => {
  const compressor = new NoOpCompressor();

  it('should never compress', () => {
    const state = new AgentState();
    expect(compressor.shouldCompress(state)).toBe(false);
  });

  it('should return messages unchanged', async () => {
    const messages = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi' },
    ];
    const result = await compressor.compress(messages);
    expect(result).toEqual(messages);
  });
});
```

- [ ] **Step 2: 运行测试（应失败）**

```bash
cd packages/core && npx vitest run tests/no-op-compressor.test.ts
```

Expected: FAIL — `NoOpCompressor` not found

- [ ] **Step 3: 实现 NoOpCompressor**

Create `packages/core/src/defaults/no-op-compressor.ts`:

```typescript
import type { ContextCompressor } from '../sdk/compressor.js';
import type { ModelMessage } from '../types.js';
import type { AgentState } from '../state.js';

export class NoOpCompressor implements ContextCompressor {
  shouldCompress(): boolean {
    return false;
  }

  async compress(messages: ModelMessage[]): Promise<ModelMessage[]> {
    return messages;
  }
}
```

- [ ] **Step 4: 运行测试（应通过）**

```bash
cd packages/core && npx vitest run tests/no-op-compressor.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/defaults/no-op-compressor.ts packages/core/tests/no-op-compressor.test.ts
git commit -m "feat(compressor): add NoOpCompressor placeholder

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Defaults 导出

**Files:**
- Create: `packages/core/src/defaults/index.ts`

- [ ] **Step 1: 创建导出文件**

Create `packages/core/src/defaults/index.ts`:

```typescript
export { InMemoryToolProvider } from './in-memory-tool-provider.js';
export { SimpleMemoryProvider } from './simple-memory-provider.js';
export { SimpleErrorHandler } from './simple-error-handler.js';
export { FixedBudgetPolicy } from './fixed-budget-policy.js';
export { NoOpCompressor } from './no-op-compressor.js';
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/defaults/index.ts
git commit -m "chore: add defaults index export

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: 扩展 types.ts

**Files:**
- Modify: `packages/core/src/types.ts`

- [ ] **Step 1: 添加 ToolCallRecord 类型**

Modify `packages/core/src/types.ts`，在现有内容后追加：

```typescript
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
```

现有文件已有 `UserInput`、`AgentOutput`、`AgentStatus`。追加 ToolCallRecord 到文件末尾。

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "feat(types): add ToolCallRecord type

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: 改造 loop.ts

**Files:**
- Modify: `packages/core/src/loop.ts`
- Modify: `packages/core/tests/loop.test.ts`

- [ ] **Step 1: 写新测试（工具执行场景）**

先查看当前 `packages/core/tests/loop.test.ts` 内容，然后追加测试到文件末尾（在最后一个 `describe` 块之后，或在内部追加新的 `it`）：

在 `packages/core/tests/loop.test.ts` 的 `describe('AgentLoop')` 块内追加：

```typescript
  it('should execute tools and continue when toolCalls present', async () => {
    const toolProvider = {
      getToolSet: vi.fn().mockReturnValue({}),
      execute: vi.fn().mockResolvedValue([
        { toolCallId: 'tc1', toolName: 'echo', output: 'result' },
      ]),
    };
    const memoryProvider = {
      buildContext: vi.fn().mockResolvedValue({
        systemPrompt: 'You are test',
        messages: [],
      }),
    };
    const compressor = { shouldCompress: vi.fn().mockReturnValue(false) };

    vi.mocked(ai.generateText).mockResolvedValueOnce({
      ...mockGenerateTextResponse(''),
      text: '',
      toolCalls: [{ toolCallId: 'tc1', toolName: 'echo', input: { msg: 'hi' } }],
      toolResults: [],
    });

    const state = new AgentState(new IterationBudget({ maxTurns: 5 }));
    const events = new EventBus();
    const loop = new AgentLoop(
      createMockModel(),
      events,
      toolProvider as any,
      memoryProvider as any,
      compressor as any,
    );

    const result = await loop.executeTurn({
      input: { content: 'Hi' },
      turnNumber: 1,
      conversation: [],
      systemPrompt: 'You are test',
      availableTools: {},
    }, state);

    expect(toolProvider.execute).toHaveBeenCalledWith([
      { toolCallId: 'tc1', toolName: 'echo', input: { msg: 'hi' } },
    ]);
    expect(result.completed).toBe(false);
    expect(result.shouldContinue).toBe(true);
    expect(state.conversation.some(m => m.role === 'tool')).toBe(true);
  });

  it('should use memoryProvider to build context', async () => {
    const toolProvider = {
      getToolSet: vi.fn().mockReturnValue({}),
      execute: vi.fn().mockResolvedValue([]),
    };
    const memoryProvider = {
      buildContext: vi.fn().mockResolvedValue({
        systemPrompt: 'Custom system prompt',
        messages: [{ role: 'user', content: 'previous' }],
      }),
    };
    const compressor = { shouldCompress: vi.fn().mockReturnValue(false) };

    vi.mocked(ai.generateText).mockResolvedValueOnce(mockGenerateTextResponse('OK'));

    const state = new AgentState(new IterationBudget({ maxTurns: 5 }));
    const events = new EventBus();
    const loop = new AgentLoop(
      createMockModel(),
      events,
      toolProvider as any,
      memoryProvider as any,
      compressor as any,
    );

    await loop.executeTurn({
      input: { content: 'Hi' },
      turnNumber: 1,
      conversation: [],
      systemPrompt: 'ignored',
      availableTools: {},
    }, state);

    expect(memoryProvider.buildContext).toHaveBeenCalledWith(state);
    expect(ai.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'Custom system prompt',
      }),
    );
  });
```

- [ ] **Step 2: 运行测试（应失败）**

```bash
cd packages/core && npx vitest run tests/loop.test.ts
```

Expected: FAIL — `AgentLoop` 构造函数不接受新参数

- [ ] **Step 3: 改造 loop.ts**

Rewrite `packages/core/src/loop.ts`:

```typescript
import type { ModelMessage, ToolSet, LanguageModelUsage, LanguageModel, TextPart, ToolCallPart } from 'ai';
import { generateText } from 'ai';
import type { AgentState } from './state.js';
import type { EventBus } from './events.js';
import type { AgentOutput } from './types.js';
import type { ToolProvider } from './sdk/tool-provider.js';
import type { MemoryProvider } from './sdk/memory-provider.js';
import type { ContextCompressor } from './sdk/compressor.js';

export interface TurnContext {
  input: { content: string };
  turnNumber: number;
  conversation: ModelMessage[];
  systemPrompt: string;
  availableTools: ToolSet;
}

export interface TurnResult {
  output: AgentOutput;
  toolCalls: { toolCallId: string; toolName: string; input: unknown }[];
  completed: boolean;
  shouldContinue: boolean;
  usage: LanguageModelUsage;
}

export class AgentLoop {
  constructor(
    private model: LanguageModel,
    private events: EventBus,
    private toolProvider: ToolProvider,
    private memoryProvider: MemoryProvider,
    private compressor: ContextCompressor,
  ) {}

  async executeTurn(ctx: TurnContext, state: AgentState): Promise<TurnResult> {
    await this.events.emit('turn:before', { agent: this as any, state });

    state.currentTurn = ctx.turnNumber;

    // === 1. PREPARE: 消息组装 ===
    await this.events.emit('phase:prepare', { agent: this as any, state });

    const { systemPrompt, messages: contextMessages } = await this.memoryProvider.buildContext(state);

    let messages: ModelMessage[] = [
      ...contextMessages,
      { role: 'user', content: ctx.input.content },
    ];

    if (this.compressor.shouldCompress(state)) {
      messages = await this.compressor.compress(messages);
    }

    // === 2. REASON: 调用 LLM ===
    await this.events.emit('phase:reason:before', { agent: this as any, state });
    const tools = this.toolProvider.getToolSet();
    const response = await generateText({
      model: this.model,
      system: systemPrompt,
      messages,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
    });
    await this.events.emit('phase:reason:after', { agent: this as any, state });

    // === 3. EXECUTE: 工具执行 ===
    let toolCallRecords: { toolCallId: string; toolName: string; input: unknown }[] = [];

    if (response.toolCalls.length > 0) {
      await this.events.emit('phase:execute:before', { agent: this as any, state });

      toolCallRecords = response.toolCalls.map(tc => ({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: tc.input,
      }));

      const results = await this.toolProvider.execute(toolCallRecords);

      for (const result of results) {
        state.addMessage({
          role: 'tool',
          toolCallId: result.toolCallId,
          toolName: result.toolName,
          content: result.error ?? result.output,
        } as ModelMessage);
      }

      await this.events.emit('phase:execute:after', { agent: this as any, state });
    }

    // === 4. OBSERVE: 更新状态 ===
    const parts: Array<TextPart | ToolCallPart> = [];
    if (response.text) {
      parts.push({ type: 'text', text: response.text });
    }
    for (const tc of response.toolCalls) {
      parts.push({
        type: 'tool-call',
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: tc.input,
      });
    }

    state.addMessage({
      role: 'assistant',
      content: parts.length === 1 && parts[0].type === 'text'
        ? parts[0].text
        : parts,
    });

    await this.events.emit('turn:after', { agent: this as any, state });

    const completed = response.toolCalls.length === 0;

    return {
      output: {
        content: response.text,
        completed,
      },
      toolCalls: toolCallRecords,
      completed,
      shouldContinue: !completed,
      usage: response.usage,
    };
  }
}
```

- [ ] **Step 4: 更新现有测试（构造函数签名变更）**

修改 `packages/core/tests/loop.test.ts` 中所有 `new AgentLoop(...)` 的调用，注入 mock 策略：

在文件顶部（import 后）添加 mock provider factory：

```typescript
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
  },
});
```

然后修改每个测试中的 `new AgentLoop(...)`：

```typescript
// 原有：
const loop = new AgentLoop(createMockModel(), events);

// 改为：
const mocks = createMockProviders();
const loop = new AgentLoop(createMockModel(), events, mocks.toolProvider, mocks.memoryProvider, mocks.compressor);
```

需要修改 3 个地方（3 个 `it` 块）。

- [ ] **Step 5: 运行测试（应通过）**

```bash
cd packages/core && npx vitest run tests/loop.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/loop.ts packages/core/tests/loop.test.ts
git commit -m "feat(loop): integrate tool execution and message assembly

- Inject ToolProvider, MemoryProvider, ContextCompressor into AgentLoop
- Add PREPARE phase: build context via MemoryProvider, compress if needed
- Add EXECUTE phase: delegate tool calls to ToolProvider
- Tool results appended as 'tool' role messages to conversation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: 改造 core-agent.ts（Harness）

**Files:**
- Modify: `packages/core/src/core-agent.ts`
- Modify: `packages/core/tests/core-agent.test.ts`

- [ ] **Step 1: 写新测试（错误恢复 + 策略注入）**

在 `packages/core/tests/core-agent.test.ts` 中追加新的测试：

```typescript
  it('should inject default providers when not specified', async () => {
    vi.mocked(ai.generateText).mockResolvedValueOnce(mockResponse('Hello!'));

    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
    });

    await agent.initialize();
    const result = await agent.run({ content: 'Hi' });

    expect(result.content).toBe('Hello!');
  });

  it('should retry on retryable API errors', async () => {
    const errorHandler = {
      classify: vi.fn().mockReturnValue('api_error'),
      isRetryable: vi.fn().mockReturnValue(true),
      getRetryInstruction: vi.fn().mockReturnValue('Please try again.'),
    };

    vi.mocked(ai.generateText)
      .mockRejectedValueOnce(new ai.APICallError({ message: 'rate limit', url: 'http://test' }))
      .mockResolvedValueOnce(mockResponse('Recovered!'));

    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
      budget: new IterationBudget({ maxTurns: 5 }),
      errorHandler: errorHandler as any,
    });

    await agent.initialize();
    const result = await agent.run({ content: 'Hi' });

    expect(result.content).toBe('Recovered!');
    expect(ai.generateText).toHaveBeenCalledTimes(2);
  });

  it('should stop on non-retryable errors', async () => {
    const errorHandler = {
      classify: vi.fn().mockReturnValue('unknown'),
      isRetryable: vi.fn().mockReturnValue(false),
      getRetryInstruction: vi.fn(),
    };

    vi.mocked(ai.generateText).mockRejectedValueOnce(new Error('Fatal'));

    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
      errorHandler: errorHandler as any,
    });

    await agent.initialize();
    await expect(agent.run({ content: 'Hi' })).rejects.toThrow('Fatal');
  });
```

- [ ] **Step 2: 运行测试（应失败）**

```bash
cd packages/core && npx vitest run tests/core-agent.test.ts
```

Expected: FAIL — `CoreAgent` 构造函数不接受 `errorHandler` 参数

- [ ] **Step 3: 改造 core-agent.ts**

Rewrite `packages/core/src/core-agent.ts`:

```typescript
import type { UserInput, AgentOutput, ModelMessage } from './types.js';
import type { LanguageModel } from 'ai';
import { AgentState } from './state.js';
import { AgentLoop } from './loop.js';
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

export interface CoreAgentConfig {
  name: string;
  model: LanguageModel;
  budget?: IterationBudget;
  toolProvider?: ToolProvider;
  memoryProvider?: MemoryProvider;
  errorHandler?: ErrorHandler;
  budgetPolicy?: BudgetPolicy;
  compressor?: ContextCompressor;
}

export class CoreAgent {
  private config: CoreAgentConfig;
  private loop: AgentLoop | null = null;
  private events: EventBus;
  private state: AgentState;
  private interrupted = false;

  get status() {
    return this.state.status;
  }

  constructor(config: CoreAgentConfig) {
    this.config = config;
    this.events = new EventBus();
    this.state = new AgentState(config.budget);
  }

  private _getLoop(): AgentLoop {
    if (!this.loop) {
      this.loop = new AgentLoop(
        this.config.model,
        this.events,
        this.config.toolProvider ?? new InMemoryToolProvider(),
        this.config.memoryProvider ?? new SimpleMemoryProvider(this.config.name),
        this.config.compressor ?? new NoOpCompressor(),
      );
    }
    return this.loop;
  }

  private _getBudgetPolicy(): BudgetPolicy {
    return this.config.budgetPolicy ?? new FixedBudgetPolicy({
      maxTurns: this.state.budget.getStatus().turnsRemaining + this.state.budget.turnCount,
    });
  }

  private _getErrorHandler(): ErrorHandler {
    return this.config.errorHandler ?? new SimpleErrorHandler();
  }

  async initialize(options?: { sessionId?: string; messages?: ModelMessage[] }): Promise<void> {
    if (options?.sessionId) {
      this.state = new AgentState(this.config.budget);
      (this.state as any).sessionId = options.sessionId;
    }
    if (options?.messages) {
      this.state.conversation = options.messages;
    }
    this.state.status = 'idle';
    await this.events.emit('core-agent:init', { agent: this, state: this.state });
  }

  async run(input: UserInput): Promise<AgentOutput> {
    this.state.status = 'running';
    this.interrupted = false;
    await this.events.emit('core-agent:start', { agent: this, state: this.state });

    const budgetPolicy = this._getBudgetPolicy();
    const errorHandler = this._getErrorHandler();
    const startTime = Date.now();
    let turnNumber = this.state.currentTurn + 1;

    try {
      while (this.state.canContinue() && !this.interrupted) {
        // 预算检查
        if (!budgetPolicy.checkTurn(this.state) || !budgetPolicy.checkTimeout(startTime)) {
          break;
        }

        try {
          const result = await this._getLoop().executeTurn({
            input,
            turnNumber,
            conversation: this.state.conversation,
            systemPrompt: `You are ${this.config.name}.`,
            availableTools: {},
          }, this.state);

          if (result.completed || this.interrupted) {
            this.state.status = 'idle';
            return {
              content: this.interrupted
                ? 'Response interrupted.'
                : result.output.content,
              completed: true,
            };
          }

          turnNumber++;
        } catch (error) {
          const category = errorHandler.classify(error);
          if (!errorHandler.isRetryable(category)) {
            this.state.status = 'error';
            await this.events.emit('core-agent:error', { agent: this, state: this.state });
            throw error;
          }

          // 重试：注入重试指令到下一轮
          const instruction = errorHandler.getRetryInstruction(category);
          if (instruction) {
            input = { content: `${input.content}\n\n[System: ${instruction}]` };
          }

          turnNumber++;
        }
      }

      this.state.status = 'idle';
      return {
        content: this.interrupted
          ? 'Response interrupted.'
          : 'Budget exceeded.',
        completed: true,
      };
    } catch (error) {
      this.state.status = 'error';
      await this.events.emit('core-agent:error', { agent: this, state: this.state });
      throw error;
    }
  }

  interrupt(): void {
    this.interrupted = true;
  }

  async reset(): Promise<void> {
    this.state.reset();
    this.loop = null;
    await this.events.emit('core-agent:init', { agent: this, state: this.state });
  }

  on(event: AgentEvent, handler: EventHandler): () => void {
    return this.events.on(event, handler);
  }

  once(event: AgentEvent, handler: EventHandler): void {
    this.events.once(event, handler);
  }
}
```

- [ ] **Step 4: 更新现有测试（构造函数签名变更）**

`packages/core/tests/core-agent.test.ts` 中现有的测试使用 `new CoreAgent({ name, model })` 签名，改造后的构造函数仍然接受这些参数（其余为可选），所以现有测试不需要修改。但需要确保 `run()` 中的循环逻辑变化不会破坏现有行为。

检查现有测试是否通过：
- `should initialize with idle status` — 只检查 status，不受影响
- `should run a single turn and complete` — 需要确保 `FixedBudgetPolicy` 默认值正确
- `should reset session state` — 需要确保 `loop = null` 在 reset 中
- `should allow event subscription` — 不受影响
- `should handle interrupt` — 需要确保 interrupt 逻辑仍然有效

修改 `should run a single turn and complete` 测试，可能需要调整 mock 的 memoryProvider：

实际上，由于 `SimpleMemoryProvider` 使用 `this.config.name` 构建系统提示，而现有测试中 `name: 'test'`，这应该正常工作。`FixedBudgetPolicy` 使用 `state.budget.getStatus().turnsRemaining + state.budget.turnCount` 计算 maxTurns，对于默认 IterationBudget（maxTurns: 60），这应该返回 60。

现有测试应该不需要修改就能通过，但需要验证。

- [ ] **Step 5: 运行测试（应通过）**

```bash
cd packages/core && npx vitest run tests/core-agent.test.ts
```

Expected: PASS（所有测试，包括新测试）

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/core-agent.ts packages/core/tests/core-agent.test.ts
git commit -m "feat(harness): inject strategy providers and add error recovery loop

- CoreAgent accepts optional ToolProvider, MemoryProvider, ErrorHandler, BudgetPolicy, ContextCompressor
- Defaults created lazily when not injected
- Outer loop catches errors, classifies via ErrorHandler, retries if retryable
- Retry instructions injected into next turn's input

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: 更新 index.ts 导出

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 更新导出**

Rewrite `packages/core/src/index.ts`:

```typescript
export * from './types.js';
export * from './budget.js';
export * from './state.js';
export * from './events.js';
export * from './loop.js';
export * from './core-agent.js';
export * from './sdk/index.js';
export * from './defaults/index.js';
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "chore(exports): add SDK and defaults to public API

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: 端到端验证

- [ ] **Step 1: 运行全部测试**

```bash
cd packages/core && npx vitest run
```

Expected: 全部通过（11 个测试文件，约 25+ 个测试用例）

- [ ] **Step 2: 运行类型检查**

```bash
cd packages/core && npm run typecheck
```

Expected: 无类型错误

- [ ] **Step 3: 运行构建**

```bash
cd packages/core && npm run build
```

Expected: 编译成功，dist/ 目录生成

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: verify full test suite passes with new architecture

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

### Spec Coverage

| 设计文档章节 | 实现任务 | 状态 |
|-------------|---------|------|
| 3.1 harness.ts | Task 10 | ✅ |
| 3.2 loop.ts | Task 9 | ✅ |
| 4.1 ToolProvider 接口 | Task 1 Step 1 | ✅ |
| 4.2 MemoryProvider 接口 | Task 1 Step 2 | ✅ |
| 4.3 ContextCompressor 接口 | Task 1 Step 5 | ✅ |
| 4.4 ErrorHandler 接口 | Task 1 Step 3 | ✅ |
| 4.5 BudgetPolicy 接口 | Task 1 Step 4 | ✅ |
| 5.1 InMemoryToolProvider | Task 2 | ✅ |
| 5.2 SimpleMemoryProvider | Task 3 | ✅ |
| 5.3 NoOpCompressor | Task 6 | ✅ |
| 5.4 SimpleErrorHandler | Task 4 | ✅ |
| 5.5 FixedBudgetPolicy | Task 5 | ✅ |

### Placeholder Scan

- 无 "TBD", "TODO", "implement later" ✅
- 所有步骤包含完整代码 ✅
- 所有步骤包含运行命令和预期输出 ✅

### Type Consistency

- `ToolProvider` 接口和 `InMemoryToolProvider` 实现方法签名一致 ✅
- `BudgetPolicy` 接口和 `FixedBudgetPolicy` 实现方法签名一致 ✅
- `AgentLoop` 构造函数参数在所有测试中一致 ✅

---

*计划完成日期：2026-06-11*
*基于设计文档：`docs/superpowers/specs/2026-06-11-agent-core-layering-design.md`*
