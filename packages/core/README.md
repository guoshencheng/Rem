# rem-agent-core

Core layer of the Rem Agent framework. Provides the foundational primitives for running AI agents with a ReAct-style turn loop, state management, event-driven observability, and budget control.

---

## Architecture Overview

The Core is organized around a lifecycle agent that orchestrates a turn-based execution loop.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CoreAgent                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │   initialize │  │     run()    │  │    reset()   │              │
│  └──────────────┘  └──────┬───────┘  └──────────────┘              │
│                           │                                         │
│                           ▼                                         │
│                    ┌──────────────┐                                 │
│                    │  AgentLoop   │                                 │
│                    │ executeTurn()│                                 │
│                    └──────┬───────┘                                 │
│                           │                                         │
│              ┌────────────┼────────────┐                           │
│              ▼            ▼            ▼                           │
│      ┌──────────┐  ┌──────────┐  ┌──────────┐                     │
│      │AgentState│  │EventBus  │  │ ai SDK   │                     │
│      └──────────┘  └──────────┘  │generateText│                   │
│                                  └──────────┘                     │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │              IterationBudget (guard rails)                  │  │
│  └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow

A single `run()` invocation flows through these phases:

1. **Initialize** — `CoreAgent.initialize()` resets state, assigns `sessionId`, and emits `core-agent:init`.
2. **Start** — `CoreAgent.run(input)` sets status to `running`, emits `core-agent:start`, and enters the turn loop.
3. **Turn Execution** — `AgentLoop.executeTurn()` runs one ReAct cycle:
   - **Prepare** — Builds message list from conversation history + user input.
   - **Reason** — Calls `generateText({ model, system, messages, tools })` via the Vercel AI SDK.
   - **Emit** — Fires `phase:reason:before` / `phase:reason:after` around the LLM call.
   - **Complete** — If the model returns text without tool calls, the turn completes.
4. **Budget Check** — Before each turn, `IterationBudget.checkTurn()` verifies the agent has remaining budget (max turns, consecutive errors, same-tool failures).
5. **End** — The loop exits when `completed=true`, `interrupted=true`, or budget is exhausted. Status returns to `idle`.

### Module Responsibilities

| Module | Purpose |
|--------|---------|
| `types` | Re-exports `ModelMessage` and `LanguageModelUsage` from `ai`. Defines `UserInput`, `AgentOutput`, `ToolCallRecord`, and `AgentStatus` |
| `budget` | `IterationBudget` — enforces guard rails on turns, errors, and tool failures |
| `state` | `AgentState` — holds session identity, conversation history (`ModelMessage[]`), turn counter, and status |
| `events` | `EventBus` — typed, priority-ordered event system for observability and extension |
| `loop` | `AgentLoop` — executes a single ReAct turn via `generateText()` from the Vercel AI SDK |
| `core-agent` | `CoreAgent` — lifecycle orchestrator: init, run, interrupt, reset, event subscription |

---

## Quick Start

```typescript
import { CoreAgent } from 'rem-agent-core';
import { openai } from '@ai-sdk/openai';

const agent = new CoreAgent({
  name: 'MyAgent',
  model: openai('gpt-4o'),
});

await agent.initialize();

agent.on('turn:after', ({ state }) => {
  console.log(`Turn ${state.currentTurn} completed`);
});

const output = await agent.run({ content: 'Hello!' });
console.log(output.content);
```

---

## API Reference

### `types`

Core re-exports from the Vercel AI SDK plus domain-specific types.

**Re-exported from `ai`:**

```typescript
import type { ModelMessage, LanguageModelUsage } from 'ai';
```

- **`ModelMessage`** — Unified message type for LLM prompts (`SystemModelMessage | UserModelMessage | AssistantModelMessage | ToolModelMessage`)
- **`LanguageModelUsage`** — Token usage from a generation call (`inputTokens`, `outputTokens`, `totalTokens`)

**Domain types:**

#### `UserInput` / `AgentOutput`

```typescript
interface UserInput {
  content: string;
  timestamp?: Date;
}

interface AgentOutput {
  content: string;
  toolCalls: ToolCallRecord[];
  completed: boolean;
}
```

#### `ToolCallRecord`

```typescript
interface ToolCallRecord {
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

#### `AgentStatus`

```typescript
type AgentStatus = 'idle' | 'running' | 'error';
```

---

### `budget`

#### `IterationBudget`

Guard-rail class that limits how many turns an agent may take and tracks error conditions.

```typescript
class IterationBudget {
  constructor(config: Partial<BudgetConfig>);

  checkTurn(): boolean;           // increment turn counter, return false if maxTurns exceeded
  hasBudget(): boolean;           // true if any budget remains
  recordError(toolName?: string); // increment consecutive errors and same-tool failure counters
  recordSuccess(toolName?: string); // reset consecutive errors, clear same-tool failure
  getStatus(): BudgetStatus;      // current budget snapshot
}
```

**`BudgetConfig`** defaults:

| Field | Default | Description |
|-------|---------|-------------|
| `maxTurns` | `Infinity` | Maximum total turns |
| `maxConsecutiveErrors` | `3` | Abort after N consecutive errors |
| `maxSameToolFailures` | `5` | Abort after a single tool fails N times |

---

### `state`

#### `AgentState`

Mutable container for the agent's runtime state.

```typescript
class AgentState {
  readonly sessionId: string;       // UUID, auto-generated on construction
  conversation: ModelMessage[] = []; // full message history
  currentTurn = 0;                  // last executed turn number
  budget: IterationBudget;          // shared budget instance
  toolCalls: ToolCallRecord[] = []; // accumulated tool call records
  status: AgentStatus = 'idle';     // current status

  addMessage(msg: ModelMessage): void;
  addToolCall(record: ToolCallRecord): void;
  canContinue(): boolean;           // status === 'running' && budget.hasBudget()
  reset(): void;                    // clear conversation, turns, tools; restore budget
}
```

---

### `events`

#### `EventBus`

Priority-ordered, typed event emitter.

```typescript
class EventBus {
  on(event: AgentEvent, handler: EventHandler, priority = 50): () => void;
  once(event: AgentEvent, handler: EventHandler, priority = 50): void;
  async emit(event: AgentEvent, ctx: EventContext): Promise<void>;
}
```

- `priority` is 0–100; higher numbers execute first.
- `on()` returns an unsubscribe function.
- `once()` auto-unsubscribes after the first emission.
- `emit()` awaits every handler sequentially in priority order.

#### `AgentEvent`

```typescript
type AgentEvent =
  | 'core-agent:init' | 'core-agent:start' | 'core-agent:error'
  | 'turn:before' | 'turn:after'
  | 'phase:prepare' | 'phase:reason:before' | 'phase:reason:after'
  | 'phase:execute:before' | 'phase:execute:after'
  | 'phase:observe' | 'phase:reflect'
  | 'tool:before' | 'tool:after' | 'tool:error'
  | 'compress:before' | 'compress:after';
```

#### `EventContext`

```typescript
interface EventContext {
  agent: unknown;
  state: AgentState;
  turn?: unknown;
  turnResult?: unknown;
  toolCall?: unknown;
}
```

---

### `loop`

#### `AgentLoop`

Executes a single ReAct turn by calling `generateText()` from the Vercel AI SDK.

```typescript
class AgentLoop {
  constructor(model: LanguageModel, events: EventBus);

  async executeTurn(ctx: TurnContext, state: AgentState): Promise<TurnResult>;
}
```

**`TurnContext`** — input to a single turn:

```typescript
interface TurnContext {
  input: { content: string };
  turnNumber: number;
  conversation: ModelMessage[];
  systemPrompt: string;
  availableTools: ToolSet;  // from Vercel AI SDK
}
```

**`TurnResult`** — output of a single turn:

```typescript
interface TurnResult {
  output: AgentOutput;
  toolCalls: ToolCallRecord[];
  completed: boolean;     // true if no more turns needed
  shouldContinue: boolean; // true if the agent should schedule another turn
  usage: LanguageModelUsage;
}
```

**Turn lifecycle:**

1. Emit `turn:before`.
2. Check budget via `state.budget.checkTurn()` — return early if exhausted.
3. Build message list: `[...conversation, user]`.
4. Emit `phase:reason:before`.
5. Call `generateText({ model, system, messages, tools })`.
6. Emit `phase:reason:after`.
7. If no `toolCalls`, add assistant message to state, emit `turn:after`, return `completed=true`.
8. If `toolCalls` present, build `ToolCallRecord`s, emit `turn:after`, return `completed=false` (tool execution is expected to happen outside the loop).

---

### `core-agent`

#### `CoreAgent`

Main entry point. Manages the agent lifecycle.

```typescript
class CoreAgent {
  get status(): AgentStatus;

  constructor(config: CoreAgentConfig);

  async initialize(options?: { sessionId?: string; messages?: ModelMessage[] }): Promise<void>;
  async run(input: UserInput): Promise<AgentOutput>;
  interrupt(): void;               // signal graceful stop at end of current turn
  async reset(): Promise<void>;    // clear state and re-emit core-agent:init
  on(event: AgentEvent, handler: EventHandler): () => void;
  once(event: AgentEvent, handler: EventHandler): void;
}
```

**`CoreAgentConfig`:**

```typescript
interface CoreAgentConfig {
  name: string;               // agent identity, used in system prompt
  model: LanguageModel;       // a Vercel AI SDK LanguageModel, e.g. openai('gpt-4o')
  budget?: IterationBudget;   // optional custom budget; defaults to 60-turn budget
}
```

**`run()` behavior:**

- Sets status to `running`, emits `core-agent:start`.
- Enters a `while` loop calling `AgentLoop.executeTurn()` per iteration.
- Loop exits when:
  - `turnResult.completed === true`
  - `interrupt()` was called
  - `state.canContinue()` is false (budget exhausted)
- On success, status returns to `idle`.
- On error, status becomes `error`, `core-agent:error` is emitted, and the error is re-thrown.

---

## Event Reference

| Event | When | Context fields |
|-------|------|----------------|
| `core-agent:init` | After `initialize()` or `reset()` | `agent`, `state` |
| `core-agent:start` | At the start of `run()` | `agent`, `state` |
| `core-agent:error` | On uncaught error during `run()` | `agent`, `state` |
| `turn:before` | Before each `executeTurn()` | `agent`, `state` |
| `turn:after` | After each `executeTurn()` | `agent`, `state` |
| `phase:reason:before` | Before LLM call | `agent`, `state` |
| `phase:reason:after` | After LLM call | `agent`, `state` |
| `phase:prepare` | (reserved) | `agent`, `state` |
| `phase:execute:before` | (reserved) | `agent`, `state`, `turn` |
| `phase:execute:after` | (reserved) | `agent`, `state`, `turnResult` |
| `phase:observe` | (reserved) | `agent`, `state` |
| `phase:reflect` | (reserved) | `agent`, `state` |
| `tool:before` | (reserved) | `agent`, `state`, `toolCall` |
| `tool:after` | (reserved) | `agent`, `state`, `toolCall` |
| `tool:error` | (reserved) | `agent`, `state`, `toolCall` |
| `compress:before` | (reserved) | `agent`, `state` |
| `compress:after` | (reserved) | `agent`, `state` |

Events marked **(reserved)** are defined in the type system but not yet emitted by the current `AgentLoop` implementation; they are reserved for future ReAct phase expansion.
