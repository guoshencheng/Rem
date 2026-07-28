# rem-agent-core

Core layer of the Rem Agent framework. Provides the foundational primitives for running AI agents with a ReAct-style turn loop, state management, event-driven observability, and budget control. LLM calls are delegated to the `@earendil-works/pi-ai` `Models` collection, which provides a unified provider abstraction over OpenAI, Anthropic, and other providers.

---

## Architecture Overview

The Core is organized around a stateless execution entry point (`runAgent`) operating over an assembled `AgentDI` + `AgentRuntimeConfig`.

```
┌─────────────────────────────────────────────────────────────────────┐
│  createAgentFromEnv()          assembleAgentContext()               │
│  (agent-factory.ts)            (agent-context-assembler.ts)         │
│        │                                │                           │
│        └──────────────┬─────────────────┘                           │
│                       ▼                                             │
│       AgentDI (models, providers, storage) + AgentRuntimeConfig     │
│                       │                                             │
│                       ▼                                             │
│  ┌──────────────── runAgent() (single execution entry) ──────────┐  │
│  │                         ReactLoop                              │  │
│  │   prepare → reason → execute → observe → reflect               │  │
│  │                                                                │  │
│  │   reason:   reason/reason.ts    → models.stream()              │  │
│  │             reason/generate.ts  → models.complete()            │  │
│  │   execute:  execute/execute-tools.ts + approval-engine.ts      │  │
│  │                                                                │  │
│  │   events:   AgentStreamEvent = pi.AssistantMessageEvent        │  │
│  │             | RemMetaEvent                                     │  │
│  └──────────────────────────┬────────────────────────────────────┘  │
│                             │                                       │
│         ┌───────────────────┼───────────────────┐                   │
│         ▼                   ▼                   ▼                   │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────────┐            │
│  │ pi-ai Models│    │ AgentState   │    │ EventBus     │            │
│  │ (llm/models)│    │ + Broadcast- │    │ (lifecycle / │            │
│  │             │    │   Bus        │    │  phase events)│           │
│  └─────────────┘    └──────────────┘    └──────────────┘            │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              IterationBudget (guard rails)                  │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

Types are reused directly from pi-ai: messages are `pi.Message`, tool sets are `pi.Tool[]` — there is no REM-specific message representation or adapter layer. Old schema v1 sessions are unsupported and rejected with `UnsupportedSessionSchemaError`.

### Data Flow

A single `runAgent()` invocation flows through these phases:

1. **Assemble** — `createAgentFromEnv()` (or `assembleAgentContext()` with injected providers) builds the `AgentAssembly` (`{ di, runtimeConfig }`). Provider credentials, default model, and baseURL are resolved inside Core.
2. **Load** — `runAgent()` loads or creates the `Session` via `SessionProvider` (schema v2).
3. **Turn Execution** — the `ReactLoop` iterates ReAct cycles:
    - **Prepare** — Builds message list from conversation history + user input.
    - **Reason** — `reason()` calls `models.stream()` (streaming) with the configured model.
    - **Execute** — Tool calls run through the approval pipeline and `execute-tools`.
    - **Complete** — If the model returns text without tool calls, the turn completes.
4. **Budget Check** — Before each turn, `IterationBudget.checkTurn()` verifies remaining budget (max turns, consecutive errors, same-tool failures).
5. **Emit** — `AgentEventStreamController` enqueues `AgentStreamEvent`s; `AgentState` publishes UI-level `BusEvent`s (chunks, session lifecycle, todos, usage) on the `BroadcastBus`.
6. **End** — The loop exits when `completed=true`, aborted via `signal`, or budget is exhausted.

### Module Responsibilities

| Module | Purpose |
|--------|---------|
| `types` | Defines `RemMessage`, `Usage`, `UserInput`, `AgentOutput`, `AgentStreamEvent`, `ToolCallRecord`, and `AgentStatus` |
| `budget` | `IterationBudget` — enforces guard rails on turns, errors, and tool failures |
| `state` / `agent-state` | `AgentLiveState` (per-session runtime state) and `AgentState` (session-keyed registry + `BroadcastBus` publisher) |
| `events` | `EventBus` — typed, priority-ordered event system for observability and extension |
| `bus-events` / `broadcast-bus` | UI-level `BusEvent` types and pub/sub bus |
| `loop-strategy` | `ReactLoop` / `LoopStrategy` exports (implementation in `plugins/loop/react`) |
| `reason` / `execute` | `reason()` (streaming), `generate()` (non-streaming), `executeTools()`, `ApprovalEngine` |
| `llm` | `createCoreModels` (pi-ai Models 初始化), `context-window`, `reasoning-options` |
| `agent-factory` | `createAgentFromEnv()` — resolves provider config from env and builds the `AgentAssembly` |
| `agent-context-assembler` | `assembleAgentContext()` — pure assembly function, all providers injectable |
| `run-agent` | `runAgent()` — stateless, single execution entry point |

---

## Quick Start

```typescript
import { createAgentFromEnv, runAgent, AgentState } from 'rem-agent-core';

const ctx = await createAgentFromEnv({ name: 'MyAgent', maxTurns: 60 });
const agentState = new AgentState();

const { stream, output } = runAgent({
  ctx,
  agentState,
  sessionId: 'my-session',
  input: { content: 'Hello!' },
});

for await (const event of stream.fullStream) {
  // AgentStreamEvent = pi.AssistantMessageEvent | RemMetaEvent
}

console.log((await output).content);
```

Provider and model are resolved from environment variables (`OPENAI_API_KEY`, `OPENAI_MODEL`, etc.) by `createAgentFromEnv`. Clients must not read provider credentials directly — configuration is owned by Core.

For browser/edge environments, use the platform-agnostic entry `rem-agent-core/browser` together with `assembleAgentContext()` and injected providers.

---

## API Reference

### `types`

Core domain types.

**Message and usage types:**

Core 内部直接使用 `@earendil-works/pi-ai` 的 `Message` 类型：

```typescript
import type { Message, Usage } from '@earendil-works/pi-ai';

// Message = UserMessage | AssistantMessage | ToolResultMessage
interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}
```

**`RemMessage` and `messageMeta`:**

`SessionProvider.addMessage()` returns a `RemMessage`, which pairs a Core-generated `messageId` with the underlying `pi.Message`. These message IDs are stored in `Session.metadata.messageMeta` so that UI layers can attach per-message metadata (e.g. token usage) without mutating the `pi.Message` itself.

```typescript
interface RemMessage {
  messageId: string;
  message: Message;   // pi.Message
  tokenUsage?: Usage;
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

#### `AgentLiveState` / `AgentState`

`AgentLiveState` holds per-session runtime state (status, activity, streaming snapshot, accumulated token usage). `AgentState` is a session-keyed registry of live states plus a `BroadcastBus` publisher for UI-level `BusEvent`s (`chunk`, `session-start`, `session-end`, `todo-updated`, `usage-change`, `activity-change`, `child-agent-update`, ...).

```typescript
class AgentState {
  get(sessionId: string): AgentLiveState | undefined;
  getOrCreate(sessionId: string): AgentLiveState;
  runningSessionIds(): string[];
  subscribe(fn: (event: BusEvent) => void): () => void;
  publish(event: BusEvent): void;
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
  | 'agent:state-change'
  | 'turn:before' | 'turn:after'
  | 'phase:prepare'
  | 'phase:reason:before' | 'phase:reason:after' | 'phase:reason:error'
  | 'phase:execute:before' | 'phase:execute:after'
  | 'phase:observe' | 'phase:reflect'
  | 'tool:before' | 'tool:after' | 'tool:error' | 'tool:blocked'
  | 'tool:approval:requested' | 'tool:approval:resolved' | 'tool:approval:expired'
  | 'compress:before' | 'compress:after';
```

#### `EventContext`

```typescript
interface EventContext {
  agent: unknown;
  liveState: AgentLiveState;
  prevStatus?: string;
  currentStatus?: string;
  turn?: unknown;
  turnResult?: unknown;
  toolCall?: unknown;
  error?: unknown;
}
```

---

### `llm`

#### `createCoreModels`

Creates a `pi-ai` `Models` collection.

```typescript
import { createCoreModels } from 'rem-agent-core';

// Empty collection (useful for tests)
const models = createCoreModels();

// With all built-in pi-ai providers registered
const models = createCoreModels({ all: true });
```

#### `context-window`

`resolveContextWindow(provider, model, env?, models?)` resolves the context-window size from pi-ai model metadata (`models.getModel(provider, model).contextWindow`), respecting `MAX_CONTEXT_TOKENS` and per-model environment overrides, with a 1M fallback for unknown models.

---

### `loop`

#### `ReactLoop` / `LoopStrategy`

Executes a single ReAct turn by calling `pi-ai` `Models.stream()` / `Models.complete()` through the configured `AgentDI.models`. The `LoopStrategy` interface allows alternative loop implementations (e.g. Plan-and-Solve) in the future.

---

### `agent-factory` / `run-agent`

#### `createAgentFromEnv`

```typescript
async function createAgentFromEnv(options?: CreateAgentOptions): Promise<AgentAssembly>;
```

Resolves provider credentials, default model, and baseURL from environment variables and assembles a full `AgentAssembly` (`AgentDI`: models, session storage, tools, security, budget, ...; `AgentRuntimeConfig`: securityMode, runtime). This is the only supported way for clients to obtain an agent configuration — clients must not import provider SDKs or read `OPENAI_API_KEY` etc. directly.

#### `runAgent`

```typescript
interface RunAgentParams {
  input: UserInput;
  sessionId: string;
  signal?: AbortSignal;
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
  agentState: AgentState;
  workspace?: string;
  workspaceRoot?: string;
  agent?: string;          // custom agent role name (see Custom Agents)
}

interface RunAgentResult {
  stream: AgentStream;
  output: Promise<AgentOutput>;
}

function runAgent(params: RunAgentParams): RunAgentResult;
```

Stateless execution entry point. Loads/creates the session, runs the `ReactLoop` until completion, abort, or budget exhaustion, and returns a stream of `AgentStreamEvent` plus an output promise. Concurrent title generation is handled internally.

---

## Event Reference

| Event | When |
|-------|------|
| `agent:state-change` | Live state status/activity transitions |
| `turn:before` / `turn:after` | Around each ReAct turn |
| `phase:reason:before` / `phase:reason:after` / `phase:reason:error` | Around the LLM call |
| `phase:prepare` / `phase:observe` / `phase:reflect` | ReAct phase boundaries |
| `phase:execute:before` / `phase:execute:after` | Around tool execution |
| `tool:before` / `tool:after` / `tool:error` / `tool:blocked` | Individual tool call lifecycle |
| `tool:approval:requested` / `tool:approval:resolved` / `tool:approval:expired` | Approval pipeline |
| `compress:before` / `compress:after` | Context compression |

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
