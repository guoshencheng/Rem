# TUI 与 UI-Agent 协议分层设计

## 背景

当前 `packages/demo` 把 TUI 实现直接放在 `src/tui/` 目录下，并通过 `src/agent.ts` 里的 `createDemoAgent` 把 `CoreAgent` 的底层事件翻译成 TUI 回调。这导致：

- demo 包同时承担配置、启动、UI 适配、UI 渲染四重职责。
- TUI 组件无法被其他 demo/工具复用。
- 未来 Web UI 或其他前端需要重写一遍事件适配逻辑。

本设计把 TUI 沉淀为独立子包，并在 `core` 内新增一个 UI 友好的协议层，形成：

```text
demo → tui → core/ui-agent-protocol → core/agent
```

## 目标

1. `packages/tui` 成为可复用的终端 UI 实现，不感知 demo 的具体配置。
2. `core/src/ui/` 成为 UI 与 Agent 之间的通用协议层，进程内使用回调风格。
3. `packages/demo` 只保留配置和启动胶水代码。
4. 未来 Web UI 可以通过同一协议层对接 `CoreAgent`。

## 非目标

- 跨进程通信。协议层先按进程内 TypeScript 接口设计。
- 通用 UI 状态模型。协议层不维护消息列表、事件日志等 UI 状态，只暴露事件流和回调。
- 替换 TUI 库。`tui` 包继续基于 `@earendil-works/pi-tui`。

## 关键设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 协议层位置 | 放在 `core/src/ui/` | 与 Agent 核心同仓库，减少包数量；作为 Core 的 UI 友好出口。 |
| 协议风格 | 回调风格 | 简单直接，TUI 实现很薄。 |
| 协议抽象程度 | 通用语义 | 只暴露会话生命周期、消息、流 chunks、状态变化，不暴露 `eventLog`、`statusBar` 等面板概念。 |
| TUI 包定位 | 基于 pi-tui 的可复用终端 UI 壳 | 渲染细节由 tui 自己决定，其他 UI 实现不受其约束。 |
| 消息数量上限 | 由 `ChatLog` 内部控制 | 容器自身负责容量管理，`TUIApp` 不介入。 |

## 包结构与依赖

最终目录结构：

```text
packages/
  core/          # rem-agent-core
  tui/           # rem-agent-tui
  demo/          # rem-agent-demo
```

依赖方向：

```text
demo ──► tui ──► core
```

### `packages/core/src/ui/`

```text
packages/core/src/ui/
  ├── types.ts       # UIAgentSession、UISessionCallbacks
  ├── session.ts     # createUIAgentSession 适配器
  └── index.ts       # 统一导出
```

### `packages/tui/src/`

```text
packages/tui/src/
  ├── app.ts
  ├── chat-log.ts
  ├── event-log.ts
  ├── status-bar.ts
  ├── message/
  │   ├── user-message.ts
  │   ├── assistant-message.ts
  │   ├── stream-message.ts
  │   ├── reasoning-block.ts
  │   ├── tool-call-block.ts
  │   └── tool-result-block.ts
  ├── colors.ts
  ├── theme.ts
  └── index.ts
```

### `packages/demo/src/`

```text
packages/demo/src/
  ├── main.ts
  ├── config.ts
  └── config.test.ts
```

## 协议层接口设计

### `UISessionCallbacks`

```ts
// packages/core/src/ui/types.ts

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
```

### `UIAgentSession`

```ts
// packages/core/src/ui/types.ts

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

### `createUIAgentSession`

```ts
// packages/core/src/ui/session.ts

import type { CoreAgent } from '../core-agent.js';
import type { UIAgentSession, UISessionCallbacks } from './types.js';

export function createUIAgentSession(
  agent: CoreAgent,
  callbacks?: UISessionCallbacks,
): UIAgentSession;
```

实现要点：

- 内部订阅 `CoreAgent` 事件，转成回调。
- `setCallbacks()` 允许在创建后注册/替换回调，方便 `TUIApp` 先创建再把自己注册进去。
- `submit()` 调用 `agent.run({ content: text })`，并启动 `for await` 消费 `fullStream`。
- `interrupt()` 调用 `agent.interrupt()`。
- `reset()` 调用 `agent.reset()`。
- `maxTurns` 从 `CoreAgent` 暴露的属性读取。

## `CoreAgent` 需要新增的公共属性

为了支持协议层，`CoreAgent` 需要暴露 `maxTurns`：

```ts
export class CoreAgent {
  readonly maxTurns: number;
  // ...
}
```

实现方式：在构造函数中从 `config.budget` 或 `config.maxTurns` 解析并保存。

## `tui` 包设计

### `TUIApp` 对外 API

```ts
// packages/tui/src/app.ts

import type { UIAgentSession, UISessionCallbacks } from 'rem-agent-core';

export interface TUIAppOptions {
  session: UIAgentSession;
}

export class TUIApp implements UISessionCallbacks {
  constructor(options: TUIAppOptions);
  start(): void;
  stop(): void;
}
```

### `TUIApp` 职责

- 组装 `ChatLog`、`EventLog`、`StatusBar`、`Input` 布局。
- 在构造函数中调用 `session.setCallbacks(this)`，把自己注册为 `UISessionCallbacks` 接收者。
- 监听输入框提交，调用 `session.submit(text)`。
- 监听 `Escape` 和 `Ctrl+C`，调用 `session.interrupt()` 或 `stop()` 后退出进程。
- 通过实现 `UISessionCallbacks` 驱动 UI 更新。

### 消息组件拆分

- `user-message.ts`：用户消息渲染（背景色 + Markdown）。
- `assistant-message.ts`：静态 assistant 消息渲染。
- `stream-message.ts`：流式 assistant 消息容器，按 `partId` 管理子组件。
- `reasoning-block.ts`：reasoning 区域，显示思考耗时。
- `tool-call-block.ts` / `tool-result-block.ts`：工具调用和结果卡片。

### `ChatLog` 容量管理

`ChatLog` 自身维护 `maxMessages` 上限并自动裁剪旧消息。默认值 `100`，可通过构造参数覆盖。`TUIApp` 不介入裁剪逻辑。

`maxMessages` 与 `maxTurns` 是完全独立的两个概念：

- `maxTurns` 是 `CoreAgent` 的预算，限制会话轮数。
- `maxMessages` 是 `ChatLog` 的渲染上限，限制 UI 中同时显示的消息条数。

## `demo` 包与数据流

### `demo/src/main.ts` 示例

```ts
import 'dotenv/config';
import { createAgentFromEnv, createUIAgentSession } from 'rem-agent-core';
import { TUIApp } from 'rem-agent-tui';
import { resolveConfig } from './config.js';

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

  process.on('SIGINT', () => {
    app.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

### 数据流

```text
用户输入 ──► TUIApp.Input.onSubmit
              │
              ▼
        session.submit(text)
              │
              ├─► onUserMessage(text) ──► ChatLog.addUser
              │
              ▼
        agent.run(input)
              │
              ├─► core-agent:start ──► StatusBar: running
              ├─► turn:before ──► StatusBar: turn N/maxTurns
              ├─► phase:reason:before/after ──► EventLog.addEvent
              ├─► AgentStreamChunk ──► StreamAssistantMessage.appendChunk
              ├─► turn:after ──► StatusBar: idle
              └─► core-agent:stop/error ──► StatusBar 更新
```

## 错误处理

- `agent.run()` 抛出的异常通过 `result.output` 的 reject 路径传播。
- `createUIAgentSession` 在 `submit()` 内 catch 这些异常，调用 `callbacks.onError`。
- `TUIApp` 在 `onError` 中把错误显示在 EventLog 和 ChatLog 中。
- `interrupt()` 只影响当前 turn，不影响会话状态。

## 测试策略

### `packages/core/tests/ui/session.test.ts`（新建）

- `createUIAgentSession` 返回 `UIAgentSession`。
- `submit()` 触发 `onUserMessage` 和 `onStreamChunk`。
- `interrupt()` 调用 `agent.interrupt()`。
- `reset()` 调用 `agent.reset()`。
- 使用 mock `CoreAgent` 或构造最小实例。

### `packages/tui/tests/`（新建）

- `stream-message.test.ts`：验证不同 chunk 类型创建正确子组件。
- `chat-log.test.ts`：验证 `maxMessages` 裁剪逻辑。
- 完整 TUI 渲染测试因依赖终端环境，优先级放低。

### `packages/demo/src/config.test.ts`

- 保留现有配置解析测试。

## 依赖与构建调整

### 新增 `packages/tui/package.json`

```json
{
  "name": "rem-agent-tui",
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
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "rem-agent-core": "workspace:*",
    "@earendil-works/pi-tui": "^0.79.3"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

### 调整 `packages/demo/package.json`

- 移除 `@earendil-works/pi-tui`。
- 新增 `rem-agent-tui`。
- 保留 `rem-agent-core` 和 `dotenv`。

### 根目录脚本

根目录 `package.json` 的 `typecheck` 和 `test` 无需修改，`packages/*` 已覆盖新增包。

## 迁移步骤

1. 在 `core` 中给 `CoreAgent` 添加 `maxTurns` 公共属性。
2. 在 `core/src/ui/` 中新增 `types.ts`、`session.ts`、`index.ts`。
3. 在 `core/src/index.ts` 中导出 `ui/` 模块。
4. 创建 `packages/tui`，迁移 `demo/src/tui/`、`colors.ts`、`theme.ts`。
5. 拆分 `message.ts` 为 `message/` 下的多个组件。
6. 调整 `TUIApp` 实现 `UISessionCallbacks`。
7. 简化 `packages/demo`，删除 `agent.ts`，重写 `main.ts`。
8. 调整 `packages/demo/package.json` 依赖。
9. 新增 `core` 和 `tui` 的测试。
10. 运行 `pnpm typecheck && pnpm test` 验证。
