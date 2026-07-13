# rem-agent-core

Core layer of the Rem Agent framework. Provides the foundational primitives for running AI agents with a ReAct-style turn loop, state management, event-driven observability, and budget control. Built on a custom provider layer that directly calls the OpenAI and Anthropic SDKs.

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
│  ┌─────────────────┤  ReactLoop   │─────────────────┐              │
│  │                 │  iterate()   │                 │              │
│  │                 └──────┬───────┘                 │              │
│  │                        │                         │              │
│  │           ┌────────────┼────────────┐            │              │
│  │           ▼            ▼            ▼            │              │
│  │   ┌──────────┐  ┌──────────┐  ┌──────────┐      │              │
│  │   │AgentState│  │ EventBus │  │ Inference│      │              │
│  │   └──────────┘  └──────────┘  │  Engine  │      │              │
│  │                               └────┬─────┘      │              │
│  │                                    ▼             │              │
│  │                         ┌──────────────────┐    │              │
│  │                         │ LLMProvider      │    │              │
│  │                         │ (openai/anthropic│    │              │
│  └─────────────────────────┤  direct SDK)     │────┘              │
│                            └──────────────────┘                   │
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
3. **Turn Execution** — `ReactTurnRunner.run()` enters the turn loop, calling `ReactLoop.iterate()` for each ReAct cycle:
   - **Prepare** — Builds message list from conversation history + user input.
   - **Reason** — Calls `InferenceEngine.infer()` with the configured provider (`openai` / `anthropic`).
   - **Emit** — Fires `phase:reason:before` / `phase:reason:after` around the LLM call.
   - **Complete** — If the model returns text without tool calls, the turn completes.
4. **Budget Check** — Before each turn, `IterationBudget.checkTurn()` verifies the agent has remaining budget (max turns, consecutive errors, same-tool failures).
5. **End** — The loop exits when `completed=true`, `interrupted=true`, or budget is exhausted. Status returns to `idle`.

### Module Responsibilities

| Module | Purpose |
|--------|---------|
| `types` | Defines `ModelMessage`, `LanguageModelUsage`, `UserInput`, `AgentOutput`, `ToolCallRecord`, and `AgentStatus` |
| `budget` | `IterationBudget` — enforces guard rails on turns, errors, and tool failures |
| `state` | `AgentState` — holds session identity, conversation history (`ModelMessage[]`), turn counter, and status |
| `events` | `EventBus` — typed, priority-ordered event system for observability and extension |
| `loop` | `ReactLoop` / `ReactTurnRunner` — executes ReAct turns via `InferenceEngine` |
| `llm` | `InferenceEngine`, `LLMProvider` registry, and direct SDK providers for OpenAI and Anthropic |
| `core-agent` | `CoreAgent` — lifecycle orchestrator: init, run, interrupt, reset, event subscription |

---

## Quick Start

```typescript
import { createAgentFromEnv } from 'rem-agent-core';

const agent = createAgentFromEnv({
  name: 'MyAgent',
  provider: 'openai',
  maxTurns: 60,
});

await agent.initialize();

agent.on('turn:after', ({ state }) => {
  console.log(`Turn ${state.currentTurn} completed`);
});

const { output } = agent.run({ content: 'Hello!' });
console.log((await output).content);
```

Provider and model are resolved from environment variables (`OPENAI_API_KEY`, `OPENAI_MODEL`, etc.) by `createAgentFromEnv`. You can also construct `CoreAgent` directly with an explicit `provider` and `providerConfig`.

---

## API Reference

### `types`

Core domain types.

**Message and usage types:**

```typescript
interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: unknown;
}

interface LanguageModelUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputTokenDetails?: {
    noCacheTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  outputTokenDetails?: {
    textTokens?: number;
    reasoningTokens?: number;
  };
}
```

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

### `llm`

#### `InferenceEngine`

Coordinates LLM calls through the provider registry.

```typescript
class InferenceEngine {
  async infer(options: InferenceOptions): Promise<InferenceResult>;
}
```

**`InferenceOptions`** — input to a single inference:

```typescript
interface InferenceOptions {
  provider: string;           // e.g. 'openai' or 'anthropic'
  providerConfig: {
    apiKey: string;
    baseURL?: string;
    model: string;
  };
  system?: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onChunk?: (chunk: StreamChunk) => void | Promise<void>;
}
```

**`StreamChunk`** — incremental output from the provider:

```typescript
type StreamChunk =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'usage'; inputTokens: number; outputTokens: number; totalTokens: number }
  | { type: 'finish'; reason: string };
```

#### `LLMProvider` registry

Providers are registered by id and resolved at runtime.

```typescript
registerProvider('openai', openaiProvider);
const provider = resolveProvider('openai');
```

Built-in providers live in `packages/core/src/llm/providers/`:

- `openai.ts` — directly uses the `openai` SDK
- `anthropic.ts` — directly uses the `@anthropic-ai/sdk`

---

### `loop`

#### `ReactLoop` / `ReactTurnRunner`

Executes a single ReAct turn by calling `InferenceEngine.infer()` with the configured provider.

---

### `core-agent`

#### `CoreAgent`

Main entry point. Manages the agent lifecycle.

```typescript
class CoreAgent {
  get status(): AgentStatus;

  constructor(config: CoreAgentConfig);

  async initialize(options?: { sessionId?: string }): Promise<void>;
  run(input: UserInput): AgentStreamResult;
  interrupt(): void;               // signal graceful stop at end of current turn
  async reset(): Promise<void>;    // clear state and re-emit core-agent:init
  async generateTitle(): Promise<string>;
  async listSessions(): Promise<SessionSummary[]>;
  on(event: AgentEvent, handler: EventHandler): () => void;
  once(event: AgentEvent, handler: EventHandler): void;
}
```

**`CoreAgentConfig`:**

```typescript
interface CoreAgentConfig {
  name: string;               // agent identity, used in system prompt
  provider?: string;          // provider id, e.g. 'openai' or 'anthropic'
  providerConfig?: {          // explicit provider config; otherwise resolved from env
    apiKey: string;
    baseURL?: string;
    model: string;
  };
  budget?: IterationBudget;   // optional custom budget; defaults to 60-turn budget
}
```

**`run()` behavior:**

- Sets status to `running`, emits `core-agent:start`.
- Enters a `while` loop calling `ReactTurnRunner.run()` per iteration.
- Loop exits when:
  - the turn result indicates completion
  - `interrupt()` was called
  - budget is exhausted
- On success, status returns to `idle`.
- On error, status becomes `error`, `core-agent:error` is emitted, and the error is re-thrown.

---

## Event Reference

| Event | When | Context fields |
|-------|------|----------------|
| `core-agent:init` | After `initialize()` or `reset()` | `agent`, `state` |
| `core-agent:start` | At the start of `run()` | `agent`, `state` |
| `core-agent:error` | On uncaught error during `run()` | `agent`, `state` |
| `turn:before` | Before each `ReactLoop.iterate()` | `agent`, `state` |
| `turn:after` | After each `ReactLoop.iterate()` | `agent`, `state` |
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

## MCP Client

Configure external MCP servers in `rem-agent.config.json`:

```json
{
  "mcpServers": {
    "fs": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
    }
  }
}
```

MCP tools are prefixed with the server key, e.g. `fs__read_file`, and require approval by default.

---

## Custom Agents

You can define multiple agents in `rem-agent.config.json`:

```json
{
  "agents": {
    "coder": {
      "name": "Code Assistant",
      "corePrompt": "You focus on writing clean, concise code and follow existing conventions.",
      "model": { "provider": "openai", "model": "gpt-4o" }
    }
  }
}
```

Switch at runtime:

```typescript
runAgent({ ..., agent: 'coder' });
```

If the agent is not found or no `agent` is provided, the built-in default agent is used.
