# OpenTUI Migration 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `rem-agent-tui` 底层依赖从 `@earendil-works/pi-tui` 替换为 OpenTUI + Solid JSX，实现数据驱动的终端 UI。

**Architecture:** 用 Solid `createStore` 管理全局状态（session、messages、ui），每个组件是 Solid 函数组件，通过 signals/stores 驱动渲染，`@opentui/solid` 提供 `<box>`, `<text>`, `<markdown>`, `<input>`, `<scrollbox>` 等 JSX 元素。`createCliRenderer` + `render()` 启动应用。

**Tech Stack:** `@opentui/core` + `@opentui/solid` + `solid-js` (createStore, createMemo, For, Show, Switch/Match, useKeyboard, onCleanup)

---

## 执行注意事项

以下 API 细节需要在执行时验证（文档可能滞后于实际版本）：

1. **`render()` 签名**: `@opentui/solid` 的 `render(() => <App />)` 第二个参数是否接受 `{ renderer }` 还是自动创建 → 查阅 `node_modules/@opentui/solid` 的类型定义
2. **`<select>` 的事件**: `onSelect` 回调参数是 `{ value: string }` 还是 `string` → 查类型
3. **`<input>` 的 `onSubmit`**: 回调签名是 `(value: string) => void` 还是其他 → 查类型
4. **`<scrollbox>`**: `stickyStart` prop 名称确认（可能叫 `stickyStart`、`sticky` 或 `stickyBottom`）

## 文件结构预览

```
packages/tui/src/
  index.ts              → 公开导出
  app.tsx               → <TUIApp /> 根组件 + 启动逻辑
  store.ts              → Solid createStore + 类型定义
  chat-log.tsx          → <ChatLog /> 消息列表
  status-bar.tsx        → <StatusBar />
  input-box.tsx         → <InputBox />
  session-picker.tsx    → <SessionPicker /> overlay
  message/
    user-message.tsx    → <UserMessage />
    assistant-message.tsx → <AssistantMessage />
    stream-message.tsx  → <StreamMessage />
    reasoning-block.tsx → <ReasoningBlock />
    function-tool-block.tsx → <FunctionToolBlock />
    tool-formatter.ts   → 保留，不变

packages/tui/tests/
  store.test.ts
  status-bar.test.tsx
  reasoning-block.test.tsx
  function-tool-block.test.tsx
  stream-message.test.tsx
  session-picker.test.tsx
```

---

### Task 1: 添加依赖 & 配置 JSX 编译

**Files:**
- Modify: `packages/tui/package.json`
- Modify: `packages/tui/tsconfig.json`

- [ ] **Step 1: 添加新依赖，移除旧依赖**

运行：
```bash
cd packages/tui && pnpm remove @earendil-works/pi-tui && pnpm add @opentui/core @opentui/solid solid-js
```

如果你的 pnpm workspace 版本不支持直接 add，编辑 `packages/tui/package.json`：

```json
{
  "dependencies": {
    "rem-agent-sdk": "workspace:*",
    "@opentui/core": "^latest",
    "@opentui/solid": "^latest",
    "solid-js": "^1.9.0"
  }
}
```

然后运行 `pnpm install`。

- [ ] **Step 2: 配置 tsconfig 支持 Solid JSX**

编辑 `packages/tui/tsconfig.json`，将 `compilerOptions` 改为：

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
    "sourceMap": true,
    "composite": true,
    "jsx": "preserve",
    "jsxImportSource": "solid-js"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"],
  "references": [{ "path": "../sdk" }]
}
```

关键变更：`"jsx": "preserve"` + `"jsxImportSource": "solid-js"`。

- [ ] **Step 3: 验证 JSX 编译**

创建测试文件 `packages/tui/src/_test.tsx`：

```tsx
import { render } from "@opentui/solid";
import type { JSX } from "solid-js";

function Test(): JSX.Element {
  return <text>Hello OpenTUI + Solid</text>;
}
```

运行 `pnpm --filter rem-agent-tui typecheck`，确认无类型错误。然后删除 `_test.tsx`。

- [ ] **Step 4: Commit**

```bash
git add packages/tui/package.json packages/tui/tsconfig.json pnpm-lock.yaml
git commit -m "chore(tui): add OpenTUI + Solid deps, configure JSX"
```

---

### Task 2: 创建状态层 (store.ts)

**Files:**
- Create: `packages/tui/src/store.ts`

- [ ] **Step 1: 定义类型并创建 store**

写入 `packages/tui/src/store.ts`：

```typescript
import { createStore } from "solid-js/store";
import type { SessionSummary } from "rem-agent-sdk";

// ---- 消息 Part 类型 ----
export type TextPart = { type: "text"; content: string };
export type ReasoningPart = {
  type: "reasoning";
  content: string;
  startTime: number;
  duration?: number;
};
export type ToolPart = {
  type: "tool";
  toolName: string;
  input?: unknown;
  status: "pending" | "running" | "success" | "error";
  output?: string;
  error?: string;
  startTime: number;
  endTime?: number;
};
export type MessagePart = TextPart | ReasoningPart | ToolPart;

// ---- 消息类型 ----
export type UserMsg = { role: "user"; content: string };
export type AssistantMsg = { role: "assistant"; content: string };
export type StreamMsg = { role: "assistant-streaming"; parts: Record<string, MessagePart> };
export type Message = UserMsg | AssistantMsg | StreamMsg;

// ---- 状态类型 ----
export interface SessionState {
  sessionId: string;
  currentTurn: number;
  maxTurns: number;
  status: "idle" | "running" | "error";
}

export interface UIState {
  reasoningCollapsed: boolean;
  toolsCollapsed: boolean;
  pickerVisible: boolean;
  pickerSessions: SessionSummary[];
}

export interface AppState {
  session: SessionState;
  messages: Message[];
  ui: UIState;
}

// ---- 工厂函数 ----
export function createInitialState(opts: {
  sessionId: string;
  maxTurns: number;
}): AppState {
  return {
    session: {
      sessionId: opts.sessionId,
      currentTurn: 0,
      maxTurns: opts.maxTurns,
      status: "idle",
    },
    messages: [],
    ui: {
      reasoningCollapsed: true,
      toolsCollapsed: true,
      pickerVisible: false,
      pickerSessions: [],
    },
  };
}

// ---- Store 创建 ----
export function createAppStore(initial: AppState) {
  const [state, setState] = createStore<AppState>(initial);

  function addUserMessage(text: string) {
    setState("messages", (m) => [...m, { role: "user" as const, content: text }]);
  }

  function addAssistantMessage(text: string) {
    setState("messages", (m) => [...m, { role: "assistant" as const, content: text }]);
  }

  function startStreamMessage(): number {
    const msg: StreamMsg = { role: "assistant-streaming", parts: {} };
    setState("messages", (m) => [...m, msg]);
    return state.messages.length; // 返回插入前的索引，新消息在 length-1
  }

  function applyChunk(msgIndex: number, chunk: import("rem-agent-sdk").AgentStreamChunk) {
    switch (chunk.type) {
      case "text-start":
      case "text-delta": {
        const partId = chunk.partId;
        const existing = state.messages[msgIndex]?.parts?.[partId];
        if (existing && existing.type === "text" && chunk.type === "text-delta") {
          setState("messages", msgIndex, "parts", partId, "content",
            (c: string) => c + (chunk as { text: string }).text);
        } else {
          setState("messages", msgIndex, "parts", partId, {
            type: "text",
            content: chunk.type === "text-delta" ? (chunk as { text: string }).text : "",
          });
        }
        break;
      }
      case "reasoning-start":
        setState("messages", msgIndex, "parts", chunk.partId, {
          type: "reasoning",
          content: "",
          startTime: Date.now(),
        });
        break;
      case "reasoning-delta": {
        const re = state.messages[msgIndex]?.parts?.[chunk.partId];
        if (!re || re.type !== "reasoning") {
          setState("messages", msgIndex, "parts", chunk.partId, {
            type: "reasoning",
            content: chunk.text,
            startTime: Date.now(),
          });
        } else {
          setState("messages", msgIndex, "parts", chunk.partId, "content",
            (c: string) => c + chunk.text);
        }
        break;
      }
      case "reasoning-finish": {
        const re = state.messages[msgIndex]?.parts?.[chunk.partId];
        if (re && re.type === "reasoning") {
          setState("messages", msgIndex, "parts", chunk.partId, "duration",
            Date.now() - (re.startTime ?? Date.now()));
        }
        break;
      }
      case "tool-call-start":
        setState("messages", msgIndex, "parts", chunk.partId, {
          type: "tool",
          toolName: chunk.toolName,
          input: undefined,
          status: "pending",
          startTime: Date.now(),
        });
        break;
      case "tool-call":
        setState("messages", msgIndex, "parts", chunk.partId, {
          type: "tool",
          toolName: chunk.toolName,
          input: (chunk as { input: unknown }).input,
          status: "pending",
          startTime: Date.now(),
        });
        break;
      case "tool-result-start":
        setState("messages", msgIndex, "parts", chunk.partId, "status", "running");
        break;
      case "tool-result": {
        const tr = chunk as { output: string; error?: string };
        setState("messages", msgIndex, "parts", chunk.partId, {
          status: tr.error ? "error" : "success",
          output: tr.output,
          error: tr.error,
          endTime: Date.now(),
        });
        break;
      }
    }
  }

  function finishStreamMessage(msgIndex: number, content: string) {
    const msg = state.messages[msgIndex];
    if (!msg || msg.role !== "assistant-streaming") return;
    if (content && Object.keys(msg.parts).length === 0) {
      setState("messages", msgIndex, {
        role: "assistant",
        content,
      });
    } else {
      setState("messages", msgIndex, "role", "assistant" as const);
    }
  }

  function errorStreamMessage(msgIndex: number, errorMessage: string) {
    const msg = state.messages[msgIndex];
    if (!msg || msg.role !== "assistant-streaming") return;
    if (Object.keys(msg.parts).length === 0) {
      setState("messages", msgIndex, {
        role: "assistant",
        content: `Error: ${errorMessage}`,
      });
    } else {
      setState("messages", msgIndex, "role", "assistant" as const);
    }
  }

  function clearMessages() {
    setState("messages", []);
  }

  function toggleReasoningCollapsed() {
    setState("ui", "reasoningCollapsed", (v) => !v);
  }

  function toggleToolsCollapsed() {
    setState("ui", "toolsCollapsed", (v) => !v);
  }

  return {
    state,
    setState,
    addUserMessage,
    addAssistantMessage,
    startStreamMessage,
    applyChunk,
    finishStreamMessage,
    errorStreamMessage,
    clearMessages,
    toggleReasoningCollapsed,
    toggleToolsCollapsed,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/tui/src/store.ts
git commit -m "feat(tui): add Solid store with session, message, and UI state"
```

---

### Task 3: StatusBar 组件

**Files:**
- Create: `packages/tui/src/status-bar.tsx`
- Create: `packages/tui/tests/status-bar.test.tsx`

- [ ] **Step 1: 实现 StatusBar**

写入 `packages/tui/src/status-bar.tsx`：

```tsx
import type { JSX } from "solid-js";
import { createMemo } from "solid-js";
import type { SessionState } from "./store.js";

export function StatusBar(props: { session: SessionState }): JSX.Element {
  const text = createMemo(() => {
    const s = props.session;
    const id = s.sessionId.slice(0, 8);
    return `Core Demo  |  turn: ${s.currentTurn}/${s.maxTurns}  |  status: ${s.status}  |  ${id}`;
  });

  return (
    <text fg={props.session.status === "error" ? "#FF0000" : undefined}>
      {text()}
    </text>
  );
}
```

- [ ] **Step 2: 写测试**

由于 OpenTUI + Solid 的测试需要 `@opentui/solid` 的 `testRender`，先写基本测试。创建 `packages/tui/tests/status-bar.test.tsx`：

```tsx
import { describe, it, expect } from "vitest";

// Solid 组件的纯逻辑测试：StatusBar 的文本派生逻辑
import type { SessionState } from "../src/store.js";

function statusBarText(session: SessionState): string {
  const id = session.sessionId.slice(0, 8);
  return `Core Demo  |  turn: ${session.currentTurn}/${session.maxTurns}  |  status: ${session.status}  |  ${id}`;
}

describe("StatusBar", () => {
  it("shows turn, maxTurns, status, and sessionId prefix", () => {
    const session: SessionState = {
      sessionId: "1234567890abcdef",
      currentTurn: 3,
      maxTurns: 60,
      status: "running",
    };
    const text = statusBarText(session);
    expect(text).toContain("turn: 3/60");
    expect(text).toContain("status: running");
    expect(text).toContain("12345678");
  });

  it("shows idle status initially", () => {
    const session: SessionState = {
      sessionId: "abc",
      currentTurn: 0,
      maxTurns: 60,
      status: "idle",
    };
    const text = statusBarText(session);
    expect(text).toContain("status: idle");
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
pnpm --filter rem-agent-tui test
```

预期：2 tests pass。

- [ ] **Step 4: Commit**

```bash
git add packages/tui/src/status-bar.tsx packages/tui/tests/status-bar.test.tsx
git commit -m "feat(tui): add StatusBar component"
```

---

### Task 4: UserMessage & AssistantMessage 组件

**Files:**
- Create: `packages/tui/src/message/user-message.tsx`
- Create: `packages/tui/src/message/assistant-message.tsx`

- [ ] **Step 1: 实现 UserMessage**

写入 `packages/tui/src/message/user-message.tsx`：

```tsx
import type { JSX } from "solid-js";

export function UserMessage(props: { content: string }): JSX.Element {
  return (
    <box padding={1} margin={{ top: 0, bottom: 0, left: 0, right: 0 }}>
      <markdown content={props.content} />
    </box>
  );
}
```

- [ ] **Step 2: 实现 AssistantMessage**

写入 `packages/tui/src/message/assistant-message.tsx`：

```tsx
import type { JSX } from "solid-js";

export function AssistantMessage(props: { content: string }): JSX.Element {
  return (
    <box padding={1} margin={{ top: 0, bottom: 0, left: 0, right: 0 }}>
      <markdown content={props.content} />
    </box>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/tui/src/message/user-message.tsx packages/tui/src/message/assistant-message.tsx
git commit -m "feat(tui): add UserMessage and AssistantMessage components"
```

---

### Task 5: InputBox 组件

**Files:**
- Create: `packages/tui/src/input-box.tsx`

- [ ] **Step 1: 实现 InputBox**

写入 `packages/tui/src/input-box.tsx`：

```tsx
import type { JSX } from "solid-js";

interface InputBoxProps {
  disabled: boolean;
  onSubmit: (text: string) => void;
}

export function InputBox(props: InputBoxProps): JSX.Element {
  function handleSubmit(value: string) {
    const trimmed = value.trim();
    if (trimmed) {
      props.onSubmit(trimmed);
    }
  }

  return (
    <box margin={{ top: 1, bottom: 0, left: 0, right: 0 }}>
      <input
        placeholder={props.disabled ? "Agent is running..." : "Type a message..."}
        disabled={props.disabled}
        onSubmit={handleSubmit}
        width="100%"
      />
    </box>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/tui/src/input-box.tsx
git commit -m "feat(tui): add InputBox component"
```

---

### Task 6: ReasoningBlock 组件

**Files:**
- Create: `packages/tui/src/message/reasoning-block.tsx`
- Create: `packages/tui/tests/reasoning-block.test.tsx`

- [ ] **Step 1: 实现 ReasoningBlock**

写入 `packages/tui/src/message/reasoning-block.tsx`：

```tsx
import type { JSX } from "solid-js";
import { createSignal } from "solid-js";
import type { ReasoningPart } from "../store.js";

export function ReasoningBlock(props: {
  part: ReasoningPart;
  globalCollapsed: boolean;
}): JSX.Element {
  const [localCollapsed, setLocalCollapsed] = createSignal(true);
  const collapsed = () => props.globalCollapsed || localCollapsed();

  function toggleLocal() {
    setLocalCollapsed((v) => !v);
  }

  const label = () => {
    const p = props.part;
    const base = p.duration != null
      ? `think for ${(p.duration / 1000).toFixed(1)}s`
      : "thinking";
    if (collapsed()) {
      const preview = previewText(p.content);
      const hint = preview ? `: ${preview}` : "";
      return `${base}${hint} > (ctrl+o 展开)`;
    }
    return base;
  };

  return (
    <box borderStyle="single" padding={{ top: 0, bottom: 0, left: 1, right: 1 }}
         margin={{ top: 0, bottom: 0, left: 0, right: 0 }}>
      <box onClick={toggleLocal}>
        <text dim>{label()}</text>
      </box>
      <Show when={!collapsed()}>
        <markdown content={props.part.content} />
      </Show>
    </box>
  );
}

function previewText(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > 50 ? `${clean.slice(0, 50)}…` : clean;
}
```

- [ ] **Step 2: 写测试**

创建 `packages/tui/tests/reasoning-block.test.tsx`：

```tsx
import { describe, it, expect } from "vitest";

function previewText(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > 50 ? `${clean.slice(0, 50)}…` : clean;
}

function reasoningLabel(part: { content: string; duration?: number; startTime: number }, collapsed: boolean): string {
  const base = part.duration != null
    ? `think for ${(part.duration / 1000).toFixed(1)}s`
    : "thinking";
  if (collapsed) {
    const preview = previewText(part.content);
    const hint = preview ? `: ${preview}` : "";
    return `${base}${hint} > (ctrl+o 展开)`;
  }
  return base;
}

describe("ReasoningBlock label", () => {
  it("shows 'thinking' when not finished", () => {
    const label = reasoningLabel({ content: "", startTime: Date.now() }, true);
    expect(label).toContain("thinking");
    expect(label).toContain("ctrl+o");
  });

  it("shows duration after finish", () => {
    const label = reasoningLabel({ content: "done thinking", duration: 3000, startTime: Date.now() - 3000 }, true);
    expect(label).toContain("think for 3.0s");
  });

  it("shows preview text in collapsed mode", () => {
    const label = reasoningLabel({ content: "short text", duration: 1000, startTime: Date.now() }, true);
    expect(label).toContain("short text");
  });

  it("does not show expand hint when expanded", () => {
    const label = reasoningLabel({ content: "", startTime: Date.now() }, false);
    expect(label).not.toContain("ctrl+o");
  });

  it("truncates long preview text to 50 chars", () => {
    const long = "a".repeat(100);
    const p = previewText(long);
    expect(p.endsWith("…")).toBe(true);
    expect(p.length).toBeLessThan(60);
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
pnpm --filter rem-agent-tui test
```

预期：5 tests pass。

- [ ] **Step 4: Commit**

```bash
git add packages/tui/src/message/reasoning-block.tsx packages/tui/tests/reasoning-block.test.tsx
git commit -m "feat(tui): add ReasoningBlock component with collapsible behavior"
```

---

### Task 7: FunctionToolBlock 组件

**Files:**
- Create: `packages/tui/src/message/function-tool-block.tsx`
- Create: `packages/tui/tests/function-tool-block.test.tsx`

`tool-formatter.ts` 保持不动，继续复用。

- [ ] **Step 1: 实现 FunctionToolBlock**

写入 `packages/tui/src/message/function-tool-block.tsx`：

```tsx
import type { JSX } from "solid-js";
import { createSignal } from "solid-js";
import { Show } from "solid-js";
import type { ToolPart } from "../store.js";
import { getToolFormatter } from "./tool-formatter.js";

function statusIcon(status: string): string {
  switch (status) {
    case "pending":
    case "running":
      return "◐";
    case "success":
      return "✓";
    case "error":
      return "✗";
    default:
      return "?";
  }
}

function formatDuration(startTime: number, endTime?: number): string {
  if (!endTime) return "";
  const ms = endTime - startTime;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function FunctionToolBlock(props: {
  part: ToolPart;
  globalCollapsed: boolean;
}): JSX.Element {
  const [localCollapsed, setLocalCollapsed] = createSignal(true);
  const collapsed = () => props.globalCollapsed || localCollapsed();

  const formatter = () => getToolFormatter(props.part.toolName);

  function toggleLocal() {
    setLocalCollapsed((v) => !v);
  }

  const label = () => {
    const p = props.part;
    const icon = statusIcon(p.status);
    const call = formatter().formatCall(p.toolName, p.input);
    const duration = formatDuration(p.startTime, p.endTime);

    if (p.status === "pending" || p.status === "running") {
      const hint = collapsed() ? " (ctrl+o 展开)" : "";
      return `${icon} ${call} ...${hint}`;
    }

    const summary = formatter().formatResultSummary(
      p.toolName, p.input, p.output ?? "", p.error,
    );

    if (collapsed()) {
      return `${icon} ${call}  ${summary}  (ctrl+o 展开)`;
    }
    return `${icon} ${call}${duration ? ` (${duration})` : ""}`;
  };

  const body = () => {
    const p = props.part;
    return formatter().formatResultBody(
      p.toolName, p.input, p.output ?? "", p.error,
    );
  };

  return (
    <box borderStyle="single" padding={{ top: 0, bottom: 0, left: 1, right: 1 }}
         margin={{ top: 0, bottom: 0, left: 0, right: 0 }}>
      <box onClick={toggleLocal}>
        <text dim>{label()}</text>
      </box>
      <Show when={!collapsed() && (props.part.status === "success" || props.part.status === "error")}>
        <markdown content={body()} />
      </Show>
    </box>
  );
}
```

- [ ] **Step 2: 写测试**

创建 `packages/tui/tests/function-tool-block.test.tsx`，测试 tool formatter 集成和 label 生成逻辑（纯函数测试，类似 ReasoningBlock）：

```tsx
import { describe, it, expect } from "vitest";
import { getToolFormatter } from "../src/message/tool-formatter.js";

function statusIcon(status: string): string {
  switch (status) {
    case "pending":
    case "running":
      return "◐";
    case "success":
      return "✓";
    case "error":
      return "✗";
    default:
      return "?";
  }
}

describe("FunctionToolBlock", () => {
  it("formats read tool call", () => {
    const fmt = getToolFormatter("read");
    const call = fmt.formatCall("read", { path: "foo.txt" });
    expect(call).toContain("Read(foo.txt)");
  });

  it("shows pending icon", () => {
    expect(statusIcon("pending")).toBe("◐");
  });

  it("shows success icon", () => {
    expect(statusIcon("success")).toBe("✓");
  });

  it("shows error icon", () => {
    expect(statusIcon("error")).toBe("✗");
  });

  it("formats write tool", () => {
    const fmt = getToolFormatter("write");
    const call = fmt.formatCall("write", { path: "out.txt" });
    expect(call).toContain("Write(out.txt)");
  });

  it("formats edit tool with edit count", () => {
    const fmt = getToolFormatter("edit");
    const call = fmt.formatCall("edit", { path: "src/a.ts", edits: [{}, {}] });
    expect(call).toContain("Edit(src/a.ts)");
    expect(call).toContain("2 edits");
  });

  it("formats ls tool", () => {
    const fmt = getToolFormatter("ls");
    const call = fmt.formatCall("ls", { path: "." });
    expect(call).toContain("ls(.)");
  });

  it("uses default formatter for unknown tools", () => {
    const fmt = getToolFormatter("unknown_tool");
    const call = fmt.formatCall("unknown_tool", { key: "val" });
    expect(call).toContain("unknown_tool");
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
pnpm --filter rem-agent-tui test
```

预期：8 tests pass。

- [ ] **Step 4: Commit**

```bash
git add packages/tui/src/message/function-tool-block.tsx packages/tui/tests/function-tool-block.test.tsx
git commit -m "feat(tui): add FunctionToolBlock component with tool formatter integration"
```

---

### Task 8: StreamMessage 组件

**Files:**
- Create: `packages/tui/src/message/stream-message.tsx`
- Create: `packages/tui/tests/stream-message.test.tsx`

- [ ] **Step 1: 实现 StreamMessage**

写入 `packages/tui/src/message/stream-message.tsx`：

```tsx
import type { JSX } from "solid-js";
import { For, Switch, Match } from "solid-js";
import type { MessagePart } from "../store.js";
import { AssistantMessage } from "./assistant-message.js";
import { ReasoningBlock } from "./reasoning-block.js";
import { FunctionToolBlock } from "./function-tool-block.js";

export function StreamMessage(props: {
  parts: Record<string, MessagePart>;
  reasoningCollapsed: boolean;
  toolsCollapsed: boolean;
}): JSX.Element {
  const entries = () => Object.entries(props.parts);

  return (
    <box flexDirection="column">
      <For each={entries()}>
        {([_partId, part]) => (
          <Switch>
            <Match when={part.type === "text"}>
              <AssistantMessage content={part.content} />
            </Match>
            <Match when={part.type === "reasoning"}>
              <ReasoningBlock
                part={part}
                globalCollapsed={props.reasoningCollapsed}
              />
            </Match>
            <Match when={part.type === "tool"}>
              <FunctionToolBlock
                part={part}
                globalCollapsed={props.toolsCollapsed}
              />
            </Match>
          </Switch>
        )}
      </For>
    </box>
  );
}
```

- [ ] **Step 2: 写测试**

创建 `packages/tui/tests/stream-message.test.tsx`，测试 store.applyChunk 逻辑：

```tsx
import { describe, it, expect } from "vitest";
import { createAppStore, createInitialState, type StreamMsg } from "../src/store.js";
import type { AgentStreamChunk } from "rem-agent-core";

describe("StreamMessage / store.applyChunk", () => {
  it("builds text parts from text-start + text-delta chunks", () => {
    const initial = createInitialState({ sessionId: "test", maxTurns: 60 });
    const store = createAppStore(initial);

    const idx = store.startStreamMessage() - 1;
    store.applyChunk(idx, { type: "text-start", step: 1, partId: "p1" } as AgentStreamChunk);
    store.applyChunk(idx, { type: "text-delta", step: 1, partId: "p1", text: "hello" } as AgentStreamChunk);
    store.applyChunk(idx, { type: "text-delta", step: 1, partId: "p1", text: " world" } as AgentStreamChunk);

    const msg = store.state.messages[idx] as StreamMsg;
    expect(msg.parts["p1"].type).toBe("text");
    expect((msg.parts["p1"] as { content: string }).content).toBe("hello world");
  });

  it("builds reasoning parts with duration tracking", () => {
    const initial = createInitialState({ sessionId: "test", maxTurns: 60 });
    const store = createAppStore(initial);

    const idx = store.startStreamMessage() - 1;
    store.applyChunk(idx, { type: "reasoning-start", step: 1, partId: "r1" } as AgentStreamChunk);
    store.applyChunk(idx, { type: "reasoning-delta", step: 1, partId: "r1", text: "thinking" } as AgentStreamChunk);
    store.applyChunk(idx, { type: "reasoning-finish", step: 1, partId: "r1" } as AgentStreamChunk);

    const msg = store.state.messages[idx] as StreamMsg;
    expect(msg.parts["r1"].type).toBe("reasoning");
    const rp = msg.parts["r1"] as { content: string; duration?: number };
    expect(rp.content).toBe("thinking");
    expect(typeof rp.duration).toBe("number");
  });

  it("builds tool parts with status transitions", () => {
    const initial = createInitialState({ sessionId: "test", maxTurns: 60 });
    const store = createAppStore(initial);

    const idx = store.startStreamMessage() - 1;
    store.applyChunk(idx, { type: "tool-call-start", step: 1, partId: "tc1", toolCallId: "tc1", toolName: "read" } as AgentStreamChunk);
    store.applyChunk(idx, { type: "tool-call", step: 1, partId: "tc1", toolCallId: "tc1", toolName: "read", input: { path: "foo.txt" } } as AgentStreamChunk);
    store.applyChunk(idx, { type: "tool-result-start", step: 1, partId: "tc1", toolCallId: "tc1" } as AgentStreamChunk);
    store.applyChunk(idx, { type: "tool-result", step: 1, partId: "tc1", toolCallId: "tc1", output: "file content", error: undefined } as AgentStreamChunk);

    const msg = store.state.messages[idx] as StreamMsg;
    const tp = msg.parts["tc1"];
    expect(tp.type).toBe("tool");
    expect((tp as { status: string }).status).toBe("success");
  });

  it("finishStreamMessage converts StreamMsg to AssistantMsg", () => {
    const initial = createInitialState({ sessionId: "test", maxTurns: 60 });
    const store = createAppStore(initial);

    const idx = store.startStreamMessage() - 1;
    store.finishStreamMessage(idx, "final text");

    const msg = store.state.messages[idx];
    expect(msg.role).toBe("assistant");
    expect("content" in msg).toBe(true);
  });

  it("clears messages", () => {
    const initial = createInitialState({ sessionId: "test", maxTurns: 60 });
    const store = createAppStore(initial);
    store.addUserMessage("hello");
    store.addUserMessage("world");
    expect(store.state.messages.length).toBe(2);
    store.clearMessages();
    expect(store.state.messages.length).toBe(0);
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
pnpm --filter rem-agent-tui test
```

预期：所有测试通过。

- [ ] **Step 4: Commit**

```bash
git add packages/tui/src/message/stream-message.tsx packages/tui/tests/stream-message.test.tsx
git commit -m "feat(tui): add StreamMessage component with chunk-based store updates"
```

---

### Task 9: ChatLog 组件

**Files:**
- Create: `packages/tui/src/chat-log.tsx`

- [ ] **Step 1: 实现 ChatLog**

写入 `packages/tui/src/chat-log.tsx`：

```tsx
import type { JSX } from "solid-js";
import { For, Show, Switch, Match } from "solid-js";
import type { Message } from "./store.js";
import { UserMessage } from "./message/user-message.js";
import { AssistantMessage } from "./message/assistant-message.js";
import { StreamMessage } from "./message/stream-message.js";

export function ChatLog(props: {
  messages: Message[];
  reasoningCollapsed: boolean;
  toolsCollapsed: boolean;
}): JSX.Element {
  return (
    <scrollbox flexGrow={1} stickyStart="bottom">
      <box flexDirection="column" gap={1}>
        <For each={props.messages}>
          {(msg) => (
            <Switch>
              <Match when={msg.role === "user"}>
                <UserMessage content={(msg as { content: string }).content} />
              </Match>
              <Match when={msg.role === "assistant"}>
                <AssistantMessage content={(msg as { content: string }).content} />
              </Match>
              <Match when={(msg as { role: string }).role === "assistant-streaming"}>
                <StreamMessage
                  parts={(msg as { parts: Record<string, unknown> }).parts as Record<string, import("./store.js").MessagePart>}
                  reasoningCollapsed={props.reasoningCollapsed}
                  toolsCollapsed={props.toolsCollapsed}
                />
              </Match>
            </Switch>
          )}
        </For>
      </box>
    </scrollbox>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/tui/src/chat-log.tsx
git commit -m "feat(tui): add ChatLog component with scrollbox"
```

---

### Task 10: SessionPicker 组件

**Files:**
- Create: `packages/tui/src/session-picker.tsx`
- Create: `packages/tui/tests/session-picker.test.tsx`

- [ ] **Step 1: 实现 SessionPicker**

写入 `packages/tui/src/session-picker.tsx`：

```tsx
import type { JSX } from "solid-js";
import { For } from "solid-js";
import type { SessionSummary } from "rem-agent-sdk";

export function SessionPicker(props: {
  sessions: SessionSummary[];
  onSelect: (sessionId: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const options = () =>
    props.sessions.map((s) => ({
      name: s.title ? `${s.title} (${s.sessionId.slice(0, 8)})` : s.sessionId.slice(0, 8),
      description: `${s.messageCount} messages  •  ${new Date(s.updatedAt).toLocaleString()}`,
      value: s.sessionId,
    }));

  return (
    <box position="absolute" left={0} top={0} width="100%" height="100%"
         zIndex={100} backgroundColor="#00000088">
      <box position="absolute" left="25%" top="25%" width="50%" height="50%"
           borderStyle="rounded" padding={1} backgroundColor="#1a1a2e"
           flexDirection="column">
        <text fg="#FFFF00" bold>Select Session</text>
        <box flexGrow={1}>
          <select
            options={options()}
            onSelect={(item: { value: string }) => props.onSelect(item.value)}
            onCancel={props.onCancel}
          />
        </box>
        <text dim>Press Esc to cancel</text>
      </box>
    </box>
  );
}
```

- [ ] **Step 2: 写测试**

创建 `packages/tui/tests/session-picker.test.tsx`：

```tsx
import { describe, it, expect } from "vitest";
import type { SessionSummary } from "rem-agent-sdk";

describe("SessionPicker options", () => {
  it("formats session with title", () => {
    const sessions: SessionSummary[] = [
      { sessionId: "12345678-90ab", title: "Debug session", updatedAt: "2026-06-01T00:00:00Z", messageCount: 5 },
    ];
    const options = sessions.map((s) => ({
      name: s.title ? `${s.title} (${s.sessionId.slice(0, 8)})` : s.sessionId.slice(0, 8),
      description: `${s.messageCount} messages  •  ${new Date(s.updatedAt).toLocaleString()}`,
      value: s.sessionId,
    }));
    expect(options[0].name).toContain("Debug session");
    expect(options[0].name).toContain("12345678");
  });

  it("falls back to sessionId when no title", () => {
    const sessions: SessionSummary[] = [
      { sessionId: "abcdef12-3456", title: undefined, updatedAt: "2026-06-01T00:00:00Z", messageCount: 0 },
    ];
    const options = sessions.map((s) => ({
      name: s.title ? `${s.title} (${s.sessionId.slice(0, 8)})` : s.sessionId.slice(0, 8),
      description: `${s.messageCount} messages`,
      value: s.sessionId,
    }));
    expect(options[0].name).toBe("abcdef12");
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
pnpm --filter rem-agent-tui test
```

- [ ] **Step 4: Commit**

```bash
git add packages/tui/src/session-picker.tsx packages/tui/tests/session-picker.test.tsx
git commit -m "feat(tui): add SessionPicker overlay component"
```

---

### Task 11: TUIApp 根组件

**Files:**
- Create: `packages/tui/src/app.tsx`

- [ ] **Step 1: 实现 TUIApp**

写入 `packages/tui/src/app.tsx`：

```tsx
import type { JSX } from "solid-js";
import { Show, createMemo } from "solid-js";
import { render } from "@opentui/solid";
import { createCliRenderer } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import { AgentClient } from "rem-agent-sdk";
import type { AgentStreamChunk, SessionSummary } from "rem-agent-sdk";
import {
  createAppStore,
  createInitialState,
} from "./store.js";
import { ChatLog } from "./chat-log.js";
import { StatusBar } from "./status-bar.js";
import { InputBox } from "./input-box.js";
import { SessionPicker } from "./session-picker.js";
import { appendLog } from "./logger.js";

export interface TUIAppOptions {
  serverUrl: string;
  sessionId?: string;
  maxTurns?: number;
}

function TUIApp(props: TUIAppOptions) {
  const initial = createInitialState({
    sessionId: props.sessionId ?? generateId(),
    maxTurns: props.maxTurns ?? 60,
  });
  const store = createAppStore(initial);
  const client = new AgentClient(props.serverUrl);

  const isRunning = () => store.state.session.status === "running";

  // 键盘处理
  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      process.exit(0);
    }
    if (key.ctrl && key.name === "o") {
      store.toggleReasoningCollapsed();
      store.toggleToolsCollapsed();
    }
    if (key.name === "escape") {
      if (store.state.ui.pickerVisible) {
        store.setState("ui", "pickerVisible", false);
      } else if (isRunning()) {
        client.interrupt(store.state.session.sessionId).catch(() => {});
      }
    }
  });

  async function handleSubmit(text: string) {
    if (isRunning()) return;
    if (store.state.session.currentTurn >= store.state.session.maxTurns) {
      store.addAssistantMessage("Maximum turns reached. Start a new session with /new.");
      return;
    }

    // 处理内置命令
    if (text === "/new") {
      await handleNewSession();
      return;
    }
    if (text === "/resume") {
      await handleResumeCommand();
      return;
    }

    store.setState("session", "status", "running");
    store.setState("session", "currentTurn", (t) => t + 1);
    store.addUserMessage(text);

    const msgIndex = store.startStreamMessage() - 1;
    appendLog("turn:before", `turn #${store.state.session.currentTurn}`);

    try {
      const stream = await client.run(store.state.session.sessionId, text);
      for await (const chunk of stream) {
        store.applyChunk(msgIndex, chunk);
        if (chunk.type === "finish") {
          store.finishStreamMessage(msgIndex, chunk.output.content);
          store.setState("session", "status", "idle");
        } else if (chunk.type === "error") {
          const errMsg = chunk.error instanceof Error ? chunk.error.message : String(chunk.error);
          store.errorStreamMessage(msgIndex, errMsg);
          store.setState("session", "status", "error");
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      appendLog("core-agent:error", errMsg);
      store.errorStreamMessage(msgIndex, errMsg);
      store.setState("session", "status", "error");
    }
  }

  async function handleNewSession() {
    client.interrupt(store.state.session.sessionId).catch(() => {});
    store.clearMessages();
    store.setState("session", {
      sessionId: generateId(),
      currentTurn: 0,
      status: "idle",
    });
    appendLog("session", "new session created");
  }

  async function handleResumeCommand() {
    const sessions = await client.listSessions();
    if (sessions.length === 0) {
      appendLog("resume", "no sessions found");
      return;
    }
    store.setState("ui", "pickerSessions", sessions);
    store.setState("ui", "pickerVisible", true);
  }

  async function handleSessionSelect(sessionId: string) {
    store.setState("ui", "pickerVisible", false);
    client.interrupt(store.state.session.sessionId).catch(() => {});
    store.clearMessages();
    store.setState("session", {
      sessionId,
      currentTurn: 0,
      status: "idle",
    });
    appendLog("resume", `loaded session ${sessionId.slice(0, 8)}`);
  }

  const statusBarText = createMemo(() => {
    // StatusBar is a separate component; this is for the render tree
    return null;
  });

  return (
    <box flexDirection="column" height="100%">
      <ChatLog
        messages={store.state.messages}
        reasoningCollapsed={store.state.ui.reasoningCollapsed}
        toolsCollapsed={store.state.ui.toolsCollapsed}
      />
      <StatusBar session={store.state.session} />
      <InputBox disabled={isRunning()} onSubmit={handleSubmit} />
      <Show when={store.state.ui.pickerVisible}>
        <SessionPicker
          sessions={store.state.ui.pickerSessions}
          onSelect={handleSessionSelect}
          onCancel={() => store.setState("ui", "pickerVisible", false)}
        />
      </Show>
    </box>
  );
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function createTUIApp(options: TUIAppOptions): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false, // 我们手动处理 Ctrl+C
    targetFps: 30,
    screenMode: "alternate-screen",
  });

  const dispose = render(() => <TUIApp {...options} />, {
    renderer,
  });

  process.on("SIGINT", () => {
    dispose();
    renderer.destroy();
    process.exit(0);
  });
}
```

注意：`render()` 的具体调用方式取决于 `@opentui/solid` 的实际 API。如果 `render` 第二个参数不接受 `{ renderer }`，需要根据实际 API 调整。

- [ ] **Step 2: Commit**

```bash
git add packages/tui/src/app.tsx
git commit -m "feat(tui): add TUIApp root component with full data flow"
```

---

### Task 12: Logger & 辅助模块

**Files:**
- Create: `packages/tui/src/logger.ts`

- [ ] **Step 1: 实现 logger**

写入 `packages/tui/src/logger.ts`：

```typescript
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

function getLogPath(): string {
  const envPath = process.env.TUI_LOG_FILE;
  if (envPath) return envPath.replace(/^~/, homedir());
  return join(homedir(), ".rem-agent", "tui.log");
}

let logPath: string | null = null;

export async function appendLog(type: string, message: string): Promise<void> {
  if (!logPath) logPath = getLogPath();
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${type}: ${message}\n`;
  await appendFile(logPath, line).catch(() => {});
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/tui/src/logger.ts
git commit -m "feat(tui): add logger for event log file writing"
```

---

### Task 13: 更新 index.ts 和 demo

**Files:**
- Modify: `packages/tui/src/index.ts`
- Modify: `packages/demo/src/main.ts`

- [ ] **Step 1: 更新 index.ts**

覆盖 `packages/tui/src/index.ts`：

```typescript
export { createTUIApp } from "./app.js";
export type { TUIAppOptions } from "./app.js";
```

- [ ] **Step 2: 更新 demo main.ts**

在 `packages/demo/src/main.ts` 中，将 `runTUI` 函数改为：

```typescript
import { createTUIApp } from "rem-agent-tui";

async function runTUI(): Promise<void> {
  const config = resolveConfig();
  await createTUIApp({
    serverUrl: `http://${config.host}:${config.port}`,
    sessionId: config.sessionId,
    maxTurns: config.maxTurns,
  });
}
```

移除旧的 `import { TUIApp } from "rem-agent-tui"` 和 `app.init()`、`app.start()` 调用。

- [ ] **Step 3: 类型检查**

```bash
pnpm typecheck
```

修复任何类型错误。

- [ ] **Step 4: Commit**

```bash
git add packages/tui/src/index.ts packages/demo/src/main.ts
git commit -m "feat: wire up new OpenTUI-based TUIApp in demo"
```

---

### Task 14: 清理旧文件 & 删除 pi-tui 引用

**Files:**
- Delete: `packages/tui/src/app.ts` (旧 pi-tui 版本，已被 `app.tsx` 取代)
- Delete: `packages/tui/src/chat-log.ts` (旧)
- Delete: `packages/tui/src/event-log.ts` (不再需要)
- Delete: `packages/tui/src/colors.ts` (OpenTUI 原生处理颜色)
- Delete: `packages/tui/src/theme.ts` (OpenTUI 原生 markdown 样式)
- Delete: `packages/tui/src/message/user-message.ts` (旧)
- Delete: `packages/tui/src/message/assistant-message.ts` (旧)
- Delete: `packages/tui/src/message/stream-message.ts` (旧)
- Delete: `packages/tui/src/message/function-tool-block.ts` (旧)
- Delete: `packages/tui/src/message/reasoning-block.ts` (旧)
- Delete: `packages/tui/src/session-picker.ts` (旧)
- Delete: `packages/tui/src/status-bar.ts` (旧)
- Delete: `packages/tui/tests/app.test.ts` (旧)
- Delete: `packages/tui/tests/chat-log.test.ts` (旧)
- Delete: `packages/tui/tests/minimax-tui-render.test.ts` (旧)
- Delete: `packages/tui/tests/stream-message.test.ts` (旧 .ts, 已替换为 .tsx)
- Delete: `packages/tui/tests/function-tool-block.test.ts` (旧 .ts, 已替换为 .tsx)
- Delete: `packages/tui/tests/reasoning-block.test.ts` (旧 .ts, 已替换为 .tsx)
- Delete: `packages/tui/tests/session-picker.test.ts` (旧 .ts, 已替换为 .tsx)

- [ ] **Step 1: 删除旧文件**

```bash
cd packages/tui
rm src/app.ts src/chat-log.ts src/event-log.ts src/colors.ts src/theme.ts
rm src/message/user-message.ts src/message/assistant-message.ts src/message/stream-message.ts
rm src/message/function-tool-block.ts src/message/reasoning-block.ts
rm src/session-picker.ts src/status-bar.ts
rm tests/app.test.ts tests/chat-log.test.ts tests/minimax-tui-render.test.ts
rm tests/stream-message.test.ts tests/function-tool-block.test.ts
rm tests/reasoning-block.test.ts tests/session-picker.test.ts
```

- [ ] **Step 2: 类型检查**

```bash
pnpm typecheck
```

确认无编译错误。

- [ ] **Step 3: 运行全部测试**

```bash
pnpm test
```

- [ ] **Step 4: Commit**

```bash
git add -A packages/tui/
git commit -m "refactor(tui): remove old pi-tui files, replace with OpenTUI + Solid"
```

---

### Task 15: 端到端验证

**Files:**
- Modify: `packages/tui/package.json`（如有需要）

- [ ] **Step 1: 确保 scripts 正确**

检查 `packages/tui/package.json` 中的 build/test/typecheck 命令仍然正确：

```json
{
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "cd ../.. && vitest run packages/tui/tests"
  }
}
```

- [ ] **Step 2: 全流程构建**

```bash
pnpm install
pnpm typecheck
pnpm test
```

所有测试通过，类型检查无错误。

- [ ] **Step 3: Commit**

```bash
git add packages/tui/package.json
git commit -m "chore(tui): verify build and test scripts"
```
