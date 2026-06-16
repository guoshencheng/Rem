# TUI 与 UI-Agent 协议分层实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `packages/demo` 中的 TUI 沉淀为独立子包 `@agent-harness/tui`，并在 `@agent-harness/core` 内新增 UI 友好协议层 `core/src/ui/`，使 demo 只保留配置与启动胶水。

**Architecture:** 协议层以回调风格封装 `CoreAgent` 事件，暴露 `UIAgentSession` 接口；`tui` 包实现回调驱动 pi-tui 渲染；`demo` 通过 `createAgentFromEnv` + `createUIAgentSession` + `TUIApp` 启动。

**Tech Stack:** TypeScript, pnpm workspace, vitest, `@earendil-works/pi-tui`

---

## 文件结构

### 新建文件

- `packages/core/src/ui/types.ts` — 协议接口定义
- `packages/core/src/ui/session.ts` — `createUIAgentSession` 适配器
- `packages/core/src/ui/index.ts` — 协议层统一导出
- `packages/core/tests/ui/session.test.ts` — 协议层测试
- `packages/tui/package.json` — tui 包配置
- `packages/tui/tsconfig.json` — tui 包 tsconfig
- `packages/tui/src/colors.ts` — 从 demo 迁移
- `packages/tui/src/theme.ts` — 从 demo 迁移
- `packages/tui/src/app.ts` — TUIApp
- `packages/tui/src/chat-log.ts` — 从 demo 迁移
- `packages/tui/src/event-log.ts` — 从 demo 迁移
- `packages/tui/src/status-bar.ts` — 从 demo 迁移
- `packages/tui/src/message/user-message.ts` — 拆分自 demo message.ts
- `packages/tui/src/message/assistant-message.ts` — 拆分自 demo message.ts
- `packages/tui/src/message/stream-message.ts` — 拆分自 demo message.ts
- `packages/tui/src/message/reasoning-block.ts` — 新增
- `packages/tui/src/message/tool-call-block.ts` — 新增
- `packages/tui/src/message/tool-result-block.ts` — 新增
- `packages/tui/src/index.ts` — tui 包统一导出
- `packages/tui/tests/chat-log.test.ts` — ChatLog 测试
- `packages/tui/tests/stream-message.test.ts` — StreamAssistantMessage 测试

### 修改文件

- `packages/core/src/core-agent.ts` — 暴露 `maxTurns` 属性
- `packages/core/src/index.ts` — 导出 `ui/` 模块
- `packages/demo/src/main.ts` — 简化启动逻辑
- `packages/demo/package.json` — 替换依赖

### 删除文件

- `packages/demo/src/agent.ts`
- `packages/demo/src/colors.ts`
- `packages/demo/src/theme.ts`
- `packages/demo/src/tui/` 目录

---

## Task 1: CoreAgent 暴露 `maxTurns`

**Files:**
- Modify: `packages/core/src/core-agent.ts`
- Test: `packages/core/tests/core-agent.test.ts`

- [ ] **Step 1: 编写测试**

在 `packages/core/tests/core-agent.test.ts` 中新增测试：

```ts
describe('CoreAgent maxTurns', () => {
  it('exposes maxTurns from budget config', () => {
    const agent = new CoreAgent({
      name: 'TestAgent',
      budget: new IterationBudget({ maxTurns: 42 }),
    });
    expect(agent.maxTurns).toBe(42);
  });

  it('defaults maxTurns to 60 when no budget is provided', () => {
    const agent = new CoreAgent({ name: 'TestAgent' });
    expect(agent.maxTurns).toBe(60);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @agent-harness/core test -- core-agent.test.ts`

Expected: FAIL — `maxTurns` 不存在

- [ ] **Step 3: 实现 `maxTurns` 属性**

修改 `packages/core/src/core-agent.ts`：

```ts
export class CoreAgent {
  private config: CoreAgentConfig;
  // ... existing fields ...

  get maxTurns(): number {
    return this.state.budget.getStatus().turnsRemaining + this.state.budget.turnCount;
  }

  // ... rest of class ...
}
```

注意：这里从 `state.budget` 动态读取，因为 `reset()` 会重建 budget。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @agent-harness/core test -- core-agent.test.ts`

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/core-agent.ts packages/core/tests/core-agent.test.ts
git commit -m "feat(core): expose maxTurns on CoreAgent for UI protocol layer"
```

---

## Task 2: 协议层类型定义

**Files:**
- Create: `packages/core/src/ui/types.ts`
- Test: `packages/core/tests/ui/session.test.ts`

- [ ] **Step 1: 创建 `packages/core/src/ui/types.ts`**

```ts
import type { AgentStreamChunk, AgentStatus } from '../types.js';

export interface UISessionCallbacks {
  onStart?: () => void;
  onStop?: () => void;
  onError?: (error: Error) => void;

  onStatusChange?: (status: AgentStatus) => void;
  onTurnChange?: (currentTurn: number, maxTurns: number) => void;

  onUserMessage?: (text: string) => void;
  onStreamChunk?: (chunk: AgentStreamChunk) => void;
  onAssistantMessageFinalized?: (text: string) => void;
}

export interface UIAgentSession {
  readonly status: AgentStatus;
  readonly currentTurn: number;
  readonly maxTurns: number;

  setCallbacks(callbacks: UISessionCallbacks): void;
  submit(text: string): void;
  interrupt(): void;
  reset(): Promise<void>;
}
```

- [ ] **Step 2: 创建测试骨架**

创建 `packages/core/tests/ui/session.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest';
import { CoreAgent } from '../../src/core-agent.js';
import { createUIAgentSession } from '../../src/ui/session.js';
import { IterationBudget } from '../../src/budget.js';

describe('createUIAgentSession', () => {
  it('returns a UIAgentSession', () => {
    const agent = new CoreAgent({ name: 'Test', budget: new IterationBudget({ maxTurns: 10 }) });
    const session = createUIAgentSession(agent);
    expect(session.maxTurns).toBe(10);
    expect(typeof session.submit).toBe('function');
    expect(typeof session.interrupt).toBe('function');
    expect(typeof session.reset).toBe('function');
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm --filter @agent-harness/core test -- ui/session.test.ts`

Expected: FAIL — `session.ts` 不存在

- [ ] **Step 4: 提交类型定义与测试骨架**

```bash
git add packages/core/src/ui/types.ts packages/core/tests/ui/session.test.ts
git commit -m "feat(core): add UI protocol types and test skeleton"
```

---

## Task 3: 协议层适配器实现

**Files:**
- Create: `packages/core/src/ui/session.ts`
- Modify: `packages/core/tests/ui/session.test.ts`

- [ ] **Step 1: 实现 `createUIAgentSession`**

创建 `packages/core/src/ui/session.ts`：

```ts
import type { CoreAgent } from '../core-agent.js';
import type { AgentStatus, AgentStreamChunk } from '../types.js';
import type { UIAgentSession, UISessionCallbacks } from './types.js';

export function createUIAgentSession(
  agent: CoreAgent,
  initialCallbacks: UISessionCallbacks = {},
): UIAgentSession {
  let callbacks = initialCallbacks;
  let currentStatus: AgentStatus = agent.status;

  const updateStatus = (status: AgentStatus) => {
    currentStatus = status;
    callbacks.onStatusChange?.(status);
  };

  agent.on('core-agent:start', () => {
    callbacks.onStart?.();
    updateStatus('running');
  });

  agent.on('core-agent:stop', () => {
    callbacks.onStop?.();
    updateStatus('idle');
  });

  agent.on('core-agent:error', () => {
    updateStatus('error');
    callbacks.onError?.(new Error('Agent error'));
  });

  agent.on('turn:before', (ctx) => {
    const turnNumber = ctx.state.currentTurn;
    const maxTurns = agent.maxTurns;
    callbacks.onTurnChange?.(turnNumber, maxTurns);
  });

  return {
    get status() {
      return currentStatus;
    },
    get currentTurn() {
      return agent.conversation.filter((m) => m.role === 'user').length;
    },
    get maxTurns() {
      return agent.maxTurns;
    },

    setCallbacks(newCallbacks: UISessionCallbacks) {
      callbacks = newCallbacks;
    },

    submit(text: string) {
      callbacks.onUserMessage?.(text);

      const result = agent.run({ content: text });

      (async () => {
        try {
          for await (const chunk of result.stream.fullStream) {
            callbacks.onStreamChunk?.(chunk);
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          callbacks.onError?.(err);
        }
      })();

      result.stream.text
        .then((finalText) => {
          callbacks.onAssistantMessageFinalized?.(finalText);
        })
        .catch((error) => {
          const err = error instanceof Error ? error : new Error(String(error));
          callbacks.onError?.(err);
        });

      result.output.catch((error) => {
        const err = error instanceof Error ? error : new Error(String(error));
        callbacks.onError?.(err);
      });
    },

    interrupt() {
      agent.interrupt();
    },

    async reset() {
      await agent.reset();
      currentStatus = agent.status;
    },
  };
}
```

- [ ] **Step 2: 补充测试**

在 `packages/core/tests/ui/session.test.ts` 中继续添加：

```ts
describe('UISessionCallbacks', () => {
  it('calls onStart and onStatusChange when agent starts', async () => {
    const agent = new CoreAgent({ name: 'Test', budget: new IterationBudget({ maxTurns: 10 }) });
    await agent.initialize();

    const onStart = vi.fn();
    const onStatusChange = vi.fn();
    const session = createUIAgentSession(agent);
    session.setCallbacks({ onStart, onStatusChange });

    // Trigger a run that completes immediately due to budget
    session.submit('hi');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(onStart).toHaveBeenCalled();
    expect(onStatusChange).toHaveBeenCalledWith('running');
  });

  it('calls interrupt on the agent', () => {
    const agent = new CoreAgent({ name: 'Test', budget: new IterationBudget({ maxTurns: 10 }) });
    const interruptSpy = vi.spyOn(agent, 'interrupt');
    const session = createUIAgentSession(agent);
    session.interrupt();
    expect(interruptSpy).toHaveBeenCalled();
  });
});
```

注意：由于 `agent.run()` 会实际调用 LLM，测试中需要让它因预算立即结束。当前 `CoreAgent.run()` 在预算不足时会直接返回，这可以用一个 `maxTurns: 0` 的 budget 触发。

调整测试：

```ts
it('calls onStart and onStatusChange when agent starts', async () => {
  const agent = new CoreAgent({ name: 'Test', budget: new IterationBudget({ maxTurns: 0 }) });
  await agent.initialize();

  const onStart = vi.fn();
  const onStatusChange = vi.fn();
  const session = createUIAgentSession(agent);
  session.setCallbacks({ onStart, onStatusChange });

  session.submit('hi');
  await new Promise((resolve) => setTimeout(resolve, 10));

  expect(onStart).toHaveBeenCalled();
  expect(onStatusChange).toHaveBeenCalledWith('running');
});
```

- [ ] **Step 3: 运行测试**

Run: `pnpm --filter @agent-harness/core test -- ui/session.test.ts`

Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/ui/session.ts packages/core/tests/ui/session.test.ts
git commit -m "feat(core): implement createUIAgentSession adapter"
```

---

## Task 4: 协议层导出

**Files:**
- Create: `packages/core/src/ui/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 创建 `packages/core/src/ui/index.ts`**

```ts
export * from './types.js';
export * from './session.js';
```

- [ ] **Step 2: 在 `core/src/index.ts` 中导出 ui 模块**

修改 `packages/core/src/index.ts`，在末尾添加：

```ts
export * from './ui/index.js';
```

- [ ] **Step 3: 运行类型检查**

Run: `pnpm --filter @agent-harness/core typecheck`

Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/ui/index.ts packages/core/src/index.ts
git commit -m "feat(core): export ui protocol layer from core index"
```

---

## Task 5: 创建 `tui` 包结构

**Files:**
- Create: `packages/tui/package.json`
- Create: `packages/tui/tsconfig.json`

- [ ] **Step 1: 创建 `packages/tui/package.json`**

```json
{
  "name": "@agent-harness/tui",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@agent-harness/core": "workspace:*",
    "@earendil-works/pi-tui": "^0.79.3"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: 创建 `packages/tui/tsconfig.json`**

参考 `packages/demo/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: 安装依赖**

Run: `pnpm install`

Expected: 成功安装 `@agent-harness/tui` 的依赖

- [ ] **Step 4: 提交**

```bash
git add packages/tui/package.json packages/tui/tsconfig.json pnpm-lock.yaml
if git -C /Users/guoshencheng/Documents/work/rem diff --cached --quiet; then
  echo "No changes to commit"
else
  git commit -m "chore(tui): create @agent-harness/tui package"
fi
```

---

## Task 6: 迁移 colors 与 theme

**Files:**
- Create: `packages/tui/src/colors.ts`
- Create: `packages/tui/src/theme.ts`
- Delete: `packages/demo/src/colors.ts`
- Delete: `packages/demo/src/theme.ts`

- [ ] **Step 1: 迁移文件**

将 `packages/demo/src/colors.ts` 内容复制到 `packages/tui/src/colors.ts`。
将 `packages/demo/src/theme.ts` 内容复制到 `packages/tui/src/theme.ts`，并将内部导入 `./colors.js` 改为 `./colors.js`（相对路径不变，因为仍在同目录）。

- [ ] **Step 2: 删除 demo 中的文件**

```bash
rm packages/demo/src/colors.ts packages/demo/src/theme.ts
```

- [ ] **Step 3: 提交**

```bash
git add packages/tui/src/colors.ts packages/tui/src/theme.ts packages/demo/src/colors.ts packages/demo/src/theme.ts
git commit -m "chore(tui): migrate colors and theme to tui package"
```

---

## Task 7: 拆分并迁移消息组件

**Files:**
- Create: `packages/tui/src/message/user-message.ts`
- Create: `packages/tui/src/message/assistant-message.ts`
- Create: `packages/tui/src/message/stream-message.ts`
- Create: `packages/tui/src/message/reasoning-block.ts`
- Create: `packages/tui/src/message/tool-call-block.ts`
- Create: `packages/tui/src/message/tool-result-block.ts`
- Delete: `packages/demo/src/tui/message.ts`

- [ ] **Step 1: 创建 `user-message.ts`**

```ts
import { Container, Markdown, Spacer } from "@earendil-works/pi-tui";
import { markdownTheme, userMessageStyle } from "../theme.js";

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
```

- [ ] **Step 2: 创建 `assistant-message.ts`**

```ts
import { Container, Markdown, Spacer } from "@earendil-works/pi-tui";
import { markdownTheme, assistantMessageStyle } from "../theme.js";

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

- [ ] **Step 3: 创建 `reasoning-block.ts`**

```ts
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { dim } from "../colors.js";
import { markdownTheme, thinkingMessageStyle } from "../theme.js";

export class ReasoningBlock extends Container {
  private label: Text;
  private body: Markdown;
  private startTime: number;

  constructor() {
    super();
    this.startTime = Date.now();
    this.label = new Text("thinking", 0, 0, dim);
    this.body = new Markdown("", 0, 0, markdownTheme, thinkingMessageStyle);

    this.addChild(this.label);
    this.addChild(new Spacer(1));
    this.addChild(this.body);
  }

  appendText(text: string): void {
    this.body.setText(this.body.getText() + text);
  }

  finish(): void {
    const durationMs = Date.now() - this.startTime;
    const durationS = (durationMs / 1000).toFixed(1);
    this.label.setText(`think for ${durationS}s`);
  }
}
```

注意：`Markdown` 是否有 `getText()` 方法需要确认。如果 pi-tui 的 Markdown 不暴露 getText，需要内部维护一个 text 字段。

调整为内部维护 text：

```ts
export class ReasoningBlock extends Container {
  private label: Text;
  private body: Markdown;
  private text = "";
  private startTime: number;

  constructor() {
    super();
    this.startTime = Date.now();
    this.label = new Text("thinking", 0, 0, dim);
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
    const durationMs = Date.now() - this.startTime;
    const durationS = (durationMs / 1000).toFixed(1);
    this.label.setText(`think for ${durationS}s`);
  }
}
```

- [ ] **Step 4: 创建 `tool-call-block.ts`**

```ts
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { markdownTheme, assistantMessageStyle } from "../theme.js";

export class ToolCallBlock extends Container {
  private body: Markdown;

  constructor(toolName: string, input: unknown) {
    super();
    const text = `${toolName}(${JSON.stringify(input)})`;
    this.body = new Markdown(text, 0, 0, markdownTheme, assistantMessageStyle);
    this.addChild(new Text("tool call", 0, 0));
    this.addChild(new Spacer(1));
    this.addChild(this.body);
  }

  update(toolName: string, input: unknown): void {
    const text = `${toolName}(${JSON.stringify(input)})`;
    this.body.setText(text);
  }
}
```

- [ ] **Step 5: 创建 `tool-result-block.ts`**

```ts
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { markdownTheme, assistantMessageStyle } from "../theme.js";

export class ToolResultBlock extends Container {
  private body: Markdown;

  constructor(output: string, error?: string) {
    super();
    const text = error ? `error: ${error}` : `result: ${output}`;
    this.body = new Markdown(text, 0, 0, markdownTheme, assistantMessageStyle);
    this.addChild(new Text("tool result", 0, 0));
    this.addChild(new Spacer(1));
    this.addChild(this.body);
  }

  update(output: string, error?: string): void {
    const text = error ? `error: ${error}` : `result: ${output}`;
    this.body.setText(text);
  }
}
```

- [ ] **Step 6: 创建 `stream-message.ts`**

```ts
import { Container, Spacer } from "@earendil-works/pi-tui";
import type { AgentStreamChunk } from "@agent-harness/core";
import { AssistantMessage } from "./assistant-message.js";
import { ReasoningBlock } from "./reasoning-block.js";
import { ToolCallBlock } from "./tool-call-block.js";
import { ToolResultBlock } from "./tool-result-block.js";

type Part =
  | { type: "text"; partId: string; component: AssistantMessage }
  | { type: "reasoning"; partId: string; component: ReasoningBlock }
  | { type: "tool-call"; partId: string; component: ToolCallBlock }
  | { type: "tool-result"; partId: string; component: ToolResultBlock };

export class StreamAssistantMessage extends Container {
  private parts = new Map<string, Part>();

  constructor() {
    super();
    this.addChild(new Spacer(1));
  }

  appendChunk(chunk: AgentStreamChunk): void {
    if (chunk.type === "text-start") {
      this.ensureTextPart(chunk.partId);
    } else if (chunk.type === "text-delta") {
      this.appendTextDelta(chunk.partId, chunk.text);
    } else if (chunk.type === "reasoning-start") {
      this.ensureReasoningPart(chunk.partId);
    } else if (chunk.type === "reasoning-delta") {
      this.appendReasoningDelta(chunk.partId, chunk.text);
    } else if (chunk.type === "reasoning-finish") {
      this.finishReasoning(chunk.partId);
    } else if (chunk.type === "tool-call") {
      this.updateToolCall(chunk.partId, chunk.toolName, chunk.input);
    } else if (chunk.type === "tool-result") {
      this.updateToolResult(chunk.partId, chunk.output, chunk.error);
    }
  }

  setText(text: string): void {
    this.parts.clear();
    this.clear();
    this.addChild(new Spacer(1));
    const component = new AssistantMessage(text);
    this.parts.set("static", { type: "text", partId: "static", component });
    this.addChild(component);
  }

  private ensureTextPart(partId: string): void {
    if (this.parts.has(partId)) return;
    const component = new AssistantMessage("");
    this.parts.set(partId, { type: "text", partId, component });
    this.addChild(component);
  }

  private appendTextDelta(partId: string, text: string): void {
    this.ensureTextPart(partId);
    const part = this.parts.get(partId);
    if (!part || part.type !== "text") return;
    const current = part.component.getText?.() ?? "";
    part.component.setText(current + text);
  }

  private ensureReasoningPart(partId: string): void {
    if (this.parts.has(partId)) return;
    const component = new ReasoningBlock();
    this.parts.set(partId, { type: "reasoning", partId, component });
    this.addChild(component);
  }

  private appendReasoningDelta(partId: string, text: string): void {
    this.ensureReasoningPart(partId);
    const part = this.parts.get(partId);
    if (!part || part.type !== "reasoning") return;
    part.component.appendText(text);
  }

  private finishReasoning(partId: string): void {
    const part = this.parts.get(partId);
    if (!part || part.type !== "reasoning") return;
    part.component.finish();
  }

  private updateToolCall(partId: string, toolName: string, input: unknown): void {
    const existing = this.parts.get(partId);
    if (existing && existing.type === "tool-call") {
      existing.component.update(toolName, input);
      return;
    }
    const component = new ToolCallBlock(toolName, input);
    this.parts.set(partId, { type: "tool-call", partId, component });
    this.addChild(component);
  }

  private updateToolResult(partId: string, output: string, error?: string): void {
    const existing = this.parts.get(partId);
    if (existing && existing.type === "tool-result") {
      existing.component.update(output, error);
      return;
    }
    const component = new ToolResultBlock(output, error);
    this.parts.set(partId, { type: "tool-result", partId, component });
    this.addChild(component);
  }
}
```

注意：`AssistantMessage.getText()` 可能不存在，需要给 `AssistantMessage` 添加 `getText()` 方法。

修改 `assistant-message.ts`：

```ts
export class AssistantMessage extends Container {
  private body: Markdown;

  constructor(text: string) {
    super();
    this.body = new Markdown(text, 0, 0, markdownTheme, assistantMessageStyle);
    this.addChild(new Spacer(1));
    this.addChild(this.body);
  }

  getText(): string {
    return this.body.getText?.() ?? "";
  }

  setText(text: string): void {
    this.body.setText(text);
  }
}
```

如果 `Markdown` 没有 `getText()`，则内部维护 text 字段：

```ts
export class AssistantMessage extends Container {
  private body: Markdown;
  private text = "";

  constructor(text: string) {
    super();
    this.text = text;
    this.body = new Markdown(text, 0, 0, markdownTheme, assistantMessageStyle);
    this.addChild(new Spacer(1));
    this.addChild(this.body);
  }

  getText(): string {
    return this.text;
  }

  setText(text: string): void {
    this.text = text;
    this.body.setText(text);
  }
}
```

- [ ] **Step 7: 删除旧文件**

```bash
rm packages/demo/src/tui/message.ts
```

- [ ] **Step 8: 运行 tui 类型检查**

Run: `pnpm --filter @agent-harness/tui typecheck`

Expected: PASS

- [ ] **Step 9: 提交**

```bash
git add packages/tui/src/message/ packages/demo/src/tui/message.ts
if [ -f packages/demo/src/tui/message.ts ]; then git add packages/demo/src/tui/message.ts; fi
git commit -m "feat(tui): split and migrate message components"
```

---

## Task 8: 迁移 ChatLog、EventLog、StatusBar

**Files:**
- Create: `packages/tui/src/chat-log.ts`
- Create: `packages/tui/src/event-log.ts`
- Create: `packages/tui/src/status-bar.ts`
- Delete: `packages/demo/src/tui/chat-log.ts`
- Delete: `packages/demo/src/tui/event-log.ts`
- Delete: `packages/demo/src/tui/status-bar.ts`

- [ ] **Step 1: 迁移 `chat-log.ts`**

```ts
import { Container } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { UserMessage } from "./message/user-message.js";
import { AssistantMessage } from "./message/assistant-message.js";
import { StreamAssistantMessage } from "./message/stream-message.js";

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

  startAssistant(): StreamAssistantMessage {
    const message = new StreamAssistantMessage();
    this.append(message);
    return message;
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

- [ ] **Step 2: 迁移 `event-log.ts`**

与 demo 中基本一致，只是导入路径调整为 `../colors.js`。

```ts
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { dim } from "./colors.js";

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

- [ ] **Step 3: 迁移 `status-bar.ts`**

```ts
import { Text } from "@earendil-works/pi-tui";
import { bold, dim, red } from "./colors.js";

export class StatusBar extends Text {
  constructor(maxTurns: number) {
    super("", 1, 0);
    this.update(0, maxTurns, "idle");
  }

  update(currentTurn: number, maxTurns: number, status: string): void {
    const statusColor = status === "running" ? bold : status === "error" ? red : dim;
    const text = `Core Demo  |  turn: ${currentTurn}/${maxTurns}  |  status: ${statusColor(status)}`;
    this.setText(text);
  }
}
```

- [ ] **Step 4: 删除 demo 中的旧文件**

```bash
rm packages/demo/src/tui/chat-log.ts packages/demo/src/tui/event-log.ts packages/demo/src/tui/status-bar.ts
```

- [ ] **Step 5: 提交**

```bash
git add packages/tui/src/chat-log.ts packages/tui/src/event-log.ts packages/tui/src/status-bar.ts packages/demo/src/tui/
git commit -m "feat(tui): migrate chat-log, event-log, and status-bar"
```

---

## Task 9: 实现 TUIApp

**Files:**
- Create: `packages/tui/src/app.ts`
- Delete: `packages/demo/src/tui/app.ts`

- [ ] **Step 1: 创建 `packages/tui/src/app.ts`**

```ts
import {
  Container,
  Input,
  ProcessTerminal,
  Spacer,
  TUI,
  matchesKey,
} from "@earendil-works/pi-tui";
import type {
  AgentStreamChunk,
  UIAgentSession,
  UISessionCallbacks,
} from "@agent-harness/core";
import { ChatLog } from "./chat-log.js";
import { EventLog } from "./event-log.js";
import { StatusBar } from "./status-bar.js";
import { StreamAssistantMessage } from "./message/stream-message.js";

export interface TUIAppOptions {
  session: UIAgentSession;
}

export class TUIApp implements UISessionCallbacks {
  private tui: TUI;
  private chatLog: ChatLog;
  private eventLog: EventLog;
  private statusBar: StatusBar;
  private input: Input;
  private root: Container;
  private session: UIAgentSession;
  private currentStreamMessage?: StreamAssistantMessage;

  constructor(options: TUIAppOptions) {
    this.session = options.session;
    this.session.setCallbacks(this);

    this.chatLog = new ChatLog();
    this.eventLog = new EventLog();
    this.statusBar = new StatusBar(options.session.maxTurns);
    this.input = new Input();

    this.input.onSubmit = (value: string) => {
      if (value.trim()) {
        this.session.submit(value);
      }
    };

    this.input.onEscape = () => {
      this.session.interrupt();
    };

    this.root = new Container();
    this.root.addChild(this.chatLog);
    this.root.addChild(this.eventLog);
    this.root.addChild(new Spacer(1));
    this.root.addChild(this.statusBar);
    this.root.addChild(this.input);

    this.tui = new TUI(new ProcessTerminal(), true);
    this.tui.addInputListener((data) => {
      if (matchesKey(data, "ctrl+c")) {
        this.stop();
        process.exit(0);
        return { consume: true };
      }
      return undefined;
    });
    this.tui.addChild(this.root);
  }

  start(): void {
    this.tui.start();
    this.tui.setFocus(this.input);
  }

  stop(): void {
    this.tui.stop();
  }

  // UISessionCallbacks
  onStart = () => {
    this.eventLog.addEvent("core-agent:start");
  };

  onStop = () => {
    this.eventLog.addEvent("core-agent:stop");
  };

  onError = (error: Error) => {
    this.eventLog.addEvent("core-agent:error", error.message);
    this.chatLog.addAssistant(`Error: ${error.message}`);
    this.tui.requestRender(true);
  };

  onStatusChange = (status: AgentStatus) => {
    const currentTurn = this.session.currentTurn;
    this.statusBar.update(currentTurn, this.session.maxTurns, status);
    this.tui.requestRender(true);
  };

  onTurnChange = (currentTurn: number, maxTurns: number) => {
    this.statusBar.update(currentTurn, maxTurns, "running");
    this.eventLog.addEvent("turn:before", `turn #${currentTurn}`);
    this.tui.requestRender(true);
  };

  onUserMessage = (text: string) => {
    this.chatLog.addUser(text);
    this.input.setValue("");
    this.tui.requestRender(true);
  };

  onStreamChunk = (chunk: AgentStreamChunk) => {
    if (!this.currentStreamMessage) {
      this.currentStreamMessage = this.chatLog.startAssistant();
    }
    this.currentStreamMessage.appendChunk(chunk);

    if (chunk.type === "finish" || chunk.type === "error") {
      this.currentStreamMessage = undefined;
    }

    this.tui.requestRender(true);
  };

  onAssistantMessageFinalized = (_text: string) => {
    this.currentStreamMessage = undefined;
    this.tui.requestRender(true);
  };
}
```

- [ ] **Step 2: 删除 demo 中的旧 app.ts**

```bash
rm packages/demo/src/tui/app.ts
```

- [ ] **Step 3: 运行 tui 类型检查**

Run: `pnpm --filter @agent-harness/tui typecheck`

Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add packages/tui/src/app.ts packages/demo/src/tui/app.ts
git commit -m "feat(tui): implement TUIApp with UISessionCallbacks"
```

---

## Task 10: tui 包导出与空目录清理

**Files:**
- Create: `packages/tui/src/index.ts`
- Delete: `packages/demo/src/tui/` 空目录

- [ ] **Step 1: 创建 `packages/tui/src/index.ts`**

```ts
export { TUIApp } from "./app.js";
export { ChatLog } from "./chat-log.js";
export { EventLog } from "./event-log.js";
export { StatusBar } from "./status-bar.js";
export { UserMessage } from "./message/user-message.js";
export { AssistantMessage } from "./message/assistant-message.js";
export { StreamAssistantMessage } from "./message/stream-message.js";
```

- [ ] **Step 2: 删除 demo/src/tui 空目录**

```bash
rmdir packages/demo/src/tui 2>/dev/null || true
```

- [ ] **Step 3: 提交**

```bash
git add packages/tui/src/index.ts packages/demo/src/tui
git commit -m "feat(tui): export public API and clean up demo tui directory"
```

---

## Task 11: TUI 组件测试

**Files:**
- Create: `packages/tui/tests/chat-log.test.ts`
- Create: `packages/tui/tests/stream-message.test.ts`

- [ ] **Step 1: 创建 `chat-log.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { ChatLog } from "../src/chat-log.js";

describe("ChatLog", () => {
  it("prunes old messages when exceeding maxMessages", () => {
    const chatLog = new ChatLog(3);
    chatLog.addUser("msg 1");
    chatLog.addUser("msg 2");
    chatLog.addUser("msg 3");
    chatLog.addUser("msg 4");

    expect(chatLog.children.length).toBe(3);
  });
});
```

- [ ] **Step 2: 创建 `stream-message.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { StreamAssistantMessage } from "../src/message/stream-message.js";
import type { AgentStreamChunk } from "@agent-harness/core";

describe("StreamAssistantMessage", () => {
  it("appends text deltas", () => {
    const message = new StreamAssistantMessage();
    message.appendChunk({ type: "text-start", step: 1, partId: "p1" });
    message.appendChunk({ type: "text-delta", step: 1, partId: "p1", text: "hello" });
    message.appendChunk({ type: "text-delta", step: 1, partId: "p1", text: " world" });

    expect(message.children.length).toBeGreaterThan(0);
  });

  it("appends reasoning block", () => {
    const message = new StreamAssistantMessage();
    message.appendChunk({ type: "reasoning-start", step: 1, partId: "r1" });
    message.appendChunk({ type: "reasoning-delta", step: 1, partId: "r1", text: "thinking" });
    message.appendChunk({ type: "reasoning-finish", step: 1, partId: "r1" });

    expect(message.children.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: 运行 tui 测试**

Run: `pnpm --filter @agent-harness/tui test`

Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add packages/tui/tests/
git commit -m "test(tui): add ChatLog and StreamAssistantMessage tests"
```

---

## Task 12: 简化 demo 包

**Files:**
- Modify: `packages/demo/src/main.ts`
- Delete: `packages/demo/src/agent.ts`

- [ ] **Step 1: 重写 `packages/demo/src/main.ts`**

```ts
import "dotenv/config";

import { createAgentFromEnv, createUIAgentSession } from "@agent-harness/core";
import { TUIApp } from "@agent-harness/tui";
import { resolveConfig } from "./config.js";

async function main(): Promise<void> {
  const config = resolveConfig();

  const agent = createAgentFromEnv({
    name: config.agentName,
    maxTurns: config.maxTurns,
  });

  await agent.initialize();

  const session = createUIAgentSession(agent);
  const app = new TUIApp({ session });

  app.start();

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

- [ ] **Step 2: 删除 `packages/demo/src/agent.ts`**

```bash
rm packages/demo/src/agent.ts
```

- [ ] **Step 3: 提交**

```bash
git add packages/demo/src/main.ts packages/demo/src/agent.ts
git commit -m "refactor(demo): simplify demo to config and startup glue"
```

---

## Task 13: 调整 demo 依赖

**Files:**
- Modify: `packages/demo/package.json`

- [ ] **Step 1: 修改 `packages/demo/package.json`**

```json
{
  "name": "@agent-harness/demo",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "start": "node dist/main.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@agent-harness/core": "workspace:*",
    "@agent-harness/tui": "workspace:*",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: 安装依赖**

Run: `pnpm install`

Expected: 成功

- [ ] **Step 3: 提交**

```bash
git add packages/demo/package.json pnpm-lock.yaml
git commit -m "chore(demo): replace pi-tui with @agent-harness/tui dependency"
```

---

## Task 14: 全仓验证

**Files:**
- 所有改动

- [ ] **Step 1: 运行全仓类型检查**

Run: `pnpm typecheck`

Expected: PASS

- [ ] **Step 2: 运行全仓测试**

Run: `pnpm test`

Expected: PASS

- [ ] **Step 3: 提交（如测试通过）**

```bash
git commit -m "chore: verify full workspace typecheck and tests pass" --allow-empty
```

---

## Task 15: 验证 demo 可运行（可选，需要 API key）

**Files:**
- 无

- [ ] **Step 1: 设置环境变量并构建**

```bash
pnpm --filter @agent-harness/demo build
```

- [ ] **Step 2: 运行 demo**

```bash
OPENAI_API_KEY=xxx DEMO_AGENT_NAME="Layered Demo" pnpm --filter @agent-harness/demo start
```

Expected: TUI 正常启动，可输入并看到流式回复。

---

## 自审检查

### Spec 覆盖检查

| Spec 要求 | 对应 Task |
|-----------|-----------|
| CoreAgent 暴露 `maxTurns` | Task 1 |
| `core/src/ui/types.ts` 定义协议接口 | Task 2 |
| `createUIAgentSession` 适配器 | Task 3 |
| 协议层从 `core` 导出 | Task 4 |
| 创建 `@agent-harness/tui` 包 | Task 5 |
| 迁移 colors/theme | Task 6 |
| 拆分 message 组件 | Task 7 |
| 迁移 chat-log/event-log/status-bar | Task 8 |
| TUIApp 实现 `UISessionCallbacks` | Task 9 |
| demo 简化为配置+启动 | Task 12 |
| demo 依赖调整 | Task 13 |
| 测试覆盖 | Task 5, Task 11 |

### Placeholder 检查

- 无 TBD/TODO。
- 无 "add appropriate error handling" 等模糊描述。
- 每个代码步骤都包含实际代码。

### 类型一致性检查

- `UIAgentSession.setCallbacks` 在所有 task 中保持一致。
- `AgentStreamChunk` 类型从 `@agent-harness/core` 导入，与当前 core 中定义一致。
- `CoreAgent.maxTurns` 在 Task 1 中实现，Task 3 中使用。

### 风险点

- `pi-tui` 的 `Markdown` 组件 API 需要确认。如果 `getText()` 不存在，需要按 Task 7 中备选方案在 `AssistantMessage` 内部维护 text 字段。
- `AgentStreamChunk` 的字段名需要与当前 core 中完全一致。Spec 中使用的 `tool-call`、`tool-result` 等类型需与 `packages/core/src/types.ts` 当前定义匹配。
