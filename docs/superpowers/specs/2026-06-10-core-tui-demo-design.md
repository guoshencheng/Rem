# Core TUI Demo Design

## Overview

A terminal-based interactive demo for `@agent-harness/core` that lets users experience Core's runtime behavior in real-time. The demo uses `@earendil-works/pi-tui` for a split-pane terminal UI similar to OpenClaw.

**Goals:**
- Let users interact with a CoreAgent through a chat-like TUI
- Visualize Core's event-driven architecture via a real-time event log
- Demonstrate ReAct loop execution, budget tracking, and state management

**Non-Goals:**
- No tool calling in Phase 1 (pure conversation only)
- No persistent storage (session ends on exit)
- No complex configuration (API key via env var only)
- No multi-session or slash commands

## Architecture

```
packages/demo/src/
├── main.ts              # Entry: parse config, init LLM, start TUI
├── agent.ts             # Create and configure CoreAgent
├── config.ts            # Config resolution (CLI args + env vars)
├── model/
│   └── provider.ts      # LLM provider factory
└── tui/
    ├── app.ts           # TUI root component (layout + state)
    ├── chat-log.ts      # Message list (scrollback container)
    ├── message.ts       # User/assistant message components
    ├── input-box.ts     # Bottom input field
    ├── status-bar.ts    # Top bar (turns/budget/status)
    └── event-log.ts     # Collapsible event stream panel
```

### Component Responsibilities

- **`main.ts`**: Reads env vars (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`), creates `LanguageModel`, launches TUI
- **`agent.ts`**: Wraps CoreAgent creation. Subscribes to Core events and forwards them to the TUI. No tools registered in Phase 1.
- **`tui/app.ts`**: pi-tui root container. Maintains `messages`, `events`, `status` state. Re-renders on Core event updates.
- **`model/provider.ts`**: Factory for Vercel AI SDK `LanguageModel` instances (OpenAI or Anthropic)

### Integration Boundary with Core

- Demo depends only on `@agent-harness/core` public API
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

**Supported Providers:**
- OpenAI via `createOpenAI` (default)
- Anthropic via `createAnthropic` (optional, `--provider anthropic`)

**Configuration Priority:**
1. CLI args: `--provider openai --model gpt-4.1`
2. Environment variables: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
3. Exit with helpful message if no API key is configured

**Defaults:**
- Model: `gpt-4.1` (OpenAI) or `claude-sonnet-4-6` (Anthropic)
- Budget: `maxTurns: 60`

## Phase 1 Scope (Current)

- Pure conversation, no tools
- CoreAgent configured with `name`, `model`, `budget` only
- Event subscriptions: `core-agent:start`, `turn:before`, `phase:reason:before/after`, `turn:after`, `core-agent:error`
- TUI shows: chat history + input + status bar + event log

## Phase 2 Extension Points

- `tools/` directory with demo tools (calculator, weather)
- `tool-card.ts` component for visualizing tool calls
- `availableTools` registration in `agent.ts`

## Dependencies

```json
{
  "dependencies": {
    "@agent-harness/core": "workspace:*",
    "@earendil-works/pi-tui": "^0.79.1",
    "ai": "^6.0.0"
  }
}
```
