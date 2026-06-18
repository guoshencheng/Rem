# Core TUI Demo Design

## Overview

A terminal-based interactive demo for `rem-agent-core` that lets users experience Core's runtime behavior in real-time. The demo uses `@earendil-works/pi-tui` for a split-pane terminal UI similar to OpenClaw.

**Goals:**
- Let users interact with a CoreAgent through a chat-like TUI
- Visualize Core's event-driven architecture via a real-time event log
- Demonstrate ReAct loop execution, budget tracking, and state management

**Non-Goals:**
- No tool calling in Phase 1 (pure conversation only)
- No persistent storage (session ends on exit)
- No complex configuration (API key via env var only)
- No multi-session or slash commands

## Adjustments from Original Spec (2026-06-15)

After validating against the current Core implementation, the following adjustments apply:

1. **OpenAI-only in Phase 1.** Anthropic support is deferred to reduce provider-factory and configuration surface area. The TUI itself is provider-agnostic.
2. **`main.ts` variable ordering.** The agent must be created before the `App` so the `onSubmit` callback can reference it without a temporal dead zone error.
3. **`agent.ts` state access.** `AgentState` exposes `currentTurn` directly; remove the `(ctx.state as { currentTurn: number }).currentTurn` type assertion and use `ctx.state.currentTurn`.
4. **pi-tui version.** Use `^0.79.1` (verified compatible) or `^0.79.3` (latest patch). The component APIs used by the demo (`Container`, `Text`, `Markdown`, `Input`, `Spacer`, `TUI`, `ProcessTerminal`) are unchanged between these versions.
5. **Event set confirmation.** The Core events subscribed by the demo are available in the current Core build: `core-agent:start`, `core-agent:error`, `turn:before`, `turn:after`, `phase:reason:before`, `phase:reason:after`.

## Architecture

```
packages/demo/src/
├── main.ts              # Entry: parse config, init LLM, start TUI
├── agent.ts             # Create and configure CoreAgent
├── config.ts            # Config resolution (env vars)
├── model/
│   └── provider.ts      # OpenAI LanguageModel factory
└── tui/
    ├── app.ts           # TUI root component (layout + state)
    ├── chat-log.ts      # Message list (scrollback container)
    ├── message.ts       # User/assistant message components
    ├── input-box.ts     # Bottom input field
    ├── status-bar.ts    # Top bar (turns/budget/status)
    └── event-log.ts     # Collapsible event stream panel
```

### Component Responsibilities

- **`main.ts`**: Reads env vars (`OPENAI_API_KEY`), creates `LanguageModel`, creates `CoreAgent`, creates `App`, wires callbacks, starts TUI
- **`agent.ts`**: Wraps CoreAgent creation. Subscribes to Core events and forwards them to the TUI. No tools registered in Phase 1.
- **`tui/app.ts`**: pi-tui root container. Maintains `messages`, `events`, `status` state. Re-renders on Core event updates.
- **`model/provider.ts`**: Factory for Vercel AI SDK `LanguageModel` instances (OpenAI only in Phase 1)

### Integration Boundary with Core

- Demo depends only on `rem-agent-core` public API
- Events flow via `agent.on('...', handler)` subscriptions
- Core identifies tool calls but does not execute them (external execution pattern)

## UI Layout

```
┌────────────────────────────────────────────────────────┐
│ Core Demo          turn: 1/60    status: idle          │ ← status-bar
├────────────────────────────────────────────────────────┤
│                                                        │
│ ┌────────────────────────────────────────────────────┐ │
│ │ Hello, please introduce yourself.                  │ │ ← user msg (bg)
│ └────────────────────────────────────────────────────┘ │
│                                                        │
│ Hello! I am a Core Agent demo instance...             │ ← assistant msg
│                                                        │
│ ┌────────────────────────────────────────────────────┐ │
│ │ What can you do?                                   │ │ ← user msg (bg)
│ └────────────────────────────────────────────────────┘ │
│                                                        │
│ I can answer questions, analyze content...            │ ← assistant msg
│                                                        │
│ ── Events ──────────────────────────────────────────   │
│ [10:42:01] turn:before           turn #1              │ ← event-log
│ [10:42:01] phase:reason:before                        │
│ [10:42:03] phase:reason:after    took 1.8s            │
│ [10:42:03] turn:after            done                 │
│                                                        │
├────────────────────────────────────────────────────────┤
│ > hello_                                               │ ← input-box
└────────────────────────────────────────────────────────┘
```

### Layout Details

**Status Bar (top):** Demo name, current turn / max turns, Agent status (`idle` | `running` | `error`)

**Chat Area (upper-middle):** Flat message stream. No sender labels.
- User messages: background color (e.g. subtle blue/gray) via `theme.userBg`
- Assistant messages: default terminal foreground, no background
- Assistant messages support Markdown rendering
- Spacer between messages for visual separation

**Event Log (lower-middle):** Collapsible panel. Default expanded.
- Shows recent Core events with timestamp, name, and brief info
- Max 50 entries, auto-prunes old entries
- Toggle with `e` key

**Input Box (bottom):** Fixed height.
- Prompt `>` with blinking cursor
- Enter to submit
- `Ctrl+C` to interrupt current turn and exit

### Message Rendering (following OpenClaw pattern)

User and assistant messages are distinct components:

- **User message**: `Container` with `Markdown` body, `bgColor` set via theme
- **Assistant message**: `Container` with `Spacer(1)` + `Markdown` body, no background

Both are appended to a scrollback `ChatLog` container. No sender labels.

## Event Stream Design

Events subscribed from Core and their log representation:

| Event | Log Display |
|-------|-------------|
| `core-agent:start` | `▶ Agent started` |
| `turn:before` | `turn #N started` |
| `phase:reason:before` | `🧠 reasoning...` |
| `phase:reason:after` | `✓ reasoning done (Xs)` |
| `turn:after` | `turn #N done` |
| `core-agent:error` | `✗ error: [message]` |

Design decisions:
- Only core lifecycle events to avoid log noise
- Auto-prune to 50 entries max
- Default expanded; toggle with `e`

## LLM Integration

**Supported Providers (Phase 1):**
- OpenAI via `@ai-sdk/openai` `createOpenAI`

**Configuration Priority:**
1. Environment variables: `OPENAI_API_KEY`
2. Optional environment variables: `DEMO_MODEL`, `DEMO_AGENT_NAME`, `DEMO_MAX_TURNS`
3. Exit with helpful message if no API key is configured

**Defaults:**
- Model: `gpt-4.1`
- Agent name: `Core Demo Agent`
- Budget: `maxTurns: 60`

**Future Extension:**
- Anthropic via `@ai-sdk/anthropic` can be added to `model/provider.ts` without changing the TUI

## Phase 1 Scope (Current)

- Pure conversation, no tools
- CoreAgent configured with `name`, `model`, `budget` only
- Event subscriptions: `core-agent:start`, `turn:before`, `phase:reason:before/after`, `turn:after`, `core-agent:error`
- TUI shows: chat history + input + status bar + event log

## Phase 2 Extension Points

- `tools/` directory with demo tools (calculator, weather)
- `tool-card.ts` component for visualizing tool calls
- `availableTools` registration in `agent.ts`
- Anthropic provider support

## Dependencies

```json
{
  "dependencies": {
    "rem-agent-core": "workspace:*",
    "@ai-sdk/openai": "^1.3.0",
    "@earendil-works/pi-tui": "^0.79.3",
    "ai": "6.0.199"
  }
}
```
