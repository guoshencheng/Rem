# Core Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Core layer of the Agent Harness system: AgentHarness, AgentLoop, AgentState, EventBus, IterationBudget, and ModelClient interface.

**Architecture:** Core is a minimal, self-contained engine that runs the ReAct loop. It knows nothing about plugins, channels, or CLI — it only executes turns and emits events. State is kept in-memory; persistence is handled by the State layer via event hooks.

**Tech Stack:** TypeScript, Node.js 20+, Vitest for testing

**Key Design Decision:** `ModelClient` is a pure interface in Core. The default `OpenAICompatibleClient` implementation lives in `src/plugins/model-providers/` and depends on the `openai` SDK. This allows Core to be tested with mocks while users get an out-of-the-box OpenAI-compatible provider.

---

## File Structure

```
src/
├── core/
│   ├── types.ts              # Shared types (Message, ToolCall, etc.)
│   ├── budget.ts             # IterationBudget — turn/error/failure counting
│   ├── state.ts              # AgentState — in-memory session state
│   ├── events.ts             # EventBus — typed event emitter with priorities
│   ├── model-client.ts       # ModelClient interface (pure, no deps)
│   ├── loop.ts               # AgentLoop — ReAct turn execution
│   └── harness.ts            # AgentHarness — lifecycle orchestrator
├── plugins/
│   └── model-providers/
│       └── openai-compatible.ts  # Default ModelClient impl (uses 'openai' SDK)
tests/
├── core/
│   ├── budget.test.ts
│   ├── state.test.ts
│   ├── events.test.ts
│   ├── loop.test.ts
│   ├── harness.test.ts
│   └── mock-model-client.ts    # Shared mock for tests
```

---

## Task 1: Project Bootstrap

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "agent-harness",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  },
  "dependencies": {
    "openai": "^4.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts
git commit -m "chore: bootstrap TypeScript project with Vitest"
```

---

## Task 2: Core Types

**Files:**
- Create: `src/core/types.ts`

- [ ] **Step 1: Write types**

```typescript
// src/core/types.ts

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  timestamp: Date;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

export interface ToolCallRecord extends ToolCall {
  result?: ToolResult;
  error?: string;
  durationMs: number;
  timestamp: Date;
}

export interface UserInput {
  content: string;
  timestamp?: Date;
}

export interface AgentOutput {
  content: string;
  toolCalls: ToolCallRecord[];
  completed: boolean;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type AgentStatus = 'idle' | 'running' | 'error';

export interface ModelConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/core/types.ts
git commit -m "feat(core): add shared types for messages, tools, and LLM responses"
```

---

## Task 3: IterationBudget

**Files:**
- Create: `src/core/budget.ts`
- Test: `tests/core/budget.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/core/budget.test.ts
import { describe, it, expect } from 'vitest';
import { IterationBudget } from '../../src/core/budget.js';

describe('IterationBudget', () => {
  it('should allow turns within budget', () => {
    const budget = new IterationBudget({ maxTurns: 3 });
    expect(budget.checkTurn()).toBe(true);
    expect(budget.checkTurn()).toBe(true);
    expect(budget.checkTurn()).toBe(true);
  });

  it('should deny turns when maxTurns exceeded', () => {
    const budget = new IterationBudget({ maxTurns: 2 });
    budget.checkTurn();
    budget.checkTurn();
    expect(budget.checkTurn()).toBe(false);
    expect(budget.getStatus().reason).toBe('max_turns exceeded');
  });

  it('should track consecutive errors', () => {
    const budget = new IterationBudget({ maxConsecutiveErrors: 2 });
    budget.recordError();
    expect(budget.hasBudget()).toBe(true);
    budget.recordError();
    expect(budget.hasBudget()).toBe(false);
  });

  it('should reset consecutive errors on success', () => {
    const budget = new IterationBudget({ maxConsecutiveErrors: 2 });
    budget.recordError();
    budget.recordSuccess();
    budget.recordError();
    expect(budget.hasBudget()).toBe(true);
  });

  it('should track same-tool failures', () => {
    const budget = new IterationBudget({ maxSameToolFailures: 2 });
    budget.recordError('tool:a');
    budget.recordError('tool:a');
    expect(budget.hasBudget()).toBe(false);
  });

  it('should report at-risk status', () => {
    const budget = new IterationBudget({ maxTurns: 10 });
    for (let i = 0; i < 8; i++) budget.checkTurn();
    const status = budget.getStatus();
    expect(status.atRisk).toBe(true);
    expect(status.turnsRemaining).toBe(2);
  });
});
```

Run: `npx vitest run tests/core/budget.test.ts`
Expected: FAIL — "IterationBudget" module not found

- [ ] **Step 2: Implement IterationBudget**

```typescript
// src/core/budget.ts

export interface BudgetConfig {
  maxTurns: number;
  maxConsecutiveErrors: number;
  maxSameToolFailures: number;
}

export interface BudgetStatus {
  turnsRemaining: number;
  consecutiveErrors: number;
  atRisk: boolean;
  reason?: string;
}

export class IterationBudget {
  private config: BudgetConfig;
  turnCount = 0;
  consecutiveErrors = 0;
  sameToolFailures = new Map<string, number>();

  constructor(config: Partial<BudgetConfig> & Pick<BudgetConfig, 'maxTurns'>) {
    this.config = {
      maxTurns: config.maxTurns,
      maxConsecutiveErrors: config.maxConsecutiveErrors ?? 3,
      maxSameToolFailures: config.maxSameToolFailures ?? 5,
    };
  }

  checkTurn(): boolean {
    if (this.turnCount >= this.config.maxTurns) {
      return false;
    }
    this.turnCount++;
    return true;
  }

  hasBudget(): boolean {
    return this.turnCount < this.config.maxTurns
      && this.consecutiveErrors < this.config.maxConsecutiveErrors;
  }

  recordError(toolName?: string): void {
    this.consecutiveErrors++;
    if (toolName) {
      const current = this.sameToolFailures.get(toolName) ?? 0;
      this.sameToolFailures.set(toolName, current + 1);
    }
  }

  recordSuccess(toolName?: string): void {
    this.consecutiveErrors = 0;
    if (toolName) {
      this.sameToolFailures.delete(toolName);
    }
  }

  getStatus(): BudgetStatus {
    const turnsRemaining = Math.max(0, this.config.maxTurns - this.turnCount);
    const atRisk = turnsRemaining <= 3 || this.consecutiveErrors >= this.config.maxConsecutiveErrors - 1;

    let reason: string | undefined;
    if (this.turnCount >= this.config.maxTurns) {
      reason = 'max_turns exceeded';
    } else if (this.consecutiveErrors >= this.config.maxConsecutiveErrors) {
      reason = 'max_consecutive_errors exceeded';
    }

    return { turnsRemaining, consecutiveErrors: this.consecutiveErrors, atRisk, reason };
  }
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/core/budget.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/core/budget.ts tests/core/budget.test.ts
git commit -m "feat(core): add IterationBudget with turn/error/failure tracking"
```

---

## Task 4: AgentState

**Files:**
- Create: `src/core/state.ts`
- Test: `tests/core/state.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/core/state.test.ts
import { describe, it, expect } from 'vitest';
import { AgentState } from '../../src/core/state.js';
import { IterationBudget } from '../../src/core/budget.js';

describe('AgentState', () => {
  it('should initialize with idle status', () => {
    const state = new AgentState();
    expect(state.status).toBe('idle');
    expect(state.conversation).toHaveLength(0);
    expect(state.currentTurn).toBe(0);
  });

  it('should add messages', () => {
    const state = new AgentState();
    state.addMessage({ role: 'user', content: 'hello', timestamp: new Date() });
    expect(state.conversation).toHaveLength(1);
    expect(state.conversation[0].role).toBe('user');
  });

  it('should track tool calls', () => {
    const state = new AgentState();
    state.addToolCall({
      id: '1',
      name: 'test',
      arguments: {},
      durationMs: 100,
      timestamp: new Date(),
    });
    expect(state.toolCalls).toHaveLength(1);
  });

  it('should report canContinue when budget allows', () => {
    const state = new AgentState();
    state.status = 'running';
    expect(state.canContinue()).toBe(true);
  });

  it('should deny canContinue when status is error', () => {
    const state = new AgentState();
    state.status = 'error';
    expect(state.canContinue()).toBe(false);
  });

  it('should generate unique session IDs', () => {
    const a = new AgentState();
    const b = new AgentState();
    expect(a.sessionId).not.toBe(b.sessionId);
  });
});
```

Run: `npx vitest run tests/core/state.test.ts`
Expected: FAIL

- [ ] **Step 2: Implement AgentState**

```typescript
// src/core/state.ts

import { randomUUID } from 'crypto';
import type { Message, ToolCallRecord, AgentStatus } from './types.js';
import { IterationBudget } from './budget.js';

export class AgentState {
  readonly sessionId: string;
  conversation: Message[] = [];
  currentTurn = 0;
  budget: IterationBudget;
  toolCalls: ToolCallRecord[] = [];
  status: AgentStatus = 'idle';

  constructor(budget?: IterationBudget) {
    this.sessionId = randomUUID();
    this.budget = budget ?? new IterationBudget({ maxTurns: 60 });
  }

  addMessage(msg: Message): void {
    this.conversation.push(msg);
  }

  addToolCall(record: ToolCallRecord): void {
    this.toolCalls.push(record);
  }

  canContinue(): boolean {
    return this.status === 'running' && this.budget.hasBudget();
  }

  reset(): void {
    this.conversation = [];
    this.currentTurn = 0;
    this.toolCalls = [];
    this.status = 'idle';
    this.budget = new IterationBudget({ maxTurns: this.budget['config'].maxTurns });
  }
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/core/state.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/core/state.ts tests/core/state.test.ts
git commit -m "feat(core): add AgentState with message tracking and budget integration"
```

---

## Task 5: EventBus

**Files:**
- Create: `src/core/events.ts`
- Test: `tests/core/events.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/core/events.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/core/events.js';
import type { AgentEvent, EventContext, EventHandler } from '../../src/core/events.js';

describe('EventBus', () => {
  it('should call handlers in priority order', async () => {
    const bus = new EventBus();
    const order: number[] = [];

    bus.on('turn:before', () => { order.push(2); }, 50);
    bus.on('turn:before', () => { order.push(1); }, 100);
    bus.on('turn:before', () => { order.push(3); }, 10);

    await bus.emit('turn:before', { harness: {} as any, state: {} as any });
    expect(order).toEqual([1, 2, 3]);
  });

  it('should allow unsubscribing', async () => {
    const bus = new EventBus();
    const handler = vi.fn();

    const off = bus.on('turn:before', handler);
    off();

    await bus.emit('turn:before', { harness: {} as any, state: {} as any });
    expect(handler).not.toHaveBeenCalled();
  });

  it('should pass context to handlers', async () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('turn:after', handler);
    const ctx = { harness: {} as any, state: { currentTurn: 5 } as any };

    await bus.emit('turn:after', ctx);
    expect(handler).toHaveBeenCalledWith(ctx);
  });

  it('should handle async handlers', async () => {
    const bus = new EventBus();
    let resolved = false;

    bus.on('turn:before', async () => {
      await new Promise(r => setTimeout(r, 10));
      resolved = true;
    });

    await bus.emit('turn:before', { harness: {} as any, state: {} as any });
    expect(resolved).toBe(true);
  });
});
```

Run: `npx vitest run tests/core/events.test.ts`
Expected: FAIL

- [ ] **Step 2: Implement EventBus**

```typescript
// src/core/events.ts

import type { AgentState } from './state.js';

export type AgentEvent =
  | 'harness:init' | 'harness:start' | 'harness:error'
  | 'turn:before' | 'turn:after'
  | 'phase:prepare' | 'phase:reason:before' | 'phase:reason:after'
  | 'phase:execute:before' | 'phase:execute:after'
  | 'phase:observe' | 'phase:reflect'
  | 'tool:before' | 'tool:after' | 'tool:error'
  | 'compress:before' | 'compress:after';

export interface EventContext {
  harness: unknown;
  state: AgentState;
  turn?: unknown;
  turnResult?: unknown;
  toolCall?: unknown;
}

export type EventHandler = (ctx: EventContext) => Promise<void> | void;

interface HandlerEntry {
  handler: EventHandler;
  priority: number;
}

export class EventBus {
  private handlers = new Map<AgentEvent, HandlerEntry[]>();

  on(event: AgentEvent, handler: EventHandler, priority = 50): () => void {
    const list = this.handlers.get(event) ?? [];
    list.push({ handler, priority });
    list.sort((a, b) => b.priority - a.priority);
    this.handlers.set(event, list);

    return () => {
      const updated = list.filter(h => h.handler !== handler);
      this.handlers.set(event, updated);
    };
  }

  once(event: AgentEvent, handler: EventHandler, priority = 50): void {
    const off = this.on(event, async (ctx) => {
      off();
      await handler(ctx);
    }, priority);
  }

  async emit(event: AgentEvent, ctx: EventContext): Promise<void> {
    const list = this.handlers.get(event) ?? [];
    for (const entry of list) {
      await entry.handler(ctx);
    }
  }
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/core/events.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/core/events.ts tests/core/events.test.ts
git commit -m "feat(core): add EventBus with priority-ordered async handlers"
```

---

## Task 6: ModelClient Interface + Default Implementation

**Files:**
- Create: `src/core/model-client.ts` (pure interface)
- Create: `src/plugins/model-providers/openai-compatible.ts` (default impl)
- Create: `tests/core/mock-model-client.ts` (shared mock for tests)
- Test: `tests/core/model-client.test.ts` (compile check)

- [ ] **Step 1: Write ModelClient interface in Core**

```typescript
// src/core/model-client.ts

import type { Message, LLMResponse, ToolDefinition, TokenUsage } from './types.js';

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
}

export interface ModelClient {
  chat(messages: Message[], options?: ChatOptions): Promise<LLMResponse>;
}
```

- [ ] **Step 2: Write default OpenAI-compatible implementation**

```typescript
// src/plugins/model-providers/openai-compatible.ts

import { OpenAI } from 'openai';
import type { Message, LLMResponse, ModelConfig, ToolDefinition } from '../../core/types.js';
import type { ChatOptions, ModelClient } from '../../core/model-client.js';

export class OpenAICompatibleClient implements ModelClient {
  private client: OpenAI;
  private model: string;

  constructor(config: ModelConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this.model = config.model;
  }

  async chat(messages: Message[], options: ChatOptions = {}): Promise<LLMResponse> {
    const formattedMessages = messages.map(m => ({
      role: m.role,
      content: m.content,
      tool_calls: m.toolCalls,
      tool_call_id: m.toolCallId,
    }));

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: formattedMessages as any,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens,
      tools: options.tools?.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
    });

    const choice = response.choices[0];
    const message = choice.message;

    return {
      content: message.content ?? '',
      toolCalls: message.tool_calls?.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      })),
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
    };
  }
}
```

- [ ] **Step 3: Write shared mock for tests**

```typescript
// tests/core/mock-model-client.ts

import type { Message, LLMResponse, ChatOptions, ModelClient } from '../../src/core/model-client.js';

export function createMockModelClient(
  response: LLMResponse = { content: 'Mock response' }
): ModelClient {
  return {
    chat: async (_messages: Message[], _options?: ChatOptions): Promise<LLMResponse> => response,
  };
}
```

- [ ] **Step 4: Verify everything compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/core/model-client.ts src/plugins/model-providers/openai-compatible.ts tests/core/mock-model-client.ts
git commit -m "feat(core): add ModelClient interface + OpenAI-compatible default impl"
```

---

## Task 7: AgentLoop

**Files:**
- Create: `src/core/loop.ts`
- Test: `tests/core/loop.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/core/loop.test.ts
import { describe, it, expect, vi } from 'vitest';
import { AgentLoop } from '../../src/core/loop.js';
import { AgentState } from '../../src/core/state.js';
import { EventBus } from '../../src/core/events.js';
import { IterationBudget } from '../../src/core/budget.js';
import { createMockModelClient } from './mock-model-client.js';

describe('AgentLoop', () => {
  it('should execute a simple turn without tools', async () => {
    const modelClient = createMockModelClient({
      content: 'Hello!',
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
    });

    const state = new AgentState(new IterationBudget({ maxTurns: 5 }));
    const events = new EventBus();
    const loop = new AgentLoop(modelClient, events);

    const result = await loop.executeTurn({
      input: { content: 'Hi' },
      turnNumber: 1,
      conversation: [],
      systemPrompt: 'You are helpful',
      availableTools: [],
    }, state);

    expect(result.output.content).toBe('Hello!');
    expect(result.completed).toBe(true);
    expect(result.shouldContinue).toBe(false);
  });

  it('should emit turn events', async () => {
    const modelClient = createMockModelClient({ content: 'OK' });
    const state = new AgentState(new IterationBudget({ maxTurns: 5 }));
    const events = new EventBus();
    const beforeHandler = vi.fn();
    const afterHandler = vi.fn();

    events.on('turn:before', beforeHandler);
    events.on('turn:after', afterHandler);

    const loop = new AgentLoop(modelClient, events);
    await loop.executeTurn({
      input: { content: 'test' },
      turnNumber: 1,
      conversation: [],
      systemPrompt: '',
      availableTools: [],
    }, state);

    expect(beforeHandler).toHaveBeenCalled();
    expect(afterHandler).toHaveBeenCalled();
  });

  it('should stop when budget is exhausted', async () => {
    const modelClient = createMockModelClient({ content: '...' });
    const state = new AgentState(new IterationBudget({ maxTurns: 1 }));
    state.budget.checkTurn(); // Use up the one turn
    const events = new EventBus();
    const loop = new AgentLoop(modelClient, events);

    const result = await loop.executeTurn({
      input: { content: 'test' },
      turnNumber: 2,
      conversation: [],
      systemPrompt: '',
      availableTools: [],
    }, state);

    expect(result.completed).toBe(true);
    expect(result.shouldContinue).toBe(false);
  });
});
```

Run: `npx vitest run tests/core/loop.test.ts`
Expected: FAIL

- [ ] **Step 2: Implement AgentLoop**

```typescript
// src/core/loop.ts

import type { Message, UserInput, AgentOutput, ToolDefinition, ToolCallRecord } from './types.js';
import type { AgentState } from './state.js';
import type { EventBus } from './events.js';
import type { ModelClient } from './model-client.js';

export interface TurnContext {
  input: UserInput;
  turnNumber: number;
  conversation: Message[];
  systemPrompt: string;
  availableTools: ToolDefinition[];
}

export interface TurnResult {
  output: AgentOutput;
  toolCalls: ToolCallRecord[];
  completed: boolean;
  shouldContinue: boolean;
}

export class AgentLoop {
  constructor(
    private modelClient: ModelClient,
    private events: EventBus,
  ) {}

  async executeTurn(ctx: TurnContext, state: AgentState): Promise<TurnResult> {
    await this.events.emit('turn:before', { harness: this as any, state });

    if (!state.budget.checkTurn()) {
      return {
        output: { content: 'Budget exceeded.', toolCalls: [], completed: true },
        toolCalls: [],
        completed: true,
        shouldContinue: false,
      };
    }

    state.currentTurn = ctx.turnNumber;

    const messages: Message[] = [
      { role: 'system', content: ctx.systemPrompt, timestamp: new Date() },
      ...ctx.conversation,
      { role: 'user', content: ctx.input.content, timestamp: new Date() },
    ];

    await this.events.emit('phase:reason:before', { harness: this as any, state });
    const response = await this.modelClient.chat(messages, {
      tools: ctx.availableTools,
    });
    await this.events.emit('phase:reason:after', { harness: this as any, state });

    if (!response.toolCalls || response.toolCalls.length === 0) {
      state.addMessage({ role: 'assistant', content: response.content, timestamp: new Date() });
      await this.events.emit('turn:after', { harness: this as any, state });
      return {
        output: { content: response.content, toolCalls: [], completed: true },
        toolCalls: [],
        completed: true,
        shouldContinue: false,
      };
    }

    state.addMessage({
      role: 'assistant',
      content: response.content,
      toolCalls: response.toolCalls,
      timestamp: new Date(),
    });

    const toolCallRecords: ToolCallRecord[] = response.toolCalls.map(tc => ({
      ...tc,
      durationMs: 0,
      timestamp: new Date(),
    }));

    await this.events.emit('turn:after', { harness: this as any, state });

    return {
      output: {
        content: response.content,
        toolCalls: toolCallRecords,
        completed: false,
      },
      toolCalls: toolCallRecords,
      completed: false,
      shouldContinue: true,
    };
  }
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/core/loop.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/core/loop.ts tests/core/loop.test.ts
git commit -m "feat(core): add AgentLoop with ReAct turn execution"
```

---

## Task 8: AgentHarness

**Files:**
- Create: `src/core/harness.ts`
- Test: `tests/core/harness.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/core/harness.test.ts
import { describe, it, expect, vi } from 'vitest';
import { AgentHarness } from '../../src/core/harness.js';
import { IterationBudget } from '../../src/core/budget.js';
import { createMockModelClient } from './mock-model-client.js';

describe('AgentHarness', () => {
  it('should initialize with idle status', () => {
    const harness = new AgentHarness({
      name: 'test-agent',
      modelConfig: { provider: 'openai', model: 'gpt-4', apiKey: 'test' },
    });
    expect(harness.status).toBe('idle');
  });

  it('should run a single turn and complete', async () => {
    const modelClient = createMockModelClient({
      content: 'Done!',
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
    });

    const harness = new AgentHarness({
      name: 'test',
      modelConfig: { provider: 'openai', model: 'gpt-4', apiKey: 'test' },
      modelClient,
      budget: new IterationBudget({ maxTurns: 5 }),
    });

    await harness.initialize();
    const result = await harness.run({ content: 'Hello' });

    expect(result.content).toBe('Done!');
    expect(harness.status).toBe('idle');
  });

  it('should reset session state', async () => {
    const modelClient = createMockModelClient({ content: 'OK' });

    const harness = new AgentHarness({
      name: 'test',
      modelConfig: { provider: 'openai', model: 'gpt-4', apiKey: 'test' },
      modelClient,
      budget: new IterationBudget({ maxTurns: 5 }),
    });

    await harness.initialize();
    await harness.run({ content: 'Hello' });
    expect(harness['state'].conversation.length).toBeGreaterThan(0);

    await harness.reset();
    expect(harness['state'].conversation).toHaveLength(0);
    expect(harness.status).toBe('idle');
  });

  it('should allow event subscription', async () => {
    const harness = new AgentHarness({
      name: 'test',
      modelConfig: { provider: 'openai', model: 'gpt-4', apiKey: 'test' },
    });

    const handler = vi.fn();
    harness.on('harness:start', handler);

    await harness.initialize();
    expect(handler).toHaveBeenCalled();
  });

  it('should handle interrupt', async () => {
    const modelClient = createMockModelClient({ content: 'Late response' });

    const harness = new AgentHarness({
      name: 'test',
      modelConfig: { provider: 'openai', model: 'gpt-4', apiKey: 'test' },
      modelClient,
    });

    await harness.initialize();
    const runPromise = harness.run({ content: 'Slow' });
    harness.interrupt();

    const result = await runPromise;
    expect(result.content).toContain('interrupted');
  });
});
```

Run: `npx vitest run tests/core/harness.test.ts`
Expected: FAIL

- [ ] **Step 2: Implement AgentHarness**

```typescript
// src/core/harness.ts

import { randomUUID } from 'crypto';
import type { UserInput, AgentOutput, Message, AgentStatus, ModelConfig } from './types.js';
import { AgentState } from './state.js';
import { AgentLoop } from './loop.js';
import { EventBus } from './events.js';
import { IterationBudget } from './budget.js';
import type { ModelClient } from './model-client.js';
import type { AgentEvent, EventHandler } from './events.js';

export interface AgentHarnessConfig {
  name: string;
  modelConfig: ModelConfig;
  modelClient?: ModelClient;
  budget?: IterationBudget;
}

export class AgentHarness {
  private config: AgentHarnessConfig;
  private loop: AgentLoop;
  private events: EventBus;
  private state: AgentState;
  private modelClient: ModelClient;
  private interrupted = false;

  get status(): AgentStatus {
    return this.state.status;
  }

  constructor(config: AgentHarnessConfig) {
    this.config = config;
    this.events = new EventBus();
    this.modelClient = config.modelClient ?? this._createDefaultModelClient(config.modelConfig);
    this.loop = new AgentLoop(this.modelClient, this.events);
    this.state = new AgentState(config.budget);
  }

  private _createDefaultModelClient(_config: ModelConfig): ModelClient {
    // Default implementation will be injected by the assembler.
    // This should never be called if the assembler properly provides a client.
    throw new Error(
      'No ModelClient provided. Use OpenAICompatibleClient from "@agent-harness/openai-provider" or provide a custom implementation.'
    );
  }

  async initialize(options?: { sessionId?: string; messages?: Message[] }): Promise<void> {
    if (options?.sessionId) {
      this.state = new AgentState(this.config.budget);
      (this.state as any).sessionId = options.sessionId;
    }
    if (options?.messages) {
      this.state.conversation = options.messages;
    }
    this.state.status = 'idle';
    await this.events.emit('harness:init', { harness: this, state: this.state });
  }

  async run(input: UserInput): Promise<AgentOutput> {
    this.state.status = 'running';
    this.interrupted = false;
    await this.events.emit('harness:start', { harness: this, state: this.state });

    try {
      let turnNumber = this.state.currentTurn + 1;

      while (this.state.canContinue() && !this.interrupted) {
        const result = await this.loop.executeTurn({
          input,
          turnNumber,
          conversation: this.state.conversation,
          systemPrompt: `You are ${this.config.name}.`,
          availableTools: [], // Phase 1: no tools
        }, this.state);

        if (result.completed || this.interrupted) {
          this.state.status = 'idle';
          return {
            content: this.interrupted
              ? 'Response interrupted.'
              : result.output.content,
            toolCalls: result.toolCalls,
            completed: true,
          };
        }

        turnNumber++;
      }

      this.state.status = 'idle';
      return {
        content: 'Budget exceeded.',
        toolCalls: [],
        completed: true,
      };
    } catch (error) {
      this.state.status = 'error';
      await this.events.emit('harness:error', { harness: this, state: this.state });
      throw error;
    }
  }

  interrupt(): void {
    this.interrupted = true;
  }

  async reset(): Promise<void> {
    this.state.reset();
    await this.events.emit('harness:init', { harness: this, state: this.state });
  }

  on(event: AgentEvent, handler: EventHandler): () => void {
    return this.events.on(event, handler);
  }

  once(event: AgentEvent, handler: EventHandler): void {
    this.events.once(event, handler);
  }
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/core/harness.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/core/harness.ts tests/core/harness.test.ts
git commit -m "feat(core): add AgentHarness lifecycle orchestrator"
```

---

## Self-Review

### Spec Coverage Check

| Spec 章节 | 实现任务 | 状态 |
|----------|---------|------|
| AgentHarness 生命周期 | Task 8 | ✅ |
| AgentLoop ReAct 循环 | Task 7 | ✅ |
| AgentState 状态管理 | Task 4 | ✅ |
| EventBus 事件系统 | Task 5 | ✅ |
| IterationBudget | Task 3 | ✅ |
| ModelClient 接口 | Task 6 | ✅ |
| ModelClient 默认实现 | Task 6 | ✅ |
| Core 类型定义 | Task 2 | ✅ |

### Placeholder Scan

- No TBD/TODO/placeholder content ✅
- All steps have concrete code ✅
- All tests have actual assertions ✅

### Type Consistency Check

- `AgentStatus` used consistently across state.ts and harness.ts ✅
- `Message` type used across types.ts, state.ts, loop.ts ✅
- Event types match between events.ts and harness.ts ✅
- `ModelClient` interface used consistently across model-client.ts, loop.ts, harness.ts ✅

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-10-core-layer.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
