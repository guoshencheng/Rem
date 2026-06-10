# Core TUI Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create an interactive terminal demo for `@agent-harness/core` using `@earendil-works/pi-tui` that lets users chat with a CoreAgent while visualizing events and budget status.

**Architecture:** A new `packages/demo/` package with TUI components (chat-log, event-log, status-bar, input), a model provider factory, config resolver, and a main entry that wires CoreAgent events to the TUI. Layout is vertical-stack: chat messages, event log, status bar, input box — with TUI auto-scrolling to keep the bottom visible.

**Tech Stack:** TypeScript, `@earendil-works/pi-tui`, `@agent-harness/core`, `@ai-sdk/openai`, `ai`

---

## File Structure

```
packages/demo/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── main.ts              # Entry: init model + agent + TUI, run event loop
    ├── config.ts            # CLI args + env var resolution
    ├── colors.ts            # ANSI color helper functions
    ├── theme.ts             # MarkdownTheme + DefaultTextStyle for pi-tui
    ├── agent.ts             # CoreAgent factory with event→TUI bridge
    ├── model/
    │   └── provider.ts      # OpenAI/Anthropic LanguageModel factory
    └── tui/
        ├── app.ts           # Root TUI component: layout + state + event wiring
        ├── chat-log.ts      # Scrollback container for messages
        ├── message.ts       # UserMessage + AssistantMessage components
        ├── event-log.ts     # Collapsible event stream panel
        └── status-bar.ts    # Top bar showing turns/budget/status
```

---

### Task 1: Create Demo Package Skeleton

**Files:**
- Create: `packages/demo/package.json`
- Create: `packages/demo/tsconfig.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@agent-harness/demo",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "start": "node dist/main.js"
  },
  "dependencies": {
    "@agent-harness/core": "workspace:*",
    "@ai-sdk/openai": "^1.3.0",
    "@earendil-works/pi-tui": "^0.79.1",
    "ai": "6.0.199"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0"
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
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "references": [{ "path": "../core" }]
}
```

- [ ] **Step 3: Install dependencies**

Run: `cd packages/demo && pnpm install`

Expected: Dependencies installed successfully.

- [ ] **Step 4: Commit**

```bash
git add packages/demo/package.json packages/demo/tsconfig.json
git commit -m "chore(demo): bootstrap demo package"
```

---

### Task 2: ANSI Color Helpers

**Files:**
- Create: `packages/demo/src/colors.ts`

- [ ] **Step 1: Write colors.ts**

```typescript
const RESET = "\x1b[0m";

export function bold(text: string): string {
  return `\x1b[1m${text}${RESET}`;
}

export function dim(text: string): string {
  return `\x1b[2m${text}${RESET}`;
}

export function italic(text: string): string {
  return `\x1b[3m${text}${RESET}`;
}

export function underline(text: string): string {
  return `\x1b[4m${text}${RESET}`;
}

export function strikethrough(text: string): string {
  return `\x1b[9m${text}${RESET}`;
}

export function black(text: string): string {
  return `\x1b[30m${text}${RESET}`;
}

export function red(text: string): string {
  return `\x1b[31m${text}${RESET}`;
}

export function green(text: string): string {
  return `\x1b[32m${text}${RESET}`;
}

export function yellow(text: string): string {
  return `\x1b[33m${text}${RESET}`;
}

export function blue(text: string): string {
  return `\x1b[34m${text}${RESET}`;
}

export function magenta(text: string): string {
  return `\x1b[35m${text}${RESET}`;
}

export function cyan(text: string): string {
  return `\x1b[36m${text}${RESET}`;
}

export function white(text: string): string {
  return `\x1b[37m${text}${RESET}`;
}

export function bgBlue(text: string): string {
  return `\x1b[44m${text}${RESET}`;
}

export function bgGray(text: string): string {
  return `\x1b[48;5;240m${text}${RESET}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/colors.ts
git commit -m "feat(demo): add ANSI color helpers"
```

---

### Task 3: Markdown Theme

**Files:**
- Create: `packages/demo/src/theme.ts`

- [ ] **Step 1: Write theme.ts**

```typescript
import type { MarkdownTheme, DefaultTextStyle } from "@earendil-works/pi-tui";
import { bold, dim, blue, yellow, cyan, italic, green } from "./colors.js";

export const markdownTheme: MarkdownTheme = {
  heading: bold,
  link: blue,
  linkUrl: dim,
  code: yellow,
  codeBlock: yellow,
  codeBlockBorder: dim,
  quote: italic,
  quoteBorder: dim,
  hr: dim,
  listBullet: cyan,
  bold: bold,
  italic: italic,
  strikethrough: (t) => t,
  underline: (t) => t,
};

export const userMessageStyle: DefaultTextStyle = {
  bgColor: (text) => `\x1b[48;5;236m${text}\x1b[0m`,
};

export const assistantMessageStyle: DefaultTextStyle = {
  color: (text) => text,
};

export const eventLogStyle: DefaultTextStyle = {
  color: dim,
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/theme.ts
git commit -m "feat(demo): add markdown theme and message styles"
```

---

### Task 4: Model Provider Factory

**Files:**
- Create: `packages/demo/src/model/provider.ts`

- [ ] **Step 1: Write provider.ts**

```typescript
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export interface ProviderConfig {
  provider: "openai";
  apiKey: string;
  model: string;
}

export function createLanguageModel(config: ProviderConfig): LanguageModel {
  if (config.provider === "openai") {
    const openai = createOpenAI({ apiKey: config.apiKey });
    return openai(config.model);
  }
  throw new Error(`Unsupported provider: ${config.provider}`);
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/model/provider.ts
git commit -m "feat(demo): add OpenAI model provider factory"
```

---

### Task 5: Configuration Resolver

**Files:**
- Create: `packages/demo/src/config.ts`

- [ ] **Step 1: Write config.ts**

```typescript
import { createLanguageModel, type ProviderConfig } from "./model/provider.js";
import type { LanguageModel } from "ai";

export interface DemoConfig {
  model: LanguageModel;
  agentName: string;
  maxTurns: number;
}

function getEnv(key: string): string | undefined {
  return process.env[key];
}

export function resolveConfig(): DemoConfig {
  const apiKey = getEnv("OPENAI_API_KEY");
  if (!apiKey) {
    console.error("Error: OPENAI_API_KEY environment variable is required.");
    console.error("Set it with: export OPENAI_API_KEY=sk-...");
    process.exit(1);
  }

  const modelName = getEnv("DEMO_MODEL") ?? "gpt-4.1";
  const agentName = getEnv("DEMO_AGENT_NAME") ?? "Core Demo Agent";
  const maxTurns = parseInt(getEnv("DEMO_MAX_TURNS") ?? "60", 10);

  const providerConfig: ProviderConfig = {
    provider: "openai",
    apiKey,
    model: modelName,
  };

  return {
    model: createLanguageModel(providerConfig),
    agentName,
    maxTurns,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/config.ts
git commit -m "feat(demo): add configuration resolver"
```

---

### Task 6: CoreAgent Factory with Event Bridge

**Files:**
- Create: `packages/demo/src/agent.ts`

- [ ] **Step 1: Write agent.ts**

```typescript
import { CoreAgent, IterationBudget } from "@agent-harness/core";
import type { AgentEvent, EventContext } from "@agent-harness/core";
import type { LanguageModel } from "ai";

export interface AgentCallbacks {
  onStart?: () => void;
  onTurnBefore?: (turnNumber: number) => void;
  onReasonBefore?: () => void;
  onReasonAfter?: (durationMs: number) => void;
  onTurnAfter?: (turnNumber: number) => void;
  onError?: (error: Error) => void;
  onStatusChange?: (status: string) => void;
}

export function createDemoAgent(
  model: LanguageModel,
  name: string,
  maxTurns: number,
  callbacks: AgentCallbacks,
): CoreAgent {
  const agent = new CoreAgent({
    name,
    model,
    budget: new IterationBudget({ maxTurns }),
  });

  const reasonStartTimes = new Map<number, number>();

  agent.on("core-agent:start", () => {
    callbacks.onStart?.();
    callbacks.onStatusChange?.("running");
  });

  agent.on("turn:before", (ctx: EventContext) => {
    const turnNumber = (ctx.state as { currentTurn: number }).currentTurn;
    callbacks.onTurnBefore?.(turnNumber);
  });

  agent.on("phase:reason:before", (ctx: EventContext) => {
    const turnNumber = (ctx.state as { currentTurn: number }).currentTurn;
    reasonStartTimes.set(turnNumber, Date.now());
    callbacks.onReasonBefore?.();
  });

  agent.on("phase:reason:after", (ctx: EventContext) => {
    const turnNumber = (ctx.state as { currentTurn: number }).currentTurn;
    const start = reasonStartTimes.get(turnNumber);
    const duration = start ? Date.now() - start : 0;
    callbacks.onReasonAfter?.(duration);
    reasonStartTimes.delete(turnNumber);
  });

  agent.on("turn:after", (ctx: EventContext) => {
    const turnNumber = (ctx.state as { currentTurn: number }).currentTurn;
    callbacks.onTurnAfter?.(turnNumber);
  });

  agent.on("core-agent:error", (ctx: EventContext) => {
    callbacks.onError?.(new Error("Agent error"));
    callbacks.onStatusChange?.("error");
  });

  return agent;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/agent.ts
git commit -m "feat(demo): add CoreAgent factory with event callbacks"
```

---

### Task 7: TUI Message Components

**Files:**
- Create: `packages/demo/src/tui/message.ts`

- [ ] **Step 1: Write message.ts**

```typescript
import { Container, Markdown, Spacer } from "@earendil-works/pi-tui";
import { markdownTheme, userMessageStyle, assistantMessageStyle } from "../theme.js";

export class UserMessage extends Container {
  private body: Markdown;

  constructor(text: string) {
    super();
    this.body = new Markdown(text, 1, 0, markdownTheme, userMessageStyle);
    this.addChild(new Spacer(1));
    this.addChild(this.body);
  }

  setText(text: string): void {
    this.body.setText(text);
  }
}

export class AssistantMessage extends Container {
  private body: Markdown;

  constructor(text: string) {
    super();
    this.body = new Markdown(text, 0, 0, markdownTheme, assistantMessageStyle);
    this.addChild(new Spacer(1));
    this.addChild(this.body);
  }

  setText(text: string): void {
    this.body.setText(text);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/tui/message.ts
git commit -m "feat(demo): add user and assistant message components"
```

---

### Task 8: TUI Chat Log

**Files:**
- Create: `packages/demo/src/tui/chat-log.ts`

- [ ] **Step 1: Write chat-log.ts**

```typescript
import { Container } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { UserMessage, AssistantMessage } from "./message.js";

export class ChatLog extends Container {
  private maxMessages: number;

  constructor(maxMessages = 100) {
    super();
    this.maxMessages = maxMessages;
  }

  addUser(text: string): void {
    this.append(new UserMessage(text));
  }

  addAssistant(text: string): void {
    this.append(new AssistantMessage(text));
  }

  private append(component: Component): void {
    this.addChild(component);
    this.prune();
  }

  private prune(): void {
    while (this.children.length > this.maxMessages) {
      this.removeChild(this.children[0]);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/tui/chat-log.ts
git commit -m "feat(demo): add chat log component"
```

---

### Task 9: TUI Event Log

**Files:**
- Create: `packages/demo/src/tui/event-log.ts`

- [ ] **Step 1: Write event-log.ts**

```typescript
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { dim } from "../colors.js";

interface EventEntry {
  time: string;
  name: string;
  detail: string;
}

export class EventLog extends Container {
  private entries: EventEntry[] = [];
  private maxEntries: number;
  private header: Text;
  private content: Container;

  constructor(maxEntries = 50) {
    super();
    this.maxEntries = maxEntries;
    this.header = new Text("", 1, 0);
    this.content = new Container();
    this.addChild(new Spacer(1));
    this.addChild(this.header);
    this.addChild(this.content);
    this.updateHeader();
  }

  addEvent(name: string, detail = ""): void {
    const time = new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    this.entries.push({ time, name, detail });
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    this.refresh();
  }

  clear(): void {
    this.entries = [];
    this.refresh();
  }

  private updateHeader(): void {
    this.header.setText(dim("── Events ──"));
  }

  private refresh(): void {
    this.content.clear();
    for (const entry of this.entries) {
      const line = `[${entry.time}] ${entry.name}${entry.detail ? `  ${entry.detail}` : ""}`;
      this.content.addChild(new Text(dim(line), 1, 0));
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/tui/event-log.ts
git commit -m "feat(demo): add event log component"
```

---

### Task 10: TUI Status Bar

**Files:**
- Create: `packages/demo/src/tui/status-bar.ts`

- [ ] **Step 1: Write status-bar.ts**

```typescript
import { Text } from "@earendil-works/pi-tui";
import { bold, dim } from "../colors.js";

export class StatusBar extends Text {
  constructor() {
    super("", 1, 0);
    this.update(0, 60, "idle");
  }

  update(currentTurn: number, maxTurns: number, status: string): void {
    const statusColor = status === "running" ? bold : status === "error" ? (t: string) => `\x1b[31m${t}\x1b[0m` : dim;
    const text = `Core Demo  |  turn: ${currentTurn}/${maxTurns}  |  status: ${statusColor(status)}`;
    this.setText(text);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/tui/status-bar.ts
git commit -m "feat(demo): add status bar component"
```

---

### Task 11: TUI App Root Component

**Files:**
- Create: `packages/demo/src/tui/app.ts`

- [ ] **Step 1: Write app.ts**

```typescript
import {
  Container,
  Input,
  ProcessTerminal,
  Spacer,
  TUI,
} from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { ChatLog } from "./chat-log.js";
import { EventLog } from "./event-log.js";
import { StatusBar } from "./status-bar.js";

export interface AppCallbacks {
  onSubmit: (text: string) => void;
  onInterrupt: () => void;
}

export class App {
  private tui: TUI;
  private chatLog: ChatLog;
  private eventLog: EventLog;
  private statusBar: StatusBar;
  private input: Input;
  private root: Container;
  private maxTurns: number;

  constructor(maxTurns: number, callbacks: AppCallbacks) {
    this.maxTurns = maxTurns;

    this.chatLog = new ChatLog();
    this.eventLog = new EventLog();
    this.statusBar = new StatusBar();
    this.input = new Input();

    this.input.onSubmit = (value: string) => {
      if (value.trim()) {
        callbacks.onSubmit(value);
      }
    };

    this.input.onEscape = () => {
      callbacks.onInterrupt();
    };

    this.root = new Container();
    this.root.addChild(this.chatLog);
    this.root.addChild(this.eventLog);
    this.root.addChild(new Spacer(1));
    this.root.addChild(this.statusBar);
    this.root.addChild(this.input);

    this.tui = new TUI(new ProcessTerminal(), true);
    this.tui.addChild(this.root);
  }

  start(): void {
    this.tui.start();
    this.tui.setFocus(this.input);
  }

  stop(): void {
    this.tui.stop();
  }

  addUserMessage(text: string): void {
    this.chatLog.addUser(text);
    this.tui.requestRender(true);
  }

  addAssistantMessage(text: string): void {
    this.chatLog.addAssistant(text);
    this.tui.requestRender(true);
  }

  addEvent(name: string, detail?: string): void {
    this.eventLog.addEvent(name, detail);
    this.tui.requestRender(true);
  }

  updateStatus(currentTurn: number, status: string): void {
    this.statusBar.update(currentTurn, this.maxTurns, status);
    this.tui.requestRender(true);
  }

  clearInput(): void {
    this.input.setValue("");
    this.tui.requestRender(true);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/tui/app.ts
git commit -m "feat(demo): add TUI app root component"
```

---

### Task 12: Main Entry Point

**Files:**
- Create: `packages/demo/src/main.ts`

- [ ] **Step 1: Write main.ts**

```typescript
import { App } from "./tui/app.js";
import { createDemoAgent } from "./agent.js";
import { resolveConfig } from "./config.js";

async function main(): Promise<void> {
  const config = resolveConfig();

  const app = new App(config.maxTurns, {
    onSubmit: async (text) => {
      app.addUserMessage(text);
      app.clearInput();

      try {
        const output = await agent.run({ content: text });
        app.addAssistantMessage(output.content);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        app.addAssistantMessage(`Error: ${message}`);
      }
    },
    onInterrupt: () => {
      agent.interrupt();
    },
  });

  const agent = createDemoAgent(config.model, config.agentName, config.maxTurns, {
    onStart: () => {
      app.addEvent("core-agent:start");
    },
    onTurnBefore: (turnNumber) => {
      app.updateStatus(turnNumber, "running");
      app.addEvent("turn:before", `turn #${turnNumber}`);
    },
    onReasonBefore: () => {
      app.addEvent("phase:reason:before", "reasoning...");
    },
    onReasonAfter: (durationMs) => {
      const seconds = (durationMs / 1000).toFixed(1);
      app.addEvent("phase:reason:after", `took ${seconds}s`);
    },
    onTurnAfter: (turnNumber) => {
      app.addEvent("turn:after", `turn #${turnNumber} done`);
      app.updateStatus(turnNumber, "idle");
    },
    onError: (error) => {
      app.addEvent("core-agent:error", error.message);
      app.updateStatus(0, "error");
    },
    onStatusChange: (status) => {
      app.updateStatus(0, status);
    },
  });

  await agent.initialize();

  app.start();

  // Graceful shutdown on SIGINT
  process.on("SIGINT", () => {
    app.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/main.ts
git commit -m "feat(demo): add main entry point"
```

---

### Task 13: README

**Files:**
- Create: `packages/demo/README.md`

- [ ] **Step 1: Write README.md**

```markdown
# @agent-harness/demo

Interactive terminal demo for `@agent-harness/core`.

## Quick Start

```bash
# Set your OpenAI API key
export OPENAI_API_KEY=sk-...

# Run the demo
pnpm start
```

## Configuration

| Environment Variable | Description | Default |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI API key (required) | — |
| `DEMO_MODEL` | Model ID | `gpt-4.1` |
| `DEMO_AGENT_NAME` | Agent name in system prompt | `Core Demo Agent` |
| `DEMO_MAX_TURNS` | Maximum conversation turns | `60` |

## Controls

- **Type** your message and press **Enter** to send
- **Ctrl+C** to interrupt the current turn and exit
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/README.md
git commit -m "docs(demo): add README"
```

---

### Task 14: Build Verification

**Files:**
- Modify: `packages/demo/tsconfig.json` (if needed)

- [ ] **Step 1: Run typecheck**

Run: `cd packages/demo && pnpm typecheck`

Expected: No type errors.

- [ ] **Step 2: Run build**

Run: `cd packages/demo && pnpm build`

Expected: Compilation succeeds, `dist/` directory created with `.js` and `.d.ts` files.

- [ ] **Step 3: Verify imports work**

Run: `cd packages/demo && node -e "import('./dist/main.js').then(() => console.log('OK')).catch(e => console.error(e.message))"`

Expected: Should fail with "OPENAI_API_KEY environment variable is required" (because we didn't set it), confirming the module loads correctly.

- [ ] **Step 4: Commit**

```bash
git add packages/demo/
git commit -m "chore(demo): verify build"
```

---

## Self-Review

### Spec Coverage

| Spec Requirement | Implementing Task |
|---|---|
| TUI with pi-tui | Tasks 7-11 |
| Chat log with user/assistant messages | Tasks 7-8 |
| User messages with background color | Task 7 (UserMessage with `userMessageStyle.bgColor`) |
| Assistant messages without background | Task 7 (AssistantMessage without bgColor) |
| Event log panel | Task 9 |
| Status bar (turns/budget/status) | Task 10 |
| Input box | Task 11 (Input component) |
| CoreAgent integration | Tasks 5-6, 12 |
| Event subscriptions | Task 6 (onStart, onTurnBefore, onReasonBefore, onReasonAfter, onTurnAfter, onError) |
| Real LLM (OpenAI) | Tasks 4-5 |
| Budget control (maxTurns) | Tasks 5-6 |
| Pure conversation (no tools) | Task 6 (no tools registered) |
| Phase 1 scope | All tasks |

### Placeholder Scan

- No TBD/TODO/fill-in-details found.
- All code blocks contain complete implementations.
- All commands have expected outputs.

### Type Consistency

- `AgentCallbacks` interface in Task 6 matches usage in Task 12.
- `AppCallbacks` interface in Task 11 matches usage in Task 12.
- `EventContext` from `@agent-harness/core` is used consistently.
- `LanguageModel` type from `ai` is used in Tasks 4, 5, 6.

**No issues found.**
