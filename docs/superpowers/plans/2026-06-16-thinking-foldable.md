# TUI Thinking 块折叠实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `rem-agent-tui` 增加 thinking/reasoning 块的全局折叠能力：默认折叠，按 `ctrl+o` 一键展开/收起所有 thinking 块。

**Architecture:** `ChatLog` 持有全局 `thinkingCollapsed` 状态并在创建新流式消息时向下传播；`StreamAssistantMessage` 将状态传给每个 `ReasoningBlock`；`ReasoningBlock` 覆盖 `render` 控制折叠/展开渲染；`TUIApp` 通过 `addInputListener` 捕获 `ctrl+o`。

**Tech Stack:** TypeScript, pnpm workspace, vitest, `@earendil-works/pi-tui`

---

## 文件结构

### 修改文件

- `packages/tui/src/message/reasoning-block.ts` — `ReasoningBlock` 增加折叠状态与渲染控制
- `packages/tui/src/message/stream-message.ts` — `StreamAssistantMessage` 接收并传播折叠状态
- `packages/tui/src/chat-log.ts` — `ChatLog` 持有全局折叠状态并提供 `toggleThinkingCollapsed()`
- `packages/tui/src/app.ts` — `TUIApp` 注册 `ctrl+o` 快捷键

### 新建测试文件

- `packages/tui/tests/reasoning-block.test.ts` — `ReasoningBlock` 折叠/展开行为测试

### 扩展测试文件

- `packages/tui/tests/stream-message.test.ts` — 折叠状态传播测试
- `packages/tui/tests/chat-log.test.ts` — 全局切换与新消息继承测试
- `packages/tui/tests/app.test.ts` — `ctrl+o` 快捷键处理测试

---

## Task 1: `ReasoningBlock` 支持折叠渲染

**Files:**
- Modify: `packages/tui/src/message/reasoning-block.ts`
- Create: `packages/tui/tests/reasoning-block.test.ts`

- [ ] **Step 1: 编写失败测试**

创建 `packages/tui/tests/reasoning-block.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { ReasoningBlock } from "../src/message/reasoning-block.js";

describe("ReasoningBlock", () => {
  it("renders only label when collapsed by default", () => {
    const block = new ReasoningBlock();
    const lines = block.render(80);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("thinking");
    expect(lines[0]).toContain(">");
  });

  it("renders full content when expanded", () => {
    const block = new ReasoningBlock();
    block.appendText("first line\nsecond line");
    block.setCollapsed(false);
    const lines = block.render(80);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.some((line) => line.includes("first line"))).toBe(true);
    expect(lines.some((line) => line.includes("second line"))).toBe(true);
  });

  it("updates label after finish", () => {
    const block = new ReasoningBlock();
    block.finish();
    const lines = block.render(80);
    expect(lines[0]).toMatch(/think for [\d.]+s/);
    expect(lines[0]).toContain(">");
  });

  it("continues collecting text while collapsed", () => {
    const block = new ReasoningBlock();
    block.appendText("hidden content");
    expect(block.render(80).some((line) => line.includes("hidden content"))).toBe(false);

    block.setCollapsed(false);
    expect(block.render(80).some((line) => line.includes("hidden content"))).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter rem-agent-tui test -- reasoning-block.test.ts`

Expected: FAIL — `setCollapsed` 不存在或折叠未生效

- [ ] **Step 3: 实现折叠能力**

将 `packages/tui/src/message/reasoning-block.ts` 替换为：

```ts
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { dim } from "../colors.js";
import { markdownTheme, thinkingMessageStyle } from "../theme.js";

export class ReasoningBlock extends Container {
  private label: Text;
  private body: Markdown;
  private text = "";
  private startTime: number;
  private collapsed: boolean;
  private finished = false;
  private durationS?: string;

  constructor(collapsed = true) {
    super();
    this.collapsed = collapsed;
    this.startTime = Date.now();
    this.label = new Text("thinking >", 0, 0, dim);
    this.body = new Markdown("", 0, 0, markdownTheme, thinkingMessageStyle);

    this.addChild(this.label);
    this.addChild(new Spacer(1));
    this.addChild(this.body);
  }

  appendText(text: string): void {
    this.text += text;
    this.body.setText(this.text);
  }

  finish(): void {
    this.finished = true;
    const durationMs = Date.now() - this.startTime;
    this.durationS = (durationMs / 1000).toFixed(1);
    this.updateLabel();
  }

  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.updateLabel();
  }

  isCollapsed(): boolean {
    return this.collapsed;
  }

  render(width: number): string[] {
    if (this.collapsed) {
      return this.label.render(width);
    }
    return super.render(width);
  }

  private updateLabel(): void {
    if (this.finished && this.durationS) {
      this.label.setText(`think for ${this.durationS}s >`);
    } else {
      this.label.setText("thinking >");
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter rem-agent-tui test -- reasoning-block.test.ts`

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/tui/src/message/reasoning-block.ts packages/tui/tests/reasoning-block.test.ts
git commit -m "feat(tui): make ReasoningBlock collapsible

Add collapsed state, setCollapsed/isCollapsed, and override render
so folded reasoning shows only the label line.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `StreamAssistantMessage` 传播折叠状态

**Files:**
- Modify: `packages/tui/src/message/stream-message.ts`
- Modify: `packages/tui/tests/stream-message.test.ts`

- [ ] **Step 1: 编写失败测试**

在 `packages/tui/tests/stream-message.test.ts` 中新增两个测试：

```ts
it("creates reasoning block collapsed by default", () => {
  const message = new StreamAssistantMessage();
  message.appendChunk({ type: "reasoning-start", step: 1, partId: "r1" } as AgentStreamChunk);
  message.appendChunk({ type: "reasoning-delta", step: 1, partId: "r1", text: "thinking content" } as AgentStreamChunk);
  message.appendChunk({ type: "reasoning-finish", step: 1, partId: "r1" } as AgentStreamChunk);

  const lines = message.render(80);
  expect(lines.filter((line) => line.includes("thinking content")).length).toBe(0);
});

it("expands all reasoning blocks via setThinkingCollapsed(false)", () => {
  const message = new StreamAssistantMessage();
  message.appendChunk({ type: "reasoning-start", step: 1, partId: "r1" } as AgentStreamChunk);
  message.appendChunk({ type: "reasoning-delta", step: 1, partId: "r1", text: "first reasoning" } as AgentStreamChunk);
  message.appendChunk({ type: "reasoning-finish", step: 1, partId: "r1" } as AgentStreamChunk);
  message.appendChunk({ type: "reasoning-start", step: 1, partId: "r2" } as AgentStreamChunk);
  message.appendChunk({ type: "reasoning-delta", step: 1, partId: "r2", text: "second reasoning" } as AgentStreamChunk);

  message.setThinkingCollapsed(false);
  const lines = message.render(80);
  expect(lines.some((line) => line.includes("first reasoning"))).toBe(true);
  expect(lines.some((line) => line.includes("second reasoning"))).toBe(true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter rem-agent-tui test -- stream-message.test.ts`

Expected: FAIL — `StreamAssistantMessage` 没有 `setThinkingCollapsed`

- [ ] **Step 3: 实现传播能力**

修改 `packages/tui/src/message/stream-message.ts`：

```ts
export class StreamAssistantMessage extends Container {
  private parts = new Map<string, Part>();
  private thinkingCollapsed: boolean;

  constructor(thinkingCollapsed = true) {
    super();
    this.thinkingCollapsed = thinkingCollapsed;
    this.addChild(new Spacer(1));
  }

  // ... appendChunk, setText remain unchanged ...

  setThinkingCollapsed(collapsed: boolean): void {
    this.thinkingCollapsed = collapsed;
    for (const part of this.parts.values()) {
      if (part.type === "reasoning") {
        part.component.setCollapsed(collapsed);
      }
    }
  }

  // ...

  private ensureReasoningPart(partId: string): void {
    if (this.parts.has(partId)) return;
    const component = new ReasoningBlock(this.thinkingCollapsed);
    this.parts.set(partId, { type: "reasoning", partId, component });
    this.addChild(component);
  }
}
```

完整文件应保留原有方法（`appendChunk`、`setText`、`ensureTextPart`、`appendTextDelta`、`appendReasoningDelta`、`finishReasoning`、`updateToolCall`、`updateToolResult`），仅修改 constructor、新增 `setThinkingCollapsed`、并在 `ensureReasoningPart` 中传入 `this.thinkingCollapsed`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter rem-agent-tui test -- stream-message.test.ts`

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/tui/src/message/stream-message.ts packages/tui/tests/stream-message.test.ts
git commit -m "feat(tui): propagate thinking collapsed state through StreamAssistantMessage

Constructor accepts thinkingCollapsed, forwards it to new ReasoningBlocks,
and exposes setThinkingCollapsed to update existing reasoning parts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `ChatLog` 持有全局折叠状态

**Files:**
- Modify: `packages/tui/src/chat-log.ts`
- Modify: `packages/tui/tests/chat-log.test.ts`

- [ ] **Step 1: 编写失败测试**

在 `packages/tui/tests/chat-log.test.ts` 中新增测试（保留原有 prune 测试）：

```ts
import type { AgentStreamChunk } from "rem-agent-core";

// ... existing tests ...

it("toggles thinking collapsed state for all stream messages", () => {
  const chatLog = new ChatLog();
  const message = chatLog.startAssistant();
  message.appendChunk({ type: "reasoning-start", step: 1, partId: "r1" } as AgentStreamChunk);
  message.appendChunk({ type: "reasoning-delta", step: 1, partId: "r1", text: "thinking content" } as AgentStreamChunk);

  chatLog.toggleThinkingCollapsed(); // true -> false, expand
  const expandedLines = message.render(80);
  expect(expandedLines.some((line) => line.includes("thinking content"))).toBe(true);

  chatLog.toggleThinkingCollapsed(); // false -> true, collapse
  const collapsedLines = message.render(80);
  expect(collapsedLines.filter((line) => line.includes("thinking content")).length).toBe(0);
});

it("new stream messages inherit current thinking collapsed state", () => {
  const chatLog = new ChatLog();
  chatLog.toggleThinkingCollapsed(); // expand first

  const message = chatLog.startAssistant();
  message.appendChunk({ type: "reasoning-start", step: 1, partId: "r1" } as AgentStreamChunk);
  message.appendChunk({ type: "reasoning-delta", step: 1, partId: "r1", text: "thinking content" } as AgentStreamChunk);

  const lines = message.render(80);
  expect(lines.some((line) => line.includes("thinking content"))).toBe(true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter rem-agent-tui test -- chat-log.test.ts`

Expected: FAIL — `ChatLog` 没有 `toggleThinkingCollapsed`

- [ ] **Step 3: 实现全局切换**

修改 `packages/tui/src/chat-log.ts`：

```ts
import { Container } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { UserMessage } from "./message/user-message.js";
import { AssistantMessage } from "./message/assistant-message.js";
import { StreamAssistantMessage } from "./message/stream-message.js";

export class ChatLog extends Container {
  private maxMessages: number;
  private thinkingCollapsed: boolean;

  constructor(maxMessages = 100) {
    super();
    this.maxMessages = maxMessages;
    this.thinkingCollapsed = true;
  }

  addUser(text: string): void {
    this.append(new UserMessage(text));
  }

  addAssistant(text: string): void {
    this.append(new AssistantMessage(text));
  }

  startAssistant(): StreamAssistantMessage {
    const message = new StreamAssistantMessage(this.thinkingCollapsed);
    this.append(message);
    return message;
  }

  toggleThinkingCollapsed(): void {
    this.thinkingCollapsed = !this.thinkingCollapsed;
    for (const child of this.children) {
      if (child instanceof StreamAssistantMessage) {
        child.setThinkingCollapsed(this.thinkingCollapsed);
      }
    }
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

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter rem-agent-tui test -- chat-log.test.ts`

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/tui/src/chat-log.ts packages/tui/tests/chat-log.test.ts
git commit -m "feat(tui): ChatLog owns global thinking collapsed state

Default collapsed, expose toggleThinkingCollapsed, and propagate state
to all existing and newly created StreamAssistantMessage instances.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `TUIApp` 绑定 `ctrl+o` 快捷键

**Files:**
- Modify: `packages/tui/src/app.ts`
- Create: `packages/tui/tests/app.test.ts`

- [ ] **Step 1: 编写失败测试**

创建 `packages/tui/tests/app.test.ts`：

```ts
import { describe, it, expect, vi } from "vitest";
import type { UIAgentSession } from "rem-agent-core";
import { TUIApp } from "../src/app.js";

function createMockSession(): UIAgentSession {
  return {
    setCallbacks: vi.fn(),
    status: "idle",
    currentTurn: 0,
    maxTurns: 10,
    submit: vi.fn(),
    interrupt: vi.fn(),
    reset: vi.fn().mockResolvedValue(undefined),
  } as unknown as UIAgentSession;
}

describe("TUIApp", () => {
  it("ctrl+o toggles thinking collapsed state and requests render", () => {
    const app = new TUIApp({ session: createMockSession() });
    const chatLog = (app as any).chatLog;
    const tui = (app as any).tui;

    const toggleSpy = vi.spyOn(chatLog, "toggleThinkingCollapsed");
    const renderSpy = vi.spyOn(tui, "requestRender");

    const result = (app as any).handleGlobalInput("\x0f"); // ctrl+o raw byte

    expect(toggleSpy).toHaveBeenCalledTimes(1);
    expect(renderSpy).toHaveBeenCalledWith(true);
    expect(result).toEqual({ consume: true });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter rem-agent-tui test -- app.test.ts`

Expected: FAIL — `handleGlobalInput` 不存在或未处理 `ctrl+o`

- [ ] **Step 3: 实现快捷键绑定**

修改 `packages/tui/src/app.ts`：

```ts
import {
  Container,
  Input,
  ProcessTerminal,
  Spacer,
  TUI,
  Key,
  matchesKey,
} from "@earendil-works/pi-tui";
```

在 `TUIApp` 类中新增 `handleGlobalInput` 方法，并在 constructor 中注册：

```ts
constructor(options: TUIAppOptions) {
  // ... existing initialization ...

  this.tui = new TUI(new ProcessTerminal(), true);
  this.tui.addInputListener((data) => this.handleGlobalInput(data));
  this.tui.addChild(this.root);
}

private handleGlobalInput(data: string) {
  if (matchesKey(data, "ctrl+c")) {
    this.stop();
    process.exit(0);
    return { consume: true };
  }
  if (matchesKey(data, Key.ctrl("o"))) {
    this.chatLog.toggleThinkingCollapsed();
    this.tui.requestRender(true);
    return { consume: true };
  }
  return undefined;
}
```

注意：移除 constructor 中原有的匿名 `addInputListener` 代码块，改为调用 `this.handleGlobalInput`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter rem-agent-tui test -- app.test.ts`

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/tui/src/app.ts packages/tui/tests/app.test.ts
git commit -m "feat(tui): bind ctrl+o to toggle thinking collapsed state

Extract global input handling into handleGlobalInput and consume ctrl+o
by toggling ChatLog thinking collapse and requesting a render.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 全包验证

**Files:** 所有已修改的 tui 文件

- [ ] **Step 1: 运行 tui 包全部测试**

Run: `pnpm --filter rem-agent-tui test`

Expected: PASS

- [ ] **Step 2: 运行全仓类型检查**

Run: `pnpm typecheck`

Expected: PASS

- [ ] **Step 3: 手动运行 demo 验证**

Run: `pnpm --filter rem-agent-demo start`

Expected: 启动后发送一条消息触发 reasoning，确认默认只显示 `thinking >`；按 `ctrl+o` 展开显示完整 reasoning；再按 `ctrl+o` 收起。

- [ ] **Step 4: 提交（如需要补充变更）**

如果手动验证发现任何调整，单独提交。否则此步骤可跳过。

---

## Self-Review: 覆盖检查

对照设计文档 [`docs/superpowers/specs/2026-06-16-thinking-foldable-design.md`](docs/superpowers/specs/2026-06-16-thinking-foldable-design.md) 检查：

| 设计文档要求 | 对应任务 |
|---|---|
| 全局快捷键 `ctrl+o` | Task 4 |
| thinking 块默认折叠 | Task 1 constructor 默认参数 + Task 3 ChatLog 默认状态 |
| 折叠标签 `thinking >` / `think for Xs >` | Task 1 `updateLabel` |
| 折叠不影响 reasoning 数据收集 | Task 1 `appendText` 不受 `collapsed` 影响 |
| 新流式消息继承折叠状态 | Task 3 `startAssistant()` 传入 `thinkingCollapsed` |
| 多个 thinking 块同步 | Task 2 `setThinkingCollapsed` 遍历所有 reasoning part |
| 流式中切换折叠 | Task 1 `appendText` 继续追加 + `render` 按状态显示 |
| 无流式消息时按快捷键 no-op | Task 3 `toggleThinkingCollapsed` 遍历为空时自然 no-op |

**Placeholder scan:** 本计划所有步骤均包含完整代码、运行命令与期望输出，无 TBD/TODO/"稍后实现"。

**Type consistency:**
- `ReasoningBlock.setCollapsed(collapsed: boolean)` 在 Task 1 定义，Task 2 调用。
- `StreamAssistantMessage.setThinkingCollapsed(collapsed: boolean)` 在 Task 2 定义，Task 3 调用。
- `ChatLog.toggleThinkingCollapsed()` 在 Task 3 定义，Task 4 调用。
- `StreamAssistantMessage` constructor 签名 `constructor(thinkingCollapsed = true)` 在 Task 2 修改，Task 3 通过 `new StreamAssistantMessage(this.thinkingCollapsed)` 调用。
