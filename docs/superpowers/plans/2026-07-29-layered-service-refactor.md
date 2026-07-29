# 分层服务重构（core-v2 / bridge-v2）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-07-29-layered-service-refactor-design.md` 落地新分层：core-v2 提供无状态 `REMAgent`，bridge-v2 提供 `AgentsUniService / AgentService / SessionService / WorkspaceService / REMSession`，web 通过 `REM_IMPL=v1|v2` 切换新旧实现。

**Architecture:** `REMAgent`（core-v2）包装 pi-agent `Agent`，是无状态执行单元 + 事件源（`REMAgentEvent` 多消费者事件队列）；bridge-v2 的 `AgentService` 消费事件流做三路分发（REMSession 内存状态 / SessionService 落盘 / 全局 BusEvent 总流）；`AgentsUniService` 组合各服务并对齐现有 `IAgentService` 18 方法接口。

**Tech Stack:** TypeScript (NodeNext, composite tsc)、vitest（根配置 alias 到 src）、`@earendil-works/pi-agent-core` / `pi-ai`、pnpm workspace。

**关键约束：**
- 旧 `packages/core` / `packages/bridge` 实现代码不改行为，仅允许**纯新增导出**（Task 1）。
- 所有新代码放 `packages/core-v2` / `packages/bridge-v2`。
- 验证命令：根目录 `pnpm typecheck`（注意：仓库当前在 `packages/core/src/stream/event-aggregators.ts` 有**既存**类型错误，与本次无关，不要修；判断标准是不新增错误）和 `pnpm test`。
- 提交信息风格参考 `git log --oneline`（英文、conventional commits）。

---

### Task 1: core 增加 v2 复用导出（纯新增，无行为变化）

core-v2 装配需要复用 core 的内部件，这些目前未从 index 导出。同时给 `BusEvent` 的 `chunk` 事件加可选 `agentId` 标签（ additive，UI 不受影响）。

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/bus-events.ts:15`

- [ ] **Step 1: 修改 bus-events.ts，chunk 事件加 agentId**

`packages/core/src/bus-events.ts` 第 15 行改为：

```typescript
  | { workspace: string; sessionId: string; type: 'chunk'; chunk: AgentStreamEvent; agentId?: string }
```

- [ ] **Step 2: index.ts 追加导出块**

`packages/core/src/index.ts` 末尾追加：

```typescript
// --- core-v2 复用支持（纯新增导出，无行为变化）---
export { composeToolProviders } from './tool-composer.js';
export { ToolOverlay, defineOverlayTool, type ToolOverlayEntry } from './tool-overlay.js';
export { createToolBridge, type ToolBridgeParams, type ToolBridge } from './run-agent/tool-bridge.js';
export { createContextBridge, type ContextBridgeParams, type ContextBridge } from './run-agent/context-bridge.js';
export { createPiAgent, type PiAgentFactoryParams } from './run-agent/pi-agent-factory.js';
export {
  createDelegateTaskToolDefinition,
  createDelegateTaskToolExecutor,
  type DelegateTaskInput,
} from './plugins/tool/builtin/delegate-task.js';
export {
  createTodoWriteToolDefinition,
  createTodoWriteToolExecutor,
} from './plugins/tool/builtin/todo-write.js';
export { buildChildContext, type BuildChildContextOptions } from './sub-agent/build-child-context.js';
export { formatTaskResult } from './sub-agent/format-task-result.js';
export { generateId } from './shared/generate-id.js';
```

注意：`DelegateTaskInput` 当前在 delegate-task.ts 中是 `export type`，确认可导出；`ToolBridgeParams`/`ContextBridgeParams` 已存在（tool-bridge.ts:13、context-bridge.ts:6）。

- [ ] **Step 3: 验证 core 构建**

Run: `pnpm --filter rem-agent-core build`
Expected: 构建成功（若 event-aggregators.ts 既存错误阻塞构建，改用 `pnpm --filter rem-agent-core exec tsc --noEmit 2>&1 | grep -v event-aggregators` 确认无新增错误即可，并在提交信息中说明）

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/bus-events.ts
git commit -m "feat(core): export internal assembly pieces for core-v2 reuse; tag bus chunk with optional agentId"
```

---

### Task 2: core-v2 包骨架

**Files:**
- Create: `packages/core-v2/package.json`
- Create: `packages/core-v2/tsconfig.json`
- Create: `packages/core-v2/src/index.ts`（占位，后续任务填充）
- Modify: `vitest.config.ts`（根目录，加 alias）

- [ ] **Step 1: 写 package.json**

`packages/core-v2/package.json`：

```json
{
  "name": "rem-agent-core-v2",
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
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  },
  "dependencies": {
    "@earendil-works/pi-agent-core": "^0.82.1",
    "@earendil-works/pi-ai": "^0.82.1",
    "rem-agent-core": "workspace:*"
  },
  "sideEffects": false
}
```

- [ ] **Step 2: 写 tsconfig.json**

`packages/core-v2/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: 占位 index.ts**

`packages/core-v2/src/index.ts`：

```typescript
export {};
```

- [ ] **Step 4: vitest alias**

根目录 `vitest.config.ts` 的 `resolve.alias` 数组中，在 `rem-agent-core` 条目**之前**插入（注意：`rem-agent-core-v2` 必须排在 `rem-agent-core` 前面，否则会被前缀匹配截获）：

```typescript
      { find: 'rem-agent-core-v2', replacement: resolve(__dirname, 'packages/core-v2/src/index.ts') },
```

同时确认 `rem-agent-bridge-v2` alias（Task 8 用）届时也插在 `rem-agent-bridge` 之前。

- [ ] **Step 5: 安装 + 验证**

Run: `pnpm install && pnpm --filter rem-agent-core-v2 typecheck`
Expected: 成功

- [ ] **Step 6: Commit**

```bash
git add packages/core-v2 vitest.config.ts pnpm-lock.yaml
git commit -m "chore(core-v2): scaffold package"
```

---

### Task 3: EventQueue（多消费者异步事件队列）

REMAgent 的事件出口。多消费者：delegate executor 和 AgentService 可同时消费同一子 Agent 的事件；后注册的消费者能读到注册前的 backlog。

**Files:**
- Create: `packages/core-v2/src/event-queue.ts`
- Test: `packages/core-v2/tests/event-queue.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/core-v2/tests/event-queue.test.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import { EventQueue } from '../src/event-queue.js';

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

describe('EventQueue', () => {
  it('单消费者按序收到事件并在 finish 后结束', async () => {
    const q = new EventQueue<number>();
    const done = collect(q);
    q.push(1);
    q.push(2);
    q.finish();
    await expect(done).resolves.toEqual([1, 2]);
  });

  it('多消费者各自收到全量事件', async () => {
    const q = new EventQueue<string>();
    const a = collect(q);
    const b = collect(q);
    q.push('x');
    q.push('y');
    q.finish();
    await expect(a).resolves.toEqual(['x', 'y']);
    await expect(b).resolves.toEqual(['x', 'y']);
  });

  it('后注册的消费者能读到注册前的 backlog', async () => {
    const q = new EventQueue<string>();
    q.push('early');
    const late = collect(q);
    q.push('late');
    q.finish();
    await expect(late).resolves.toEqual(['early', 'late']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run packages/core-v2/tests/event-queue.test.ts`
Expected: FAIL（`../src/event-queue.js` 不存在）

- [ ] **Step 3: 实现 EventQueue**

`packages/core-v2/src/event-queue.ts`：

```typescript
/**
 * 多消费者异步事件队列。
 * - 每个 asyncIterator 独立消费全量事件（含注册前 backlog）。
 * - finish() 后所有消费者自然结束；结束后 push 被忽略。
 * - items 随队列对象被 GC（生命周期与一次 run 绑定）。
 */
export class EventQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters = new Set<() => void>();
  private finished = false;

  push(item: T): void {
    if (this.finished) return;
    this.items.push(item);
    for (const w of [...this.waiters]) w();
  }

  finish(): void {
    this.finished = true;
    for (const w of [...this.waiters]) w();
  }

  get isFinished(): boolean {
    return this.finished;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    let cursor = 0;
    while (true) {
      if (cursor < this.items.length) {
        yield this.items[cursor++];
        continue;
      }
      if (this.finished) return;
      await new Promise<void>((resolve) => {
        const w = () => {
          this.waiters.delete(w);
          resolve();
        };
        this.waiters.add(w);
      });
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run packages/core-v2/tests/event-queue.test.ts`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add packages/core-v2/src/event-queue.ts packages/core-v2/tests/event-queue.test.ts
git commit -m "feat(core-v2): add multi-consumer EventQueue"
```

---

### Task 4: PiAgentLike + REMAgentEvent 类型

**Files:**
- Create: `packages/core-v2/src/pi-agent-like.ts`
- Create: `packages/core-v2/src/rem-agent-event.ts`

- [ ] **Step 1: PiAgentLike**

`packages/core-v2/src/pi-agent-like.ts`：

```typescript
import type { Message } from '@earendil-works/pi-ai';
import type { AgentEvent } from '@earendil-works/pi-agent-core';

/**
 * REMAgent 依赖的 pi-agent 最小面（结构类型）。
 * 生产环境由 pi-agent-core 的 Agent 实例满足；测试用手写 fake。
 */
export interface PiAgentLike {
  subscribe(listener: (event: AgentEvent) => void | Promise<void>): () => void;
  prompt(message: Message): Promise<void>;
  steer(message: Message): void;
  followUp(message: Message): void;
  abort(): void;
}
```

- [ ] **Step 2: REMAgentEvent**

`packages/core-v2/src/rem-agent-event.ts`：

```typescript
import type { Message, Usage } from '@earendil-works/pi-ai';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { RemMetaEvent } from 'rem-agent-core';
import type { REMAgent } from './rem-agent.js';

/**
 * REMAgent 向上抛出的事件。
 * - pi.AgentEvent / RemMetaEvent：原样上抛（最终成为 BusEvent chunk）。
 * - message-persist：一条已完成消息待 SessionService 落盘。
 * - child-spawned：delegate_task 创建了子 Agent，AgentService 应 listen。
 * - usage：本次 run 的累计 token usage（assistantMessageId 用于挂 messageTokenUsage）。
 */
export type REMAgentEvent =
  | AgentEvent
  | RemMetaEvent
  | { type: 'message-persist'; message: Message; messageId: string }
  | { type: 'child-spawned'; child: REMAgent; parentToolCallId: string }
  | { type: 'usage'; usage: Usage; assistantMessageId?: string };
```

- [ ] **Step 3: 验证类型**

Run: `pnpm --filter rem-agent-core-v2 typecheck`
Expected: 成功（rem-agent.ts 还不存在没关系，type-only import 循环合法）

- [ ] **Step 4: Commit**

```bash
git add packages/core-v2/src/pi-agent-like.ts packages/core-v2/src/rem-agent-event.ts
git commit -m "feat(core-v2): add PiAgentLike and REMAgentEvent types"
```

---

### Task 5: REMAgent 类

无状态执行单元：包装 pi-agent，把 `message_end` 转成 `message-persist`、累计 usage、结束时发 `usage` + `finish`/`error`。

**Files:**
- Create: `packages/core-v2/src/rem-agent.ts`
- Test: `packages/core-v2/tests/rem-agent.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/core-v2/tests/rem-agent.test.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, Message } from '@earendil-works/pi-ai';
import { REMAgent } from '../src/rem-agent.js';
import type { REMAgentEvent } from '../src/rem-agent-event.js';
import type { PiAgentLike } from '../src/pi-agent-like.js';

function assistantMessage(stopReason: 'stop' | 'error' = 'stop'): AssistantMessage {
  return {
    role: 'assistant',
    api: 'openai-completions',
    provider: 'mock',
    model: 'mock-model',
    content: [{ type: 'text', text: 'Hello' }],
    usage: { input: 3, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 6, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason,
    errorMessage: stopReason === 'error' ? 'boom' : undefined,
    timestamp: Date.now(),
  } as AssistantMessage;
}

/** 手写 PiAgentLike：prompt 时回放脚本化事件 */
class FakePiAgent implements PiAgentLike {
  steered: Message[] = [];
  followedUp: Message[] = [];
  aborted = false;
  private listeners: Array<(e: AgentEvent) => void> = [];

  constructor(private script: (emit: (e: AgentEvent) => void) => void) {}

  subscribe(listener: (e: AgentEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {};
  }

  async prompt(_message: Message): Promise<void> {
    this.script((e) => this.listeners.forEach((l) => void l(e)));
  }

  steer(m: Message): void { this.steered.push(m); }
  followUp(m: Message): void { this.followedUp.push(m); }
  abort(): void { this.aborted = true; }
}

async function collect(iter: AsyncIterable<REMAgentEvent>): Promise<REMAgentEvent[]> {
  const out: REMAgentEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

describe('REMAgent', () => {
  it('run 产出 message-persist / usage / finish，output 解析为文本', async () => {
    const assistant = assistantMessage();
    const pi = new FakePiAgent((emit) => {
      emit({ type: 'message_end', message: { role: 'user', content: 'hi', timestamp: Date.now() } as Message } as AgentEvent);
      emit({ type: 'message_end', message: assistant } as AgentEvent);
      emit({ type: 'turn_end', message: assistant } as AgentEvent);
    });
    const agent = new REMAgent({ agentId: 'root', agent: pi });

    const events = await collect(agent.run({ content: 'hi' }));

    const types = events.map((e) => e.type);
    expect(types).toContain('message-persist');
    expect(types).toContain('usage');
    expect(types).toContain('finish');

    const persists = events.filter((e) => e.type === 'message-persist');
    expect(persists).toHaveLength(2);

    const usage = events.find((e) => e.type === 'usage');
    expect(usage).toMatchObject({ usage: { totalTokens: 6 } });
    expect((usage as { assistantMessageId?: string }).assistantMessageId).toBeTruthy();

    await expect(agent.output).resolves.toEqual({ content: 'Hello', completed: true });
    expect(agent.status).toBe('finished');
  });

  it('assistant stopReason=error 时发 error 事件，output 带 Error: 前缀', async () => {
    const bad = assistantMessage('error');
    const pi = new FakePiAgent((emit) => {
      emit({ type: 'message_end', message: bad } as AgentEvent);
      emit({ type: 'turn_end', message: bad } as AgentEvent);
    });
    const agent = new REMAgent({ agentId: 'root', agent: pi });

    const events = await collect(agent.run({ content: 'hi' }));

    const error = events.find((e) => e.type === 'error');
    expect(error).toMatchObject({ error: { message: 'boom' } });
    await expect(agent.output).resolves.toEqual({ content: 'Error: boom', completed: true });
    expect(agent.status).toBe('error');
  });

  it('steer / followUp / interrupt 透传到 pi agent', async () => {
    const pi = new FakePiAgent(() => {});
    const agent = new REMAgent({ agentId: 'root', agent: pi });
    agent.steer('s');
    agent.followUp('f');
    agent.interrupt();
    expect(pi.steered).toHaveLength(1);
    expect(pi.followedUp).toHaveLength(1);
    expect(pi.aborted).toBe(true);
  });

  it('attachChild 挂树并在活跃队列中发 child-spawned', async () => {
    const pi = new FakePiAgent((emit) => {
      const childPi = new FakePiAgent(() => {});
      const child = new REMAgent({ agentId: 'root.delegate-0', agent: childPi });
      parent.attachChild(child, 'tc-1');
      emit({ type: 'turn_end', message: assistantMessage() } as AgentEvent);
    });
    const parent = new REMAgent({ agentId: 'root', agent: pi });

    const events = await collect(parent.run({ content: 'hi' }));

    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].parentToolCallId).toBe('tc-1');
    const spawned = events.find((e) => e.type === 'child-spawned');
    expect(spawned).toMatchObject({ parentToolCallId: 'tc-1' });
  });

  it('running 中重复 run 抛错', async () => {
    const pi = new FakePiAgent(() => {});
    const agent = new REMAgent({ agentId: 'root', agent: pi });
    // prompt 永不 resolve → 保持 running
    pi.prompt = () => new Promise(() => {});
    agent.run({ content: 'hi' });
    expect(() => agent.run({ content: 'again' })).toThrow('already running');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run packages/core-v2/tests/rem-agent.test.ts`
Expected: FAIL（`../src/rem-agent.js` 不存在）

- [ ] **Step 3: 实现 REMAgent**

`packages/core-v2/src/rem-agent.ts`：

```typescript
import type { AssistantMessage, Message, Usage } from '@earendil-works/pi-ai';
import type { AgentOutput, RemMetaEvent, UserInput, UserInputContent } from 'rem-agent-core';
import { addUsage, emptyUsage, generateId } from 'rem-agent-core';
import { EventQueue } from './event-queue.js';
import type { PiAgentLike } from './pi-agent-like.js';
import type { REMAgentEvent } from './rem-agent-event.js';

export type REMAgentStatus = 'idle' | 'running' | 'finished' | 'error';

const toMessage = (content: UserInputContent): Message =>
  ({ role: 'user', content, timestamp: Date.now() }) as Message;

export interface REMAgentParams {
  agentId: string;
  agent: PiAgentLike;
  /** 所属持久化 session（子 Agent 有自己的 sessionId） */
  sessionId?: string;
  /** delegate_task 的 task 摘要（用于 child-agent-update） */
  summary?: string;
}

/**
 * 无状态执行单元 + 事件源。
 * 不碰存储、不持有总线、不持有 session 内存状态；
 * 通过 REMAgentEvent 把一切产出交给上层（bridge-v2 AgentService）。
 */
export class REMAgent {
  readonly agentId: string;
  readonly sessionId?: string;
  readonly summary?: string;
  readonly children: REMAgent[] = [];
  status: REMAgentStatus = 'idle';
  /** 由父 Agent attachChild 时回填 */
  parentToolCallId?: string;

  private readonly agent: PiAgentLike;
  private queue?: EventQueue<REMAgentEvent>;
  private totalUsage: Usage = emptyUsage();
  private lastAssistant?: AssistantMessage;
  private lastAssistantMessageId?: string;
  private outputResolve?: (output: AgentOutput) => void;
  private outputPromise?: Promise<AgentOutput>;

  constructor(params: REMAgentParams) {
    this.agentId = params.agentId;
    this.agent = params.agent;
    this.sessionId = params.sessionId;
    this.summary = params.summary;
  }

  /** 当前 run 的事件流（多消费者）；未运行时为 undefined */
  get events(): AsyncIterable<REMAgentEvent> | undefined {
    return this.queue;
  }

  /** 当前 run 的最终输出 */
  get output(): Promise<AgentOutput> | undefined {
    return this.outputPromise;
  }

  run(input: UserInput): AsyncIterable<REMAgentEvent> {
    if (this.status === 'running') {
      throw new Error(`REMAgent "${this.agentId}" is already running`);
    }
    this.status = 'running';
    const queue = new EventQueue<REMAgentEvent>();
    this.queue = queue;
    this.outputPromise = new Promise<AgentOutput>((resolve) => {
      this.outputResolve = resolve;
    });

    this.agent.subscribe((event) => {
      queue.push(event);
      if (event.type === 'message_end') {
        const message = event.message as Message;
        const messageId = generateId();
        if (message.role === 'assistant') {
          this.lastAssistantMessageId = messageId;
        }
        queue.push({ type: 'message-persist', message, messageId });
      } else if (event.type === 'turn_end' && (event.message as Message).role === 'assistant') {
        this.lastAssistant = event.message as AssistantMessage;
        this.totalUsage = addUsage(this.totalUsage, this.lastAssistant.usage);
      }
    });

    void (async () => {
      try {
        await this.agent.prompt(toMessage(input.content));
        queue.push({ type: 'usage', usage: this.totalUsage, assistantMessageId: this.lastAssistantMessageId });

        if (this.lastAssistant?.stopReason === 'error') {
          const errorMessage = this.lastAssistant.errorMessage ?? 'agent stream error';
          this.status = 'error';
          queue.push({ type: 'error', error: { name: 'AgentError', message: errorMessage } });
          this.outputResolve?.({ content: `Error: ${errorMessage}`, completed: true });
        } else {
          const content =
            this.lastAssistant?.content
              .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
              .map((b) => b.text)
              .join('') ?? '';
          this.status = 'finished';
          queue.push({ type: 'finish', output: { content, completed: true } });
          this.outputResolve?.({ content, completed: true });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.status = 'error';
        queue.push({ type: 'error', error: { name: 'AgentError', message } });
        this.outputResolve?.({ content: `Error: ${message}`, completed: true });
      } finally {
        queue.finish();
      }
    })();

    return queue;
  }

  steer(content: UserInputContent): void {
    this.agent.steer(toMessage(content));
  }

  followUp(content: UserInputContent): void {
    this.agent.followUp(toMessage(content));
  }

  interrupt(): void {
    this.agent.abort();
  }

  /** 内部：delegate_task executor 调用，把子 Agent 挂树并广播 child-spawned */
  attachChild(child: REMAgent, parentToolCallId: string): void {
    child.parentToolCallId = parentToolCallId;
    this.children.push(child);
    this.queue?.push({ type: 'child-spawned', child, parentToolCallId });
  }

  /** 内部：装配工厂注入的 meta 事件出口（tool-bridge / context-bridge / 标题） */
  emitMeta(event: RemMetaEvent): void {
    this.queue?.push(event);
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run packages/core-v2/tests/rem-agent.test.ts`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add packages/core-v2/src/rem-agent.ts packages/core-v2/tests/rem-agent.test.ts
git commit -m "feat(core-v2): add REMAgent execution unit"
```

---

### Task 6: delegate_task v2 executor

子 Agent 创建改为：bridge 注入的 `spawnChild` 负责建 child session + 装配 child REMAgent；executor 只负责挂树、驱动、格式化结果。

**Files:**
- Create: `packages/core-v2/src/delegate-task-v2.ts`
- Test: `packages/core-v2/tests/delegate-task-v2.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/core-v2/tests/delegate-task-v2.test.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, Message } from '@earendil-works/pi-ai';
import type { ToolContext } from 'rem-agent-core';
import { REMAgent } from '../src/rem-agent.js';
import { createDelegateTaskExecutorV2, type DelegateTaskInputV2 } from '../src/delegate-task-v2.js';
import type { PiAgentLike } from '../src/pi-agent-like.js';

class FakePiAgent implements PiAgentLike {
  private listeners: Array<(e: AgentEvent) => void> = [];
  constructor(private script: (emit: (e: AgentEvent) => void) => void) {}
  subscribe(l: (e: AgentEvent) => void): () => void { this.listeners.push(l); return () => {}; }
  async prompt(_m: Message): Promise<void> { this.script((e) => this.listeners.forEach((l) => void l(e))); }
  steer(): void {}
  followUp(): void {}
  abort(): void {}
}

function doneAssistant(text: string): AssistantMessage {
  return {
    role: 'assistant', api: 'openai-completions', provider: 'mock', model: 'm',
    content: [{ type: 'text', text }],
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop', timestamp: Date.now(),
  } as AssistantMessage;
}

const toolCtx = { sessionId: 'parent-session', toolCallId: 'tc-1', workspaceRoot: '/ws' } as ToolContext;

describe('createDelegateTaskExecutorV2', () => {
  it('spawn child → 挂树 → 驱动子 Agent → 返回格式化结果', async () => {
    const parent = new REMAgent({ agentId: 'root', agent: new FakePiAgent(() => {}) });
    const child = new REMAgent({
      agentId: 'root.delegate-0',
      sessionId: 'child-session',
      agent: new FakePiAgent((emit) => {
        const a = doneAssistant('child done');
        emit({ type: 'message_end', message: a } as AgentEvent);
        emit({ type: 'turn_end', message: a } as AgentEvent);
      }),
    });
    const executor = createDelegateTaskExecutorV2({
      parentAgent: parent,
      spawnChild: async () => child,
    });

    const result = await executor({ task: 'do thing' } as DelegateTaskInputV2, toolCtx);

    expect(parent.children).toHaveLength(1);
    expect(parent.children[0]).toBe(child);
    expect(child.parentToolCallId).toBe('tc-1');
    expect(child.status).toBe('finished');
    expect(result.output).toContain('child done');
  });

  it('spawnChild 抛错时返回 failed 结果，不抛出', async () => {
    const parent = new REMAgent({ agentId: 'root', agent: new FakePiAgent(() => {}) });
    const executor = createDelegateTaskExecutorV2({
      parentAgent: parent,
      spawnChild: async () => { throw new Error('no session'); },
    });

    const result = await executor({ task: 'do thing' } as DelegateTaskInputV2, toolCtx);

    expect(parent.children).toHaveLength(0);
    expect(result.output).toContain('no session');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run packages/core-v2/tests/delegate-task-v2.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 delegate-task-v2**

注意：旧 `createDelegateTaskToolDefinition` 的 schema 未导出（`packages/core/src/plugins/tool/builtin/delegate-task.ts:12-19`），所以 v2 文件内重新定义 schema 并导出自己的 definition（定义内容与旧版完全一致）。另外 `DelegateTaskExecutorV2Params.parentAgent` 类型为 `REMAgent | (() => REMAgent)`——executor 调用时父 Agent 可能尚未完成装配（createREMAgent 里 delegate overlay 先于 REMAgent 构造），函数形式用于延迟取值。

`packages/core-v2/src/delegate-task-v2.ts`：

```typescript
import { Type, type Static } from '@sinclair/typebox';
import type { ToolContext, ToolDefinition, ToolExecutor } from 'rem-agent-core';
import { formatTaskResult } from 'rem-agent-core';
import type { REMAgent } from './rem-agent.js';

const delegateTaskSchema = Type.Object(
  {
    task: Type.String({ description: 'Task description to delegate to the sub-agent.' }),
    systemPrompt: Type.Optional(Type.String({ description: 'Optional system prompt override for the sub-agent.' })),
    maxTurns: Type.Optional(Type.Number({ description: 'Optional max turns for the sub-agent.' })),
  },
  { additionalProperties: false },
);

export type DelegateTaskInputV2 = Static<typeof delegateTaskSchema>;

/** bridge 注入：创建 child session + 装配 child REMAgent */
export type SpawnChild = (input: DelegateTaskInputV2, toolCtx: ToolContext) => Promise<REMAgent>;

export function createDelegateTaskToolDefinitionV2(): ToolDefinition<typeof delegateTaskSchema> {
  return {
    name: 'delegate_task',
    description: 'Delegate an independent task to a sub-agent. The sub-agent runs in its own session, inherits the current model and tools, and returns the result when completed.',
    parameters: delegateTaskSchema,
    readOnly: false,
  };
}

export interface DelegateTaskExecutorV2Params {
  /** 对象或延迟取值函数（装配期 parent 尚未构造时用后者） */
  parentAgent: REMAgent | (() => REMAgent);
  spawnChild: SpawnChild;
}

/**
 * v2 delegate_task executor：spawnChild 拿 child REMAgent 挂树（触发 child-spawned），
 * drain 子事件流，等待 output 组装工具结果。子 Agent 出错不传染父 Agent。
 */
export function createDelegateTaskExecutorV2(
  params: DelegateTaskExecutorV2Params,
): ToolExecutor<typeof delegateTaskSchema> {
  const resolveParent = (): REMAgent =>
    typeof params.parentAgent === 'function' ? params.parentAgent() : params.parentAgent;

  return async (input: DelegateTaskInputV2, toolCtx: ToolContext) => {
    const toolCallId = toolCtx.toolCallId ?? 'unknown';
    try {
      const child = await params.spawnChild(input, toolCtx);
      resolveParent().attachChild(child, toolCallId);

      const drain = (async () => {
        for await (const _event of child.run({ content: input.task, timestamp: new Date() })) {
          // 仅消费（AgentService 作为第二消费者同步 listen）
        }
      })();
      await drain;

      const output = (await child.output) ?? { content: '', completed: true };
      const failed = output.content.startsWith('Error: ');
      const displayContent = failed ? output.content.slice('Error: '.length) : output.content;
      return {
        output: formatTaskResult({
          childSessionId: child.sessionId ?? '',
          task: input.task,
          content: displayContent,
          failed,
        }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        output: formatTaskResult({
          childSessionId: '',
          task: input.task,
          content: message,
          failed: true,
        }),
      };
    }
  };
}
```

另外 `@sinclair/typebox` 需加入 core-v2 dependencies（package.json 加 `"@sinclair/typebox": "^0.27.0"` 后 `pnpm install`）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm install && pnpm vitest run packages/core-v2/tests/delegate-task-v2.test.ts`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add packages/core-v2/src/delegate-task-v2.ts packages/core-v2/tests/delegate-task-v2.test.ts packages/core-v2/package.json pnpm-lock.yaml
git commit -m "feat(core-v2): add delegate_task v2 executor with spawnChild hook"
```

---

### Task 7: createREMAgent 装配工厂

把旧 `runAgent`（packages/core/src/run-agent/index.ts:58-288）的装配逻辑迁入 core-v2：配置解析 → context build → 工具组合（含 delegate/todo overlay）→ systemPrompt → tool/context bridge → createPiAgent → REMAgent。**去掉**：session load/save、liveState、EventBus、usage/metadata 落盘（这些变成事件，由 bridge 处理）。

**Files:**
- Create: `packages/core-v2/src/create-rem-agent.ts`
- Create: `packages/core-v2/src/index.ts`（导出全部）
- Test: `packages/core-v2/tests/create-rem-agent.test.ts`
- Test helper: `packages/core-v2/tests/helpers/fake-di.ts`

- [ ] **Step 1: 写测试 helper（fake DI）**

`packages/core-v2/tests/helpers/fake-di.ts`：

```typescript
import type { AgentDI, AgentRuntimeConfig, Session } from 'rem-agent-core';
import { createAgentAssembly, createDefaultAgentPaths, initializeAgentDI } from 'rem-agent-core';
import { createCoreModels } from 'rem-agent-core';
import type { ConfigProvider, ResolvedAgentConfig, ResolvedAgentRole, ResolvedModelConfig, AgentBehaviorConfig, AgentToolConfig, CompressionConfig } from 'rem-agent-core';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

class FakeConfigProvider implements ConfigProvider {
  async init(): Promise<void> {}
  getConfig(): ResolvedAgentConfig {
    return { ...this.getBehaviorConfig(), model: this.getModelConfig() };
  }
  getModelConfig(): ResolvedModelConfig {
    return { provider: 'mock', model: 'mock-model', apiKey: 'mock-key' };
  }
  getToolConfig(): AgentToolConfig { return {}; }
  getBehaviorConfig(): Required<AgentBehaviorConfig> {
    return {
      name: 'TestAgent', maxTurns: 5, workspaceRoot: '/', readOnly: false,
      autoApproveDangerous: true, profile: 'coding', sessionRules: [],
      compression: this.getCompressionConfig(),
    };
  }
  getCompressionConfig(): Required<CompressionConfig> {
    return { enabled: false, thresholdRatio: 0.8, protectHead: 4, protectTail: 8 };
  }
  getMcpConfig(): Record<string, unknown> { return {}; }
  resolveAgent(): ResolvedAgentRole {
    return { id: 'default', name: 'TestAgent', corePrompt: '' };
  }
}

export interface FakeAssembly {
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
  cleanup: () => Promise<void>;
}

/** 用真实装配 + mock models（pi Agent 不会真正发流，除非测试主动 prompt） */
export async function createFakeAssembly(): Promise<FakeAssembly> {
  const dir = await mkdtemp(join(tmpdir(), 'core-v2-test-'));
  const paths = createDefaultAgentPaths({ agentDir: dir, homeAgentDir: dir });
  const models = createCoreModels();
  const { di, runtimeConfig } = createAgentAssembly({ paths, configProvider: new FakeConfigProvider(), models });
  await initializeAgentDI(di, { skipMcp: true });
  return { di, runtimeConfig, cleanup: async () => {} };
}

export function fakeSession(sessionId = 's-1'): Session {
  return {
    sessionId, conversation: [], currentTurn: 0,
    metadata: { schemaVersion: 2 }, createdAt: new Date(), updatedAt: new Date(),
  };
}
```

- [ ] **Step 2: 写失败测试**

`packages/core-v2/tests/create-rem-agent.test.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import { createREMAgent } from '../src/create-rem-agent.js';
import { REMAgent } from '../src/rem-agent.js';
import { createFakeAssembly, fakeSession } from './helpers/fake-di.js';

describe('createREMAgent', () => {
  it('装配出可运行的 REMAgent（root，含 delegate_task/todo_write 工具）', async () => {
    const { di, runtimeConfig } = await createFakeAssembly();
    const session = fakeSession();

    const agent = await createREMAgent({
      di,
      runtimeConfig,
      session,
      workspace: 'default',
      agentId: 'root',
      sessionId: session.sessionId,
      approvalState: { getOrCreate: () => { throw new Error('not used'); } },
      publishBus: () => {},
    });

    expect(agent).toBeInstanceOf(REMAgent);
    expect(agent.agentId).toBe('root');
    expect(agent.sessionId).toBe('s-1');
    expect(agent.status).toBe('idle');
  });

  it('无标题 session 在 run 后产生 session-title 事件（titleProvider mock 返回标题）', async () => {
    const { di, runtimeConfig } = await createFakeAssembly();
    di.titleProvider = { generateTitle: async () => 'Mock Title' };
    const session = fakeSession('s-2');

    const agent = await createREMAgent({
      di, runtimeConfig, session,
      workspace: 'default', agentId: 'root', sessionId: 's-2',
      approvalState: { getOrCreate: () => { throw new Error('not used'); } },
      publishBus: () => {},
    });

    // 不真正 prompt（pi Agent 会用 mock models 发流失败也无所谓），
    // 手动触发 run 后立刻 interrupt；只验证 title 事件进入队列。
    const events = agent.run({ content: 'hi' });
    agent.interrupt();
    const seen: string[] = [];
    for await (const e of events) {
      seen.push(e.type);
      if (e.type === 'session-title' || e.type === 'error' || e.type === 'finish') break;
    }
    // mock provider 不存在 → prompt 大概率 error；但 title 事件应在此之前已发出
    expect(seen).toContain('session-title');
  });
});
```

注意：测试需要注册 mock provider（否则 `createCoreModels()` 空集合在装配时 `getModel('mock','mock-model')` 直接抛 `Unknown model`）。把 `packages/bridge/tests/agent-service/shared.ts:21-167` 的 `MockEventStream` / `createMockProvider` / `createMockModels` 完整复制为 `packages/core-v2/tests/helpers/mock-models.ts`，`createFakeAssembly` 中改为 `const models = createMockModels({ name: 'mock' })`。mock provider 默认行为是立即 `done` 一条 'Hello' assistant 消息，因此第二个测试可以跑完整 run：run 结束后 `seen` 应同时包含 `'session-title'` 与 `'finish'`。

- [ ] **Step 3: 实现 createREMAgent**

`packages/core-v2/src/create-rem-agent.ts`：

```typescript
import type { Message } from '@earendil-works/pi-ai';
import type {
  AgentDI, AgentRuntimeConfig, ArchiveRecord, BusEvent, Session,
  PromptBuildContext, RemMetaEvent, Skill, TokenUsageDetail, ToolProvider,
  ApprovalEngine, ApprovalRequest,
} from 'rem-agent-core';
import {
  DefaultTodoService, ToolOverlay, composeToolProviders,
  createContextBridge, createPiAgent, createTodoWriteToolDefinition,
  createTodoWriteToolExecutor, createToolBridge, defineOverlayTool, generateId,
  log, normalizeUsageDetail, resolveContextWindow,
} from 'rem-agent-core';
import { REMAgent } from './rem-agent.js';
import { createDelegateTaskExecutorV2, createDelegateTaskToolDefinitionV2, type SpawnChild } from './delegate-task-v2.js';

/** tool-bridge 审批链路需要的最小 live state 面（由 bridge 的 REMSession 满足） */
export interface ApprovalStateLike {
  approvalEngine: ApprovalEngine;
  pendingApprovals: ApprovalRequest[];
}

export interface CreateREMAgentParams {
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
  /** 已由 SessionService 加载/创建的 session（本函数不做任何持久化） */
  session: Session;
  workspace: string;
  agentId: string;
  sessionId: string;
  agentRoleId?: string;
  workspaceRoot?: string;
  signal?: AbortSignal;
  summary?: string;
  /** 审批状态（REMSession 适配） */
  approvalState: { getOrCreate(sessionId: string): ApprovalStateLike };
  /** BusEvent 出口（todo_write 等工具直发总线） */
  publishBus: (event: BusEvent) => void;
  /** delegate_task 能力；缺省时 delegate_task 调用直接返回 failed 结果 */
  spawnChild?: SpawnChild;
}

export async function createREMAgent(params: CreateREMAgentParams): Promise<REMAgent> {
  const { di, runtimeConfig, session, workspace } = params;
  const configProvider = di.configProvider.forWorkspace?.(workspace) ?? di.configProvider;
  const behavior = configProvider.getBehaviorConfig();
  const modelConfig = configProvider.getModelConfig();
  const agentRole = configProvider.resolveAgent(params.agentRoleId);
  const effectiveModel = agentRole.model ?? modelConfig;
  const workspaceRoot = params.workspaceRoot ?? workspace ?? behavior.workspaceRoot;

  const { messages } = await di.contextProvider.build(session, behavior.name);

  const effectiveToolProvider = composeToolProviders({
    toolProvider: di.toolProvider,
    mcpProviders: di.mcpProviders,
    skillProvider: di.skillProvider,
  });

  // 两个延迟引用：emitMeta 与 parentAgent 都在 REMAgent 构造后回填
  let emitMeta: (event: RemMetaEvent) => void = () => {};
  const parentRef: { current?: REMAgent } = {};

  const spawnChild: SpawnChild =
    params.spawnChild ??
    (async () => {
      throw new Error('delegate_task is not available for this agent');
    });

  const toolProviderWithOverlay: ToolProvider = new ToolOverlay(effectiveToolProvider, [
    defineOverlayTool(
      createDelegateTaskToolDefinitionV2(),
      createDelegateTaskExecutorV2({
        parentAgent: () => {
          if (!parentRef.current) throw new Error('delegate_task called before agent is ready');
          return parentRef.current;
        },
        spawnChild,
      }),
    ),
    defineOverlayTool(
      createTodoWriteToolDefinition(),
      createTodoWriteToolExecutor(
        new DefaultTodoService(di.storage.todoStore),
        (event) => params.publishBus(event),
        workspace,
      ),
    ),
  ]);

  const skills = await di.skillProvider.loadSkills().catch(() => [] as Skill[]);
  const tools = toolProviderWithOverlay.getToolSet().map((t) => ({ name: t.name, description: t.description }));

  const buildCtx: PromptBuildContext = {
    agentName: agentRole.name,
    workspaceRoot,
    readOnly: behavior.readOnly,
    tools,
    skills,
    model: { provider: effectiveModel.provider, model: effectiveModel.model },
    runtime: {
      platform: runtimeConfig.runtime.platform,
      nodeVersion: runtimeConfig.runtime.nodeVersion ?? runtimeConfig.runtime.platform,
      today: new Date().toISOString().split('T')[0],
    },
    agentCorePrompt: agentRole.corePrompt,
  };

  const systemPrompt = await di.systemPromptAssembler.assemble(buildCtx);

  const emit = (event: RemMetaEvent) => emitMeta(event);

  const toolBridge = createToolBridge({
    toolProvider: toolProviderWithOverlay,
    permissionEvaluator: di.permissionEvaluator,
    agentState: params.approvalState as never, // 结构适配：仅用 getOrCreate → approvalEngine/pendingApprovals
    ruleEngine: di.ruleEngine,
    ruleStore: di.storage.ruleStore,
    securityMode: runtimeConfig.securityMode,
    workspaceRoot,
    agentName: behavior.name,
    readOnly: behavior.readOnly,
    sessionId: params.sessionId,
    signal: params.signal,
    emit,
  });

  const historyForTokens = ((session.metadata.tokenUsageHistory as unknown[]) ?? []).map((entry) =>
    normalizeUsageDetail(entry as TokenUsageDetail));
  const accumulated = historyForTokens.reduce((sum, entry) => sum + entry.totalTokens, 0);

  const contextBridge = createContextBridge({
    compressor: di.compressor,
    shouldCompress: (msgs) => di.compressor.shouldCompress({ ...session, conversation: msgs }),
    estimatedTokens: () => accumulated,
    threshold: () => {
      const maxTokens = resolveContextWindow(effectiveModel.provider, effectiveModel.model, runtimeConfig.runtime.env, di.models);
      return maxTokens * configProvider.getCompressionConfig().thresholdRatio;
    },
    archive: async (before, _after) => {
      // v2：只写 archiveStore；session.metadata.compressionHistory 由 SessionService
      // 在 compress-end 事件时更新（单一写入方）
      const previousArchive = await di.storage.archiveStore.getLatest(params.sessionId);
      const archiveId = generateId();
      const record: ArchiveRecord = {
        id: archiveId,
        sessionId: params.sessionId,
        compressedAt: new Date(),
        version: previousArchive ? previousArchive.version + 1 : 1,
        parentArchiveId: previousArchive?.id,
        conversationSnapshot: before,
        summary: '',
      };
      await di.storage.archiveStore.save(record);
      return archiveId;
    },
    emit,
    sessionId: params.sessionId,
  });

  const piAgent = createPiAgent({
    di,
    effectiveModel,
    systemPrompt,
    messages: messages as Message[],
    tools: toolBridge.tools,
    beforeToolCall: (ctx) => toolBridge.beforeToolCall(ctx),
    transformContext: contextBridge.transformContext,
    maxTurns: behavior.maxTurns,
    signal: params.signal,
  });

  const remAgent = new REMAgent({
    agentId: params.agentId,
    agent: piAgent,
    sessionId: params.sessionId,
    summary: params.summary,
  });
  emitMeta = (event) => remAgent.emitMeta(event);
  parentRef.current = remAgent;

  // 标题生成（原 forkTitleGeneration）：发事件，由 SessionService 落盘
  if (!session.metadata.title) {
    void (async () => {
      try {
        const title = await di.titleProvider.generateTitle(session.conversation);
        if (title) {
          log('title', 'generated', { sessionId: session.sessionId, title });
          remAgent.emitMeta({ type: 'session-title', title });
        }
      } catch {
        log('title', 'failed', { sessionId: session.sessionId });
      }
    })();
  }

  return remAgent;
}
```

`packages/core-v2/src/index.ts`：

```typescript
export { EventQueue } from './event-queue.js';
export type { PiAgentLike } from './pi-agent-like.js';
export type { REMAgentEvent } from './rem-agent-event.js';
export { REMAgent, type REMAgentStatus, type REMAgentParams } from './rem-agent.js';
export {
  createDelegateTaskExecutorV2,
  createDelegateTaskToolDefinitionV2,
  type DelegateTaskExecutorV2Params,
  type DelegateTaskInputV2,
  type SpawnChild,
} from './delegate-task-v2.js';
export {
  createREMAgent,
  type ApprovalStateLike,
  type CreateREMAgentParams,
} from './create-rem-agent.js';
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run packages/core-v2/tests/`
Expected: 全部通过

- [ ] **Step 5: typecheck + Commit**

Run: `pnpm --filter rem-agent-core-v2 typecheck`

```bash
git add packages/core-v2/src packages/core-v2/tests
git commit -m "feat(core-v2): add createREMAgent assembly factory"
```

---

### Task 8: bridge-v2 包骨架

**Files:**
- Create: `packages/bridge-v2/package.json`
- Create: `packages/bridge-v2/tsconfig.json`
- Create: `packages/bridge-v2/src/errors.ts`
- Create: `packages/bridge-v2/src/index.ts`（占位）
- Modify: `vitest.config.ts`（加 alias）

- [ ] **Step 1: package.json**

`packages/bridge-v2/package.json`：

```json
{
  "name": "rem-agent-bridge-v2",
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
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  },
  "dependencies": {
    "@earendil-works/pi-agent-core": "^0.82.1",
    "@earendil-works/pi-ai": "^0.82.1",
    "rem-agent-core": "workspace:*",
    "rem-agent-core-v2": "workspace:*",
    "rem-agent-bridge": "workspace:*"
  },
  "sideEffects": false
}
```

（依赖 `rem-agent-bridge` 是为了复用 `IAgentService` 接口与 `types.ts` 的类型别名，不引用其实现。）

- [ ] **Step 2: tsconfig.json**（与 core-v2 相同内容）

- [ ] **Step 3: errors.ts**（复制 `packages/bridge/src/errors.ts` 的 ServiceError；先读该文件确认内容后照搬）

- [ ] **Step 4: vitest alias**（在 `rem-agent-bridge` 条目之前插入）

```typescript
      { find: 'rem-agent-bridge-v2', replacement: resolve(__dirname, 'packages/bridge-v2/src/index.ts') },
```

- [ ] **Step 5: 安装 + 验证 + Commit**

Run: `pnpm install && pnpm --filter rem-agent-bridge-v2 typecheck`

```bash
git add packages/bridge-v2 vitest.config.ts pnpm-lock.yaml
git commit -m "chore(bridge-v2): scaffold package"
```

---

### Task 9: REMSession

session 级全部内存状态（移植 `AgentLiveState` + `AgentState.applyChunk` 的 snapshot/activity 逻辑），不持有总线，通过注入的 `publish` 回调发 BusEvent。

**Files:**
- Create: `packages/bridge-v2/src/rem-session.ts`
- Test: `packages/bridge-v2/tests/rem-session.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/bridge-v2/tests/rem-session.test.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import type { BusEvent } from 'rem-agent-core';
import type { REMAgentEvent } from 'rem-agent-core-v2';
import { REMSession } from '../src/rem-session.js';

function createSession(): { s: REMSession; events: BusEvent[] } {
  const events: BusEvent[] = [];
  const s = new REMSession({ sessionId: 's-1', workspace: 'default', publish: (e) => events.push(e) });
  return { s, events };
}

describe('REMSession', () => {
  it('startRun 置 running 并发 session-start / activity-change', () => {
    const { s, events } = createSession();
    const controller = s.startRun();
    expect(s.status).toBe('running');
    expect(controller).toBeInstanceOf(AbortController);
    expect(events.map((e) => e.type)).toEqual(['session-start', 'activity-change']);
  });

  it('running 中重复 startRun 抛错', () => {
    const { s } = createSession();
    s.startRun();
    expect(() => s.startRun()).toThrow('already running');
  });

  it('finishRun 发 session-end 并复位状态（幂等）', () => {
    const { s, events } = createSession();
    s.startRun();
    s.finishRun();
    s.finishRun();
    expect(s.status).toBe('idle');
    expect(s.runController).toBeUndefined();
    expect(events.filter((e) => e.type === 'session-end')).toHaveLength(1);
  });

  it('finishRun(error) 发 session-error 并置 error', () => {
    const { s, events } = createSession();
    s.startRun();
    s.finishRun('boom');
    expect(s.status).toBe('error');
    expect(events.some((e) => e.type === 'session-error' && e.error === 'boom')).toBe(true);
  });

  it('applyEvent: turn_start → activity pending 并返回 activity-change', () => {
    const { s } = createSession();
    s.startRun();
    const out = s.applyEvent('root', { type: 'turn_start' } as unknown as REMAgentEvent);
    // startRun 已置 pending，turn_start 不变 → 无新事件
    expect(out).toEqual([]);
    const out2 = s.applyEvent('root', {
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 't', partial: {} },
    } as unknown as REMAgentEvent);
    expect(s.activity).toBe('thinking');
    expect(out2).toEqual([{ workspace: 'default', sessionId: 's-1', type: 'activity-change', activity: 'thinking' }]);
  });

  it('applyEvent: assistant message_start 建 snapshot，message_update 追加 parts', () => {
    const { s } = createSession();
    s.startRun();
    s.applyEvent('root', { type: 'message_start', message: { role: 'assistant' } } as unknown as REMAgentEvent);
    expect(s.streamingSnapshot).toBeTruthy();
    s.applyEvent('root', {
      type: 'message_update',
      assistantMessageEvent: {
        type: 'text_delta', contentIndex: 0, delta: 'hi',
        partial: { content: [{ type: 'text', text: 'hi' }] },
      },
    } as unknown as REMAgentEvent);
    expect(s.getSnapshotParts().length).toBeGreaterThan(0);
  });

  it('addTokenUsage 累计；restoreTokenUsage 从历史恢复', () => {
    const { s } = createSession();
    s.addTokenUsage({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
    expect(s.tokenUsage.totalTokens).toBe(2);
    const { s: s2 } = createSession();
    s2.restoreTokenUsage([
      { input: 5, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, runAt: new Date(), turns: [] },
    ]);
    expect(s2.tokenUsage.totalTokens).toBe(10);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run packages/bridge-v2/tests/rem-session.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 REMSession**

`packages/bridge-v2/src/rem-session.ts`（逻辑移植自 `packages/core/src/state.ts:30-248` 与 `packages/core/src/agent-state.ts:114-157,204-215`，去 EventBus、加 publish 回调）：

```typescript
import type { TextContent, ThinkingContent, ToolCall, Usage } from '@earendil-works/pi-ai';
import type { AssistantMessageEvent } from '@earendil-works/pi-ai';
import type { ApprovalRequest, BusEvent, SessionActivity, StreamingSnapshot } from 'rem-agent-core';
import {
  ApprovalEngine, IterationBudget, addUsage, compactContentBlocks, emptyUsage,
  generateId, normalizeUsageDetail, reduceStreamEvent, type TokenUsageDetail,
} from 'rem-agent-core';
import type { REMAgent, REMAgentEvent } from 'rem-agent-core-v2';

export type REMSessionStatus = 'idle' | 'running' | 'error';

export interface REMSessionParams {
  sessionId: string;
  workspace: string;
  publish: (event: BusEvent) => void;
}

/**
 * session 级全部内存状态（替代全局单例 AgentState）。
 * 状态迁移通过 publish 回调直接发 BusEvent（session-start/end/error/activity-change）。
 */
export class REMSession {
  readonly sessionId: string;
  readonly workspace: string;
  agents: REMAgent[] = [];

  status: REMSessionStatus = 'idle';
  budget = new IterationBudget({ maxTurns: 60 });
  activity: SessionActivity = 'idle';
  pendingToolCalls = new Set<string>();
  pendingApprovals: ApprovalRequest[] = [];
  readonly approvalEngine = new ApprovalEngine('');
  tokenUsage: Usage = emptyUsage();
  runController?: AbortController;
  streamingSnapshot?: StreamingSnapshot;

  private readonly publish: (event: BusEvent) => void;

  constructor(params: REMSessionParams) {
    this.sessionId = params.sessionId;
    this.workspace = params.workspace;
    this.publish = params.publish;
  }

  // ---- 运行生命周期 ----

  startRun(): AbortController {
    if (this.status === 'running') {
      throw new Error(`Session "${this.sessionId}" is already running`);
    }
    const controller = new AbortController();
    this.runController = controller;
    this.status = 'running';
    this.streamingSnapshot = undefined;
    this.activity = 'pending';
    this.publish({ workspace: this.workspace, sessionId: this.sessionId, type: 'session-start' });
    this.publish({ workspace: this.workspace, sessionId: this.sessionId, type: 'activity-change', activity: 'pending' });
    return controller;
  }

  finishRun(error?: string): void {
    if (this.status !== 'running') return;
    if (error) {
      this.publish({ workspace: this.workspace, sessionId: this.sessionId, type: 'session-error', error });
      this.status = 'error';
    } else {
      this.publish({ workspace: this.workspace, sessionId: this.sessionId, type: 'session-end' });
      this.status = 'idle';
    }
    this.activity = 'idle';
    this.pendingToolCalls.clear();
    this.streamingSnapshot = undefined;
    this.runController = undefined;
  }

  // ---- 事件应用（port of AgentLiveState.applyChunk + AgentState snapshot 逻辑）----

  /** 返回需要发布的 BusEvent（activity-change）；chunk 由调用方发 */
  applyEvent(_agentId: string, event: REMAgentEvent): BusEvent[] {
    const out: BusEvent[] = [];

    // snapshot 维护
    if (event.type === 'message_start') {
      if ((event.message as { role?: string }).role === 'assistant') {
        this.streamingSnapshot = { messageId: generateId(), parts: [] };
      }
    } else if (event.type === 'message_update' && this.streamingSnapshot) {
      try {
        this.streamingSnapshot.parts = reduceStreamEvent(this.streamingSnapshot.parts, event.assistantMessageEvent);
      } catch {
        // snapshot best-effort
      }
    }

    const prev = this.activity;
    this.updateActivity(event);
    if (this.activity !== prev) {
      out.push({
        workspace: this.workspace,
        sessionId: this.sessionId,
        type: 'activity-change',
        activity: this.activity,
      });
    }
    return out;
  }

  private updateActivity(event: REMAgentEvent): void {
    if (event.type === 'finish' || event.type === 'error') {
      this.activity = 'idle';
      this.pendingToolCalls.clear();
    } else if (event.type === 'turn_start') {
      this.activity = 'pending';
    } else if (event.type === 'turn_end') {
      this.activity = 'idle';
      this.pendingToolCalls.clear();
    } else if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end') {
      this.activity = 'calling-function';
    } else if (event.type === 'message_update') {
      this.applyAssistantEvent(event.assistantMessageEvent);
    }
  }

  private applyAssistantEvent(event: AssistantMessageEvent): void {
    if (event.type === 'thinking_delta' || event.type === 'thinking_start') {
      this.activity = 'thinking';
    } else if (event.type === 'toolcall_start') {
      this.activity = 'calling-function';
      const block = event.partial.content?.[event.contentIndex];
      if (block?.type === 'toolCall') {
        this.pendingToolCalls.add(block.id ?? 'unknown');
      }
    } else if (event.type === 'toolcall_end') {
      this.activity = 'calling-function';
      this.pendingToolCalls.add(event.toolCall.id ?? 'unknown');
    } else if (event.type === 'text_delta' || event.type === 'text_start') {
      if (this.status === 'running' && this.pendingToolCalls.size === 0) {
        this.activity = 'outputting';
      }
    } else if (event.type === 'text_end' || event.type === 'thinking_end') {
      this.activity = this.pendingToolCalls.size > 0 ? 'calling-function' : 'idle';
    }
  }

  // ---- usage ----

  addTokenUsage(usage: Usage): void {
    this.tokenUsage = addUsage(this.tokenUsage, usage);
  }

  restoreTokenUsage(history: TokenUsageDetail[]): void {
    this.tokenUsage = history
      .map((detail) => normalizeUsageDetail(detail))
      .reduce((acc, detail) => addUsage(acc, detail), emptyUsage());
  }

  // ---- snapshot ----

  getSnapshot(): StreamingSnapshot | undefined {
    return this.streamingSnapshot;
  }

  getSnapshotParts(): Array<TextContent | ThinkingContent | ToolCall> {
    return this.streamingSnapshot ? compactContentBlocks(this.streamingSnapshot.parts) : [];
  }
}
```

注意：`StreamingSnapshot` 从 'rem-agent-core' 导入（state.ts:13 定义并经 index 导出）；若类型导出不全，改为在 rem-session.ts 本地声明 `interface SnapshotParts { messageId: string; parts: Array<TextContent | ThinkingContent | ToolCall | undefined> }`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run packages/bridge-v2/tests/rem-session.test.ts`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add packages/bridge-v2/src/rem-session.ts packages/bridge-v2/tests/rem-session.test.ts
git commit -m "feat(bridge-v2): add REMSession in-memory session state"
```

---

### Task 10: REMSessions 管理器

**Files:**
- Create: `packages/bridge-v2/src/rem-sessions.ts`
- Test: `packages/bridge-v2/tests/rem-sessions.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/bridge-v2/tests/rem-sessions.test.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import { REMSessions } from '../src/rem-sessions.js';

describe('REMSessions', () => {
  const publish = () => {};

  it('getOrCreate 幂等，running() 只列 running 的 session', () => {
    const sessions = new REMSessions(publish);
    const a = sessions.getOrCreate('s-1', 'default');
    const b = sessions.getOrCreate('s-1', 'default');
    const c = sessions.getOrCreate('s-2', 'default');
    expect(a).toBe(b);
    expect(sessions.running()).toEqual([]);
    a.startRun();
    expect(sessions.running().map((s) => s.sessionId)).toEqual(['s-1']);
    c.startRun();
    c.finishRun();
    expect(sessions.running().map((s) => s.sessionId)).toEqual(['s-1']);
  });

  it('remove 删除后 get 返回 undefined', () => {
    const sessions = new REMSessions(publish);
    sessions.getOrCreate('s-1', 'default');
    sessions.remove('s-1');
    expect(sessions.get('s-1')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run packages/bridge-v2/tests/rem-sessions.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`packages/bridge-v2/src/rem-sessions.ts`：

```typescript
import type { BusEvent } from 'rem-agent-core';
import { REMSession } from './rem-session.js';

/** Map<sessionId, REMSession> 管理器 */
export class REMSessions {
  private readonly sessions = new Map<string, REMSession>();

  constructor(private readonly publish: (event: BusEvent) => void) {}

  get(sessionId: string): REMSession | undefined {
    return this.sessions.get(sessionId);
  }

  getOrCreate(sessionId: string, workspace: string): REMSession {
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = new REMSession({ sessionId, workspace, publish: this.publish });
      this.sessions.set(sessionId, s);
    }
    return s;
  }

  running(): REMSession[] {
    return [...this.sessions.values()].filter((s) => s.status === 'running');
  }

  remove(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
```

- [ ] **Step 4: 测试通过 + Commit**

Run: `pnpm vitest run packages/bridge-v2/tests/rem-sessions.test.ts`

```bash
git add packages/bridge-v2/src/rem-sessions.ts packages/bridge-v2/tests/rem-sessions.test.ts
git commit -m "feat(bridge-v2): add REMSessions manager"
```

---

### Task 11: SessionService（唯一写入方）

**Files:**
- Create: `packages/bridge-v2/src/session-service.ts`
- Test: `packages/bridge-v2/tests/session-service.test.ts`

- [ ] **Step 1: 写失败测试（用内存 fake）**

`packages/bridge-v2/tests/session-service.test.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import type { AgentDI, Session, SessionSummary } from 'rem-agent-core';
import type { Message, Usage } from '@earendil-works/pi-ai';
import { SessionService } from '../src/session-service.js';

const usage: Usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function makeSession(sessionId: string): Session {
  return { sessionId, conversation: [], currentTurn: 0, metadata: { schemaVersion: 2 }, createdAt: new Date(), updatedAt: new Date() };
}

/** 最小内存 SessionProvider + storage fake */
function createFakeDI() {
  const sessions = new Map<string, Session>();
  const appended: Array<{ sessionId: string; message: Message; messageId: string }> = [];
  const di = {
    sessionProvider: {
      create: async () => { const s = makeSession(`gen-${sessions.size + 1}`); sessions.set(s.sessionId, s); return s; },
      load: async (id: string) => sessions.get(id) ?? null,
      save: async (s: Session) => { sessions.set(s.sessionId, s); },
      delete: async (id: string) => { sessions.delete(id); },
      list: async () => [] as SessionSummary[],
      appendMessage: async (s: Session, message: Message, messageId: string) => {
        s.conversation.push(message);
        appended.push({ sessionId: s.sessionId, message, messageId });
      },
    },
    storage: {
      sessionStore: { listByWorkspace: async () => [] as SessionSummary[] },
      archiveStore: { getLatest: async () => null },
    },
  } as unknown as AgentDI;
  return { di, sessions, appended };
}

describe('SessionService', () => {
  it('loadOrCreate：不存在则创建并写 metadata.workspace', async () => {
    const { di } = createFakeDI();
    const svc = new SessionService(di);
    const created = await svc.loadOrCreate('s-new', 'ws-a');
    expect(created.metadata.workspace).toBe('ws-a');
    const loaded = await svc.loadOrCreate('s-new', 'ws-a');
    expect(loaded).toBe(created);
  });

  it('handleAgentEvent message-persist → appendMessage 落盘', async () => {
    const { di, appended } = createFakeDI();
    const svc = new SessionService(di);
    await svc.loadOrCreate('s-1', 'default');
    const message = { role: 'user', content: 'hi', timestamp: Date.now() } as Message;
    await svc.handleAgentEvent('s-1', { type: 'message-persist', message, messageId: 'm-1' });
    expect(appended).toEqual([{ sessionId: 's-1', message, messageId: 'm-1' }]);
  });

  it('handleAgentEvent usage → tokenUsageHistory + messageTokenUsage', async () => {
    const { di, sessions } = createFakeDI();
    const svc = new SessionService(di);
    await svc.loadOrCreate('s-1', 'default');
    await svc.handleAgentEvent('s-1', { type: 'usage', usage, assistantMessageId: 'm-1' });
    const s = sessions.get('s-1')!;
    expect((s.metadata.tokenUsageHistory as unknown[]).length).toBe(1);
    expect((s.metadata.messageTokenUsage as Record<string, Usage>)['m-1'].totalTokens).toBe(2);
  });

  it('handleAgentEvent session-title / finish → title + currentTurn', async () => {
    const { di, sessions } = createFakeDI();
    const svc = new SessionService(di);
    await svc.loadOrCreate('s-1', 'default');
    await svc.handleAgentEvent('s-1', { type: 'session-title', title: 'T' });
    await svc.handleAgentEvent('s-1', { type: 'finish', output: { content: '', completed: true } });
    const s = sessions.get('s-1')!;
    expect(s.metadata.title).toBe('T');
    expect(s.currentTurn).toBe(1);
  });

  it('createChildSession 写 parent 元数据', async () => {
    const { di } = createFakeDI();
    const svc = new SessionService(di);
    const child = await svc.createChildSession({ parentSessionId: 'p', parentToolCallId: 'tc', workspace: 'w', title: 't' });
    expect(child.metadata.parentSessionId).toBe('p');
    expect(child.metadata.parentToolCallId).toBe('tc');
    expect(child.metadata.workspace).toBe('w');
  });

  it('落盘失败不抛出（best-effort，记日志）', async () => {
    const { di } = createFakeDI();
    di.sessionProvider.appendMessage = async () => { throw new Error('db down'); };
    const svc = new SessionService(di);
    await svc.loadOrCreate('s-1', 'default');
    await expect(
      svc.handleAgentEvent('s-1', { type: 'message-persist', message: {} as Message, messageId: 'm' }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run packages/bridge-v2/tests/session-service.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 SessionService**

`packages/bridge-v2/src/session-service.ts`：

```typescript
import type { AgentDI, Session, SessionInfo, SessionSummary, SessionUpdate, UIMessage, Usage } from 'rem-agent-core';
import { AgentSessionManager, AgentState, SessionNotFoundError, log, normalizeUsage, normalizeUsageDetail, type TokenUsageDetail } from 'rem-agent-core';
import type { REMAgentEvent } from 'rem-agent-core-v2';

/**
 * 会话持久化唯一写入方。
 * 查询（getMessages/update）委托 core 的 AgentSessionManager；
 * 写路径全部来自 handleAgentEvent（REMAgent 产出的事件驱动）。
 */
export class SessionService {
  private readonly di: AgentDI;
  private readonly manager: AgentSessionManager;
  private readonly loaded = new Map<string, Session>();

  constructor(di: AgentDI) {
    this.di = di;
    // AgentSessionManager 仅在 deleteSession 用到 AgentState（我们不委托 delete），
    // 传一个隔离实例即可。
    this.manager = new AgentSessionManager(di.sessionProvider, new AgentState());
  }

  // ---- 加载/创建 ----

  async loadOrCreate(sessionId: string, workspace: string): Promise<Session> {
    const cached = this.loaded.get(sessionId);
    if (cached) return cached;
    let session = await this.di.sessionProvider.load(sessionId);
    if (!session) {
      session = {
        sessionId, conversation: [], currentTurn: 0,
        metadata: { schemaVersion: 2, workspace }, createdAt: new Date(), updatedAt: new Date(),
      };
      await this.di.sessionProvider.save(session);
    } else if (!session.metadata.workspace) {
      session.metadata.workspace = workspace;
      await this.di.sessionProvider.save(session);
    }
    this.loaded.set(sessionId, session);
    return session;
  }

  async createChildSession(params: { parentSessionId: string; parentToolCallId?: string; workspace: string; title: string }): Promise<Session> {
    const child = await this.di.sessionProvider.create();
    child.metadata.parentSessionId = params.parentSessionId;
    child.metadata.parentToolCallId = params.parentToolCallId;
    child.metadata.workspace = params.workspace;
    child.metadata.title = params.title;
    await this.di.sessionProvider.save(child);
    this.loaded.set(child.sessionId, child);
    return child;
  }

  // ---- 事件驱动写路径（best-effort：失败记日志不中断流）----

  async handleAgentEvent(sessionId: string, event: REMAgentEvent): Promise<void> {
    try {
      if (event.type === 'message-persist') {
        const session = await this.requireLoaded(sessionId);
        await this.di.sessionProvider.appendMessage(session, event.message, event.messageId);
      } else if (event.type === 'usage') {
        const session = await this.requireLoaded(sessionId);
        const history = ((session.metadata.tokenUsageHistory as unknown[]) ?? []).map((e) =>
          normalizeUsageDetail(e as TokenUsageDetail));
        history.push({ ...event.usage, runAt: new Date(), turns: [event.usage] });
        session.metadata.tokenUsageHistory = history;
        if (event.assistantMessageId) {
          const mtu: Record<string, Usage> = {};
          for (const [k, v] of Object.entries(session.metadata.messageTokenUsage ?? {})) {
            mtu[k] = normalizeUsage(v as Usage);
          }
          mtu[event.assistantMessageId] = event.usage;
          session.metadata.messageTokenUsage = mtu;
        }
        await this.di.sessionProvider.save(session);
      } else if (event.type === 'session-title') {
        const session = await this.requireLoaded(sessionId);
        session.metadata.title = event.title;
        await this.di.sessionProvider.save(session);
      } else if (event.type === 'compress-end') {
        const session = await this.requireLoaded(sessionId);
        const latest = await this.di.storage.archiveStore.getLatest(sessionId);
        session.metadata.compressionHistory = [
          ...((session.metadata.compressionHistory as unknown[]) ?? []),
          {
            archiveId: event.archiveId,
            version: latest?.version ?? 1,
            compressedAt: new Date().toISOString(),
            removedMessageCount: event.removedMessageCount,
          },
        ];
        await this.di.sessionProvider.save(session);
      } else if (event.type === 'finish') {
        const session = await this.requireLoaded(sessionId);
        session.currentTurn++;
        session.updatedAt = new Date();
        await this.di.sessionProvider.save(session);
      }
    } catch (error) {
      log('session-service', 'persist failed', { sessionId, eventType: event.type, error: String(error) });
    }
  }

  private async requireLoaded(sessionId: string): Promise<Session> {
    const cached = this.loaded.get(sessionId);
    if (cached) return cached;
    const session = await this.di.sessionProvider.load(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    this.loaded.set(sessionId, session);
    return session;
  }

  // ---- 查询（委托 / SQL 过滤）----

  async create(workspace: string): Promise<SessionInfo> {
    return this.manager.createSession(workspace);
  }

  async listByWorkspace(workspace: string): Promise<SessionInfo[]> {
    const summaries: SessionSummary[] = await this.di.storage.sessionStore.listByWorkspace(workspace);
    const enriched = await Promise.all(
      summaries.map(async (s) => {
        const session = await this.di.sessionProvider.load(s.sessionId);
        if (!session) return null;
        return {
          sessionId: s.sessionId,
          workspace,
          title: s.title ?? 'New Chat',
          pinned: s.pinned,
          parentSessionId: session.metadata?.parentSessionId as string | undefined,
          parentToolCallId: session.metadata?.parentToolCallId as string | undefined,
          updatedAt: s.updatedAt.getTime(),
          messageCount: s.messageCount,
          tokenUsage: this.computeTotalTokenUsage(session.metadata?.messageTokenUsage),
        } satisfies SessionInfo;
      }),
    );
    const filtered = enriched.filter((s): s is SessionInfo => s !== null);
    return filtered.sort((a, b) => (a.pinned === b.pinned ? b.updatedAt - a.updatedAt : a.pinned ? -1 : 1));
  }

  async search(workspace: string, q: string): Promise<SessionInfo[]> {
    const all = await this.listByWorkspace(workspace);
    const lower = q.toLowerCase();
    return all.filter((s) => (s.title ?? '').toLowerCase().includes(lower));
  }

  async getMessages(sessionId: string): Promise<UIMessage[]> {
    return this.manager.getMessages(sessionId);
  }

  async update(sessionId: string, updates: SessionUpdate): Promise<void> {
    return this.manager.updateSession(sessionId, updates);
  }

  async delete(sessionId: string): Promise<void> {
    const session = await this.di.sessionProvider.load(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    await this.di.sessionProvider.delete(sessionId);
    this.loaded.delete(sessionId);
  }

  private computeTotalTokenUsage(messageTokenUsage: unknown): Usage | undefined {
    if (!messageTokenUsage || typeof messageTokenUsage !== 'object') return undefined;
    const entries = Object.values(messageTokenUsage).map((e) => normalizeUsage(e as Usage));
    if (entries.length === 0) return undefined;
    return entries.reduce((acc, u) => ({
      input: acc.input + u.input, output: acc.output + u.output,
      cacheRead: acc.cacheRead + u.cacheRead, cacheWrite: acc.cacheWrite + u.cacheWrite,
      totalTokens: acc.totalTokens + u.totalTokens,
      cost: {
        input: acc.cost.input + u.cost.input, output: acc.cost.output + u.cost.output,
        cacheRead: acc.cost.cacheRead + u.cost.cacheRead, cacheWrite: acc.cost.cacheWrite + u.cost.cacheWrite,
        total: acc.cost.total + u.cost.total,
      },
    }));
  }
}
```

注意：`SessionInfo`/`SessionSummary` 的字段名以 `packages/core/src/session-manager/types.ts` 为准，若 `pinned`/`messageCount` 为可选需对齐；`Usage` 的 cost 结构若不含 `total` 字段按实际类型调整（参考 `packages/core/src/token-usage.ts` 的 `addUsage`，也可以直接复用 `addUsage`：`entries.reduce((acc, u) => addUsage(acc, u), emptyUsage())`，更简洁，采用这种方式替换 computeTotalTokenUsage 的手动 reduce）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run packages/bridge-v2/tests/session-service.test.ts`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add packages/bridge-v2/src/session-service.ts packages/bridge-v2/tests/session-service.test.ts
git commit -m "feat(bridge-v2): add SessionService as single persistence writer"
```

---

### Task 12: WorkspaceService

**Files:**
- Create: `packages/bridge-v2/src/workspace-service.ts`
- Test: `packages/bridge-v2/tests/workspace-service.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/bridge-v2/tests/workspace-service.test.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentDI, WorkspaceRecord } from 'rem-agent-core';
import { WorkspaceService } from '../src/workspace-service.js';

function createFakeDI() {
  const records: WorkspaceRecord[] = [];
  const di = {
    configProvider: { forWorkspace: undefined },
    storage: {
      workspaceStore: {
        list: async () => records,
        add: async (path: string) => { const r = { path, createdAt: new Date() } as WorkspaceRecord; records.push(r); return r; },
        remove: async (path: string) => { const i = records.findIndex((r) => r.path === path); if (i >= 0) records.splice(i, 1); },
      },
    },
  } as unknown as AgentDI;
  return { di, records };
}

describe('WorkspaceService', () => {
  it('add/list/remove（add 校验目录存在）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ws-test-'));
    const { di } = createFakeDI();
    const svc = new WorkspaceService(di);
    await svc.add(dir);
    expect(await svc.list()).toHaveLength(1);
    await svc.remove(dir);
    expect(await svc.list()).toHaveLength(0);
    await rm(dir, { recursive: true, force: true });
  });

  it('add 不存在目录抛错', async () => {
    const { di } = createFakeDI();
    const svc = new WorkspaceService(di);
    await expect(svc.add('/no/such/dir/xyz')).rejects.toThrow('Workspace path');
  });

  it('resolveConfig 无 forWorkspace 时返回原 configProvider', () => {
    const { di } = createFakeDI();
    const svc = new WorkspaceService(di);
    expect(svc.resolveConfig('any')).toBe(di.configProvider);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run packages/bridge-v2/tests/workspace-service.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`packages/bridge-v2/src/workspace-service.ts`（移植 `packages/bridge/src/agent.ts:41-69`）：

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentDI, ConfigProvider, WorkspaceRecord } from 'rem-agent-core';

export class WorkspaceService {
  constructor(private readonly di: AgentDI) {}

  async list(): Promise<WorkspaceRecord[]> {
    return this.di.storage.workspaceStore.list();
  }

  async add(rawPath: string): Promise<WorkspaceRecord> {
    return this.di.storage.workspaceStore.add(await this.resolveDir(rawPath));
  }

  async remove(rawPath: string): Promise<void> {
    return this.di.storage.workspaceStore.remove(path.resolve(rawPath));
  }

  /** workspace 级配置解析（forWorkspace 收敛到这里） */
  resolveConfig(workspace: string): ConfigProvider {
    return this.di.configProvider.forWorkspace?.(workspace) ?? this.di.configProvider;
  }

  private async resolveDir(rawPath: string): Promise<string> {
    const absolutePath = path.resolve(rawPath);
    try {
      const stat = await fs.stat(absolutePath);
      if (!stat.isDirectory()) {
        throw new Error(`Workspace path is not a directory: ${absolutePath}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Workspace path does not exist or is not readable: ${absolutePath} (${message})`);
    }
    return absolutePath;
  }
}
```

- [ ] **Step 4: 测试通过 + Commit**

Run: `pnpm vitest run packages/bridge-v2/tests/workspace-service.test.ts`

```bash
git add packages/bridge-v2/src/workspace-service.ts packages/bridge-v2/tests/workspace-service.test.ts
git commit -m "feat(bridge-v2): add WorkspaceService"
```

---

### Task 13: AgentService（三路分发）

**Files:**
- Create: `packages/bridge-v2/src/agent-service.ts`
- Test: `packages/bridge-v2/tests/agent-service.test.ts`

- [ ] **Step 1: 写失败测试**

`packages/bridge-v2/tests/agent-service.test.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, Message } from '@earendil-works/pi-ai';
import type { BusEvent } from 'rem-agent-core';
import { REMAgent, type PiAgentLike } from 'rem-agent-core-v2';
import { AgentService } from '../src/agent-service.js';
import { REMSession } from '../src/rem-session.js';
import type { SessionService } from '../src/session-service.js';

function doneAssistant(text: string): AssistantMessage {
  return {
    role: 'assistant', api: 'openai-completions', provider: 'mock', model: 'm',
    content: [{ type: 'text', text }],
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop', timestamp: Date.now(),
  } as AssistantMessage;
}

class FakePiAgent implements PiAgentLike {
  private listeners: Array<(e: AgentEvent) => void> = [];
  constructor(private script: (emit: (e: AgentEvent) => void) => void) {}
  subscribe(l: (e: AgentEvent) => void): () => void { this.listeners.push(l); return () => {}; }
  async prompt(_m: Message): Promise<void> { this.script((e) => this.listeners.forEach((l) => void l(e))); }
  steer(): void {}
  followUp(): void {}
  abort(): void {}
}

function setup() {
  const busEvents: BusEvent[] = [];
  const persisted: string[] = [];
  const sessionService = {
    handleAgentEvent: async (_sid: string, event: { type: string }) => { persisted.push(event.type); },
  } as unknown as SessionService;
  const remSession = new REMSession({ sessionId: 's-1', workspace: 'default', publish: (e) => busEvents.push(e) });
  const service = new AgentService({ sessionService, publish: (e) => busEvents.push(e) });
  return { busEvents, persisted, remSession, service };
}

describe('AgentService', () => {
  it('run：三路分发（状态/落盘/总线），root finish 结束 run', async () => {
    const { busEvents, persisted, remSession, service } = setup();
    remSession.startRun();
    const agent = new REMAgent({
      agentId: 'root', sessionId: 's-1',
      agent: new FakePiAgent((emit) => {
        const a = doneAssistant('hi');
        emit({ type: 'message_end', message: a } as AgentEvent);
        emit({ type: 'turn_end', message: a } as AgentEvent);
      }),
    });

    service.run(remSession, agent, { content: 'hi' });
    await agent.output;
    // 等 drive 循环消费完
    await new Promise((r) => setTimeout(r, 10));

    expect(persisted).toContain('message-persist');
    expect(persisted).toContain('usage');
    expect(persisted).toContain('finish');
    // message-persist / usage 是内部事件，不作为 chunk 上总线
    const chunkTypes = busEvents.filter((e) => e.type === 'chunk').map((e) => e.chunk.type);
    expect(chunkTypes).not.toContain('message-persist');
    expect(chunkTypes).not.toContain('usage');
    expect(busEvents.some((e) => e.type === 'usage-change')).toBe(true);
    expect(busEvents.some((e) => e.type === 'session-end')).toBe(true);
    expect(remSession.status).toBe('idle');
    expect(remSession.tokenUsage.totalTokens).toBe(2);
  });

  it('listen：子 Agent 结束后发 child-agent-update', async () => {
    const { busEvents, remSession, service } = setup();
    remSession.startRun();
    const child = new REMAgent({
      agentId: 'root.delegate-0', sessionId: 'child-s', summary: 'task x',
      agent: new FakePiAgent((emit) => {
        const a = doneAssistant('child done');
        emit({ type: 'message_end', message: a } as AgentEvent);
        emit({ type: 'turn_end', message: a } as AgentEvent);
      }),
    });
    child.parentToolCallId = 'tc-1';

    // 模拟 delegate executor 已启动 child.run
    const drain = (async () => { for await (const _ of child.run({ content: 'x' })) {} })();
    service.listen(remSession, child);
    await drain;
    await new Promise((r) => setTimeout(r, 10));

    const update = busEvents.find((e) => e.type === 'child-agent-update');
    expect(update).toMatchObject({ childSessionId: 'child-s', toolCallId: 'tc-1', status: 'completed', summary: 'task x' });
    // 子 Agent finish 不结束 session run
    expect(remSession.status).toBe('running');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run packages/bridge-v2/tests/agent-service.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 AgentService**

`packages/bridge-v2/src/agent-service.ts`：

```typescript
import type { BusEvent } from 'rem-agent-core';
import { log, type UserInput } from 'rem-agent-core';
import type { REMAgent, REMAgentEvent } from 'rem-agent-core-v2';
import type { REMSession } from './rem-session.js';
import type { SessionService } from './session-service.js';

export interface AgentServiceDeps {
  sessionService: SessionService;
  publish: (event: BusEvent) => void;
}

/** 仅 Agent 的运行和监听：消费 REMAgent 事件流并做三路分发 */
export class AgentService {
  constructor(private readonly deps: AgentServiceDeps) {}

  /** 启动 root agent 的一次 run（后台驱动，立即返回） */
  run(session: REMSession, agent: REMAgent, input: UserInput): void {
    const events = agent.run(input);
    void this.drive(session, agent, events, true);
  }

  /** 监听已在运行的 agent（child-spawned 触发，递归覆盖 children） */
  listen(session: REMSession, agent: REMAgent): void {
    if (!agent.events) return;
    void this.drive(session, agent, agent.events, false);
  }

  private async drive(session: REMSession, agent: REMAgent, events: AsyncIterable<REMAgentEvent>, isRoot: boolean): Promise<void> {
    const { sessionService, publish } = this.deps;
    const ws = session.workspace;
    const sid = session.sessionId;
    log('agent-service', 'drive start', { sessionId: sid, agentId: agent.agentId, isRoot });
    try {
      for await (const event of events) {
        // ① 内部事件：落盘 / 聚合，不上总线
        if (event.type === 'message-persist') {
          await sessionService.handleAgentEvent(agent.sessionId ?? sid, event);
          continue;
        }
        if (event.type === 'usage') {
          session.addTokenUsage(event.usage);
          publish({ workspace: ws, sessionId: sid, type: 'usage-change', usage: session.tokenUsage });
          await sessionService.handleAgentEvent(agent.sessionId ?? sid, event);
          continue;
        }
        if (event.type === 'child-spawned') {
          this.listen(session, event.child);
          publish({
            workspace: ws, sessionId: sid, type: 'child-agent-update',
            childSessionId: event.child.sessionId ?? '',
            toolCallId: event.parentToolCallId,
            summary: event.child.summary ?? '',
            status: 'running',
          });
          continue;
        }

        // ② 内存状态 + ③ 总线 chunk
        for (const e of session.applyEvent(agent.agentId, event)) publish(e);
        publish({ workspace: ws, sessionId: sid, type: 'chunk', chunk: event, agentId: agent.agentId });

        if (event.type === 'session-title' || event.type === 'compress-end') {
          await sessionService.handleAgentEvent(agent.sessionId ?? sid, event);
        }
        if (isRoot && event.type === 'finish') {
          await sessionService.handleAgentEvent(sid, event);
          session.finishRun();
        } else if (isRoot && event.type === 'error') {
          session.finishRun(event.error.message);
        }
      }

      if (!isRoot) {
        publish({
          workspace: ws, sessionId: sid, type: 'child-agent-update',
          childSessionId: agent.sessionId ?? '',
          toolCallId: agent.parentToolCallId,
          summary: agent.summary ?? '',
          status: agent.status === 'error' ? 'failed' : 'completed',
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log('agent-service', 'drive failed', { sessionId: sid, agentId: agent.agentId, error: message });
      if (isRoot) {
        session.finishRun(message);
      } else {
        publish({
          workspace: ws, sessionId: sid, type: 'child-agent-update',
          childSessionId: agent.sessionId ?? '',
          toolCallId: agent.parentToolCallId,
          summary: agent.summary ?? '',
          status: 'failed',
        });
      }
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run packages/bridge-v2/tests/agent-service.test.ts`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add packages/bridge-v2/src/agent-service.ts packages/bridge-v2/tests/agent-service.test.ts
git commit -m "feat(bridge-v2): add AgentService run/listen with three-way dispatch"
```

---

### Task 14: AgentsUniService（对外门面）

**Files:**
- Create: `packages/bridge-v2/src/agents-uni-service.ts`
- Create: `packages/bridge-v2/src/index.ts`
- Test helper: `packages/bridge-v2/tests/helpers/test-service.ts`
- Test: `packages/bridge-v2/tests/agents-uni-service.test.ts`

- [ ] **Step 1: 写测试 helper**

`packages/bridge-v2/tests/helpers/test-service.ts`（模式复制自 `packages/bridge/tests/agent-service/shared.ts` 与 `mock-config-provider.ts`，改为装配 AgentsUniService）：

```typescript
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgentAssembly, createDefaultAgentPaths, initializeAgentDI } from 'rem-agent-core';
import type { AgentContextBuildOptions, BusEvent } from 'rem-agent-core';
import { AgentsUniService } from '../../src/agents-uni-service.js';
import { createMockModels, type MockProviderConfig } from './mock-models.js';
import { StaticConfigProvider } from './static-config-provider.js';

export const DEFAULT_WORKSPACE = 'default';

export interface TestService {
  service: AgentsUniService;
  dir: string;
  cleanup: () => Promise<void>;
}

export async function createTestService(options: {
  workspace?: string;
  provider?: MockProviderConfig;
  agentOptions?: Partial<AgentContextBuildOptions>;
} = {}): Promise<TestService> {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-v2-test-'));
  const paths = createDefaultAgentPaths({ agentDir: dir, homeAgentDir: dir });
  const models = createMockModels(options.provider ?? { name: 'mock-default' });
  const workspace = options.workspace ?? DEFAULT_WORKSPACE;

  const configProvider = new StaticConfigProvider({
    provider: options.provider?.name ?? 'mock-default',
    model: 'mock-model',
    apiKey: 'mock-key',
    name: 'TestAgent',
  });

  const { di, runtimeConfig } = createAgentAssembly({ paths, configProvider, models, ...options.agentOptions });
  await initializeAgentDI(di, { skipMcp: true });

  const service = new AgentsUniService(di, runtimeConfig);
  await di.storage.workspaceStore.add(workspace).catch(() => {});

  return { service, dir, cleanup: async () => rm(dir, { recursive: true, force: true }) };
}

/** 订阅总线直到 predicate 命中或超时 */
export async function waitForBusEvent(
  service: AgentsUniService,
  predicate: (e: BusEvent) => boolean,
  timeoutMs = 5000,
): Promise<BusEvent> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    for await (const event of service.stream(ac.signal)) {
      if (predicate(event)) return event;
    }
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
  throw new Error('waitForBusEvent timeout');
}
```

把 `packages/bridge/tests/agent-service/shared.ts` 中 `MockEventStream` / `createMockProvider` / `createMockModels`（shared.ts:21-167）完整复制为 `packages/bridge-v2/tests/helpers/mock-models.ts`（去掉 AgentService 相关部分）；把 `packages/bridge/tests/agent-service/mock-config-provider.ts` 完整复制为 `packages/bridge-v2/tests/helpers/static-config-provider.ts`。

- [ ] **Step 2: 写失败测试**

`packages/bridge-v2/tests/agents-uni-service.test.ts`：

```typescript
import { afterEach, describe, expect, it } from 'vitest';
import { createTestService, waitForBusEvent, DEFAULT_WORKSPACE, type TestService } from './helpers/test-service.js';

let ctx: TestService | undefined;
afterEach(async () => { await ctx?.cleanup(); ctx = undefined; });

describe('AgentsUniService', () => {
  it('createSession / listSessions 按 workspace 隔离', async () => {
    ctx = await createTestService();
    const s = await ctx.service.createSession(DEFAULT_WORKSPACE);
    expect(s.workspace).toBe(DEFAULT_WORKSPACE);
    const list = await ctx.service.listSessions(DEFAULT_WORKSPACE);
    expect(list.some((x) => x.sessionId === s.sessionId)).toBe(true);
    const other = await ctx.service.listSessions('nonexistent-ws');
    expect(other).toEqual([]);
  });

  it('run 完整链路：session-start → chunk → session-end，消息落盘可查', async () => {
    ctx = await createTestService();
    const s = await ctx.service.createSession(DEFAULT_WORKSPACE);

    const endPromise = waitForBusEvent(ctx.service, (e) => e.type === 'session-end' && e.sessionId === s.sessionId);
    await ctx.service.run(DEFAULT_WORKSPACE, s.sessionId, 'hello');
    await endPromise;

    const messages = await ctx.service.getMessages(DEFAULT_WORKSPACE, s.sessionId);
    expect(messages.some((m) => m.role === 'user')).toBe(true);
    expect(messages.some((m) => m.role === 'assistant')).toBe(true);
  }, 15000);

  it('running 中重复 run 抛 409', async () => {
    ctx = await createTestService();
    const s = await ctx.service.createSession(DEFAULT_WORKSPACE);
    // mock provider 立即完成，用手动 gate 让 run 保持 running 较麻烦；
    // 改为直接断言 sessions 状态机：先占住 running
    const remSession = ctx.service.sessions.getOrCreate(s.sessionId, DEFAULT_WORKSPACE);
    remSession.startRun();
    await expect(ctx.service.run(DEFAULT_WORKSPACE, s.sessionId, 'hi')).rejects.toMatchObject({ statusCode: 409 });
  });

  it('steer/followUp 非 running 抛 409；interrupt/reset 不抛', async () => {
    ctx = await createTestService();
    const s = await ctx.service.createSession(DEFAULT_WORKSPACE);
    await expect(ctx.service.steer(DEFAULT_WORKSPACE, s.sessionId, 'x')).rejects.toMatchObject({ statusCode: 409 });
    await expect(ctx.service.followUp(DEFAULT_WORKSPACE, s.sessionId, 'x')).rejects.toMatchObject({ statusCode: 409 });
    await expect(ctx.service.interrupt(DEFAULT_WORKSPACE, s.sessionId)).resolves.toBeUndefined();
    await expect(ctx.service.reset(DEFAULT_WORKSPACE, s.sessionId)).resolves.toBeUndefined();
  });

  it('deleteSession 后可清理内存状态；getMessages 404', async () => {
    ctx = await createTestService();
    const s = await ctx.service.createSession(DEFAULT_WORKSPACE);
    ctx.service.sessions.getOrCreate(s.sessionId, DEFAULT_WORKSPACE);
    await ctx.service.deleteSession(DEFAULT_WORKSPACE, s.sessionId);
    expect(ctx.service.sessions.get(s.sessionId)).toBeUndefined();
    await expect(ctx.service.getMessages(DEFAULT_WORKSPACE, s.sessionId)).rejects.toMatchObject({ statusCode: 404 });
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm vitest run packages/bridge-v2/tests/agents-uni-service.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现 AgentsUniService**

`packages/bridge-v2/src/agents-uni-service.ts`（方法对齐 `packages/bridge/src/agent.ts`，接口类型来自 `packages/bridge/src/agent-service.interface.ts`）：

```typescript
import type {
  AgentDI, AgentRuntimeConfig, ApprovalDecision, ApprovalRequest, Rule,
  TodoItem, UserInputContent,
} from 'rem-agent-core';
import { BroadcastBus, DefaultTodoService, SessionNotFoundError, buildChildContext, log, type BusEvent, type SessionInfo, type SessionUpdate, type TokenUsageDetail, type UIMessage, type WorkspaceRecord } from 'rem-agent-core';
import { compactContentBlocks } from 'rem-agent-core/stream/event-aggregators';
import type { TextContent, ThinkingContent, ToolCall } from 'rem-agent-core';
import { createREMAgent, type REMAgent, type DelegateTaskInputV2 } from 'rem-agent-core-v2';
import type { ToolContext } from 'rem-agent-core';
import type { IAgentService } from 'rem-agent-bridge';
import { REMSessions } from './rem-sessions.js';
import type { REMSession } from './rem-session.js';
import { SessionService } from './session-service.js';
import { WorkspaceService } from './workspace-service.js';
import { AgentService } from './agent-service.js';
import { ServiceError } from './errors.js';

export class AgentsUniService implements IAgentService {
  readonly sessions: REMSessions;
  readonly sessionService: SessionService;
  readonly workspaceService: WorkspaceService;
  readonly agentService: AgentService;

  private readonly bus = new BroadcastBus();

  constructor(
    private readonly di: AgentDI,
    private readonly runtimeConfig: AgentRuntimeConfig,
  ) {
    const publish = (e: BusEvent) => this.bus.publish(e);
    this.sessions = new REMSessions(publish);
    this.sessionService = new SessionService(di);
    this.workspaceService = new WorkspaceService(di);
    this.agentService = new AgentService({ sessionService: this.sessionService, publish });
  }

  /* ---- Workspace ---- */

  listWorkspaces(): Promise<WorkspaceRecord[]> { return this.workspaceService.list(); }
  addWorkspace(path: string): Promise<WorkspaceRecord> { return this.workspaceService.add(path); }
  removeWorkspace(path: string): Promise<void> { return this.workspaceService.remove(path); }

  /* ---- 运行控制 ---- */

  async run(workspace: string, sessionId: string, input: UserInputContent): Promise<void> {
    const existing = this.sessions.get(sessionId);
    if (existing?.status === 'running') {
      throw new ServiceError('Session is already running', 409);
    }

    const session = await this.sessionService.loadOrCreate(sessionId, workspace);
    const remSession = this.sessions.getOrCreate(sessionId, workspace);
    const controller = remSession.startRun();
    log('uni', 'run started', { sessionId, workspace });

    // 恢复累计 token usage（原 runAgent 行为）
    if (remSession.tokenUsage.totalTokens === 0) {
      const history = ((session.metadata.tokenUsageHistory as unknown[]) ?? []) as TokenUsageDetail[];
      if (history.length > 0) remSession.restoreTokenUsage(history);
    }

    if (!remSession.budget.hasBudget() || !this.di.budgetPolicy.checkTimeout(Date.now())) {
      remSession.finishRun('Budget exceeded.');
      return;
    }

    try {
      const remAgent = await createREMAgent({
        di: this.di,
        runtimeConfig: this.runtimeConfig,
        session,
        workspace,
        workspaceRoot: workspace,
        agentId: 'root',
        sessionId,
        signal: controller.signal,
        approvalState: { getOrCreate: () => remSession },
        publishBus: (e) => this.bus.publish(e),
        spawnChild: (childInput, toolCtx) => this.spawnChild(remSession, 'root', childInput, toolCtx),
      });
      remSession.agents.push(remAgent);
      this.agentService.run(remSession, remAgent, { content: input, timestamp: new Date() });
    } catch (err) {
      remSession.finishRun(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  private async spawnChild(remSession: REMSession, parentAgentId: string, input: DelegateTaskInputV2, toolCtx: ToolContext): Promise<REMAgent> {
    const childSession = await this.sessionService.createChildSession({
      parentSessionId: remSession.sessionId,
      parentToolCallId: toolCtx.toolCallId,
      workspace: remSession.workspace,
      title: input.task.slice(0, 50),
    });
    const child = buildChildContext(this.di, this.runtimeConfig, {
      maxTurns: input.maxTurns,
      systemPrompt: input.systemPrompt,
    });
    const childAgentId = `${parentAgentId}.delegate-${remSession.agents.length}`;
    const remAgent = await createREMAgent({
      di: child.di,
      runtimeConfig: child.runtimeConfig,
      session: childSession,
      workspace: remSession.workspace,
      workspaceRoot: toolCtx.workspaceRoot,
      agentId: childAgentId,
      sessionId: childSession.sessionId,
      summary: input.task,
      signal: toolCtx.signal,
      approvalState: { getOrCreate: () => remSession },
      publishBus: (e) => this.bus.publish(e),
      spawnChild: (grandInput, grandCtx) => this.spawnChild(remSession, childAgentId, grandInput, grandCtx),
    });
    remSession.agents.push(remAgent);
    return remAgent;
  }

  private rootAgent(sessionId: string): REMAgent {
    const remSession = this.sessions.get(sessionId);
    const root = remSession?.agents[0];
    if (!remSession || remSession.status !== 'running' || !root) {
      throw new ServiceError('Session is not running', 409);
    }
    return root;
  }

  async steer(_workspace: string, sessionId: string, input: UserInputContent): Promise<void> {
    this.rootAgent(sessionId).steer(input);
  }

  async followUp(_workspace: string, sessionId: string, input: UserInputContent): Promise<void> {
    this.rootAgent(sessionId).followUp(input);
  }

  async interrupt(_workspace: string, sessionId: string): Promise<void> {
    log('uni', 'interrupt requested', { sessionId });
    this.sessions.get(sessionId)?.runController?.abort();
  }

  async reset(_workspace: string, sessionId: string): Promise<void> {
    log('uni', 'reset requested', { sessionId });
    const remSession = this.sessions.get(sessionId);
    remSession?.runController?.abort();
    remSession?.finishRun();
  }

  /* ---- Session 查询 ---- */

  async createSession(workspace: string): Promise<SessionInfo> {
    return this.sessionService.create(workspace);
  }

  async listSessions(workspace: string): Promise<SessionInfo[]> {
    const list = await this.sessionService.listByWorkspace(workspace);
    return list.map((s) => ({
      ...s,
      activity: this.sessions.get(s.sessionId)?.activity ?? 'idle',
    }));
  }

  async searchSessions(workspace: string, q: string): Promise<SessionInfo[]> {
    return this.sessionService.search(workspace, q);
  }

  async getMessages(_workspace: string, sessionId: string): Promise<UIMessage[]> {
    return this.translateNotFound(() => this.sessionService.getMessages(sessionId));
  }

  async updateSession(_workspace: string, sessionId: string, updates: SessionUpdate): Promise<void> {
    return this.translateNotFound(() => this.sessionService.update(sessionId, updates));
  }

  async deleteSession(_workspace: string, sessionId: string): Promise<void> {
    const remSession = this.sessions.get(sessionId);
    remSession?.runController?.abort();
    this.sessions.remove(sessionId);
    return this.translateNotFound(() => this.sessionService.delete(sessionId));
  }

  async getTodos(_workspace: string, sessionId: string): Promise<TodoItem[]> {
    return new DefaultTodoService(this.di.storage.todoStore).get(sessionId);
  }

  private async translateNotFound<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof SessionNotFoundError) {
        throw new ServiceError(err.message, 404);
      }
      throw err;
    }
  }

  /* ---- 审批 ---- */

  async listPendingApprovals(_workspace: string, sessionId: string): Promise<ApprovalRequest[]> {
    return this.sessions.get(sessionId)?.pendingApprovals ?? [];
  }

  async resolveApproval(_workspace: string, sessionId: string, approvalId: string, decision: ApprovalDecision, rule?: Omit<Rule, 'source'>): Promise<boolean> {
    if (decision === 'allow-always' && rule) {
      await this.di.storage.ruleStore.saveApproved(rule);
      this.di.ruleEngine.addRule({ ...rule, source: 'approved' });
    }
    return this.sessions.get(sessionId)?.approvalEngine.resolve(approvalId, decision, rule) ?? false;
  }

  /* ---- 全局总流（含 snapshot 回放，移植 agent.ts:227-277）---- */

  async *stream(signal?: AbortSignal): AsyncIterable<BusEvent> {
    const queue: BusEvent[] = [];
    let resolveNext: ((event: BusEvent) => void) | null = null;

    const unsub = this.bus.subscribe((event) => {
      if (resolveNext) {
        resolveNext(event);
        resolveNext = null;
      } else {
        queue.push(event);
      }
    });

    try {
      for (const remSession of this.sessions.running()) {
        const snapshot = remSession.getSnapshot();
        if (snapshot) {
          const compactParts = compactContentBlocks(snapshot.parts as Array<TextContent | ThinkingContent | ToolCall | undefined>);
          yield {
            workspace: remSession.workspace,
            sessionId: remSession.sessionId,
            type: 'snapshot',
            messageId: snapshot.messageId,
            parts: compactParts,
          };
        }
      }

      while (true) {
        if (signal?.aborted) break;
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          const event = await new Promise<BusEvent | null>((resolve) => {
            resolveNext = resolve;
            signal?.addEventListener('abort', () => resolve(null), { once: true });
          });
          if (event === null) break;
          yield event;
        }
      }
    } finally {
      unsub();
    }
  }
}
```

`packages/bridge-v2/src/index.ts`：

```typescript
export { AgentsUniService } from './agents-uni-service.js';
export { AgentService, type AgentServiceDeps } from './agent-service.js';
export { SessionService } from './session-service.js';
export { WorkspaceService } from './workspace-service.js';
export { REMSession, type REMSessionStatus, type REMSessionParams } from './rem-session.js';
export { REMSessions } from './rem-sessions.js';
export { ServiceError } from './errors.js';
```

注意 `ServiceError` 的构造签名（message, statusCode）以 `packages/bridge/src/errors.ts` 为准；测试里断言 `statusCode: 409` 按实际字段名调整（旧代码 `new ServiceError('...', 409)`，字段名需读文件确认，如为 `status` 则测试改 `status: 409`）。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm vitest run packages/bridge-v2/tests/`
Expected: 全部通过

- [ ] **Step 6: typecheck + Commit**

Run: `pnpm --filter rem-agent-bridge-v2 typecheck`

```bash
git add packages/bridge-v2/src packages/bridge-v2/tests
git commit -m "feat(bridge-v2): add AgentsUniService facade with global stream"
```

---

### Task 15: web REM_IMPL 开关

**Files:**
- Modify: `packages/web/src/agent-service.ts`
- Modify: `packages/web/package.json`（加依赖）

- [ ] **Step 1: web/package.json dependencies 加**

```json
    "rem-agent-bridge-v2": "workspace:*"
```

- [ ] **Step 2: 改 agent-service.ts**

`packages/web/src/agent-service.ts` 全文替换为：

```typescript
import { createAgentFromEnv, createDefaultAgentPaths } from 'rem-agent-core';
import { AgentService } from 'rem-agent-bridge';
import type { IAgentService } from 'rem-agent-bridge';
import { AgentsUniService } from 'rem-agent-bridge-v2';

const GLOBAL_KEY = '__REM_AGENT_SERVICE__';

async function createService(): Promise<IAgentService> {
  const paths = createDefaultAgentPaths();
  const { di, runtimeConfig } = await createAgentFromEnv({ paths });
  if (process.env.REM_IMPL === 'v2') {
    return new AgentsUniService(di, runtimeConfig);
  }
  return new AgentService(di, runtimeConfig);
}

export function getAgentService(): Promise<IAgentService> {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = createService();
  }
  return g[GLOBAL_KEY] as Promise<IAgentService>;
}
```

（routes 的 `GetAgentService` 已定义为 `() => Promise<IAgentService> | IAgentService`（packages/routes/src/types.ts:3），无需改 routes。）

- [ ] **Step 3: 安装 + typecheck**

Run: `pnpm install && pnpm --filter rem-agent-web typecheck`（包名以 `packages/web/package.json` 的 name 为准）
Expected: 成功

- [ ] **Step 4: 手工冒烟（两版）**

```bash
pnpm --filter rem-agent-web dev                # v1 冒烟：发一条消息正常
REM_IMPL=v2 pnpm --filter rem-agent-web dev    # v2 冒烟：发一条消息正常、列表/删除正常
```

冒烟清单：创建 session → 发消息收到完整回复 → 刷新后消息仍在 → 列表按 workspace 过滤 → 删除 session。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/agent-service.ts packages/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add REM_IMPL switch between v1 AgentService and v2 AgentsUniService"
```

---

## 自审记录

- Spec 覆盖：REMAgent（T5-7）、REMSession/REMSessions（T9-10）、SessionService（T11）、WorkspaceService（T12）、AgentService（T13）、AgentsUniService + 全局 stream（T14）、新旧并存 + web 切换（T2/T8/T15）、delegate 挂 children（T6/T13/T14）。workspace 级独立 DI 与平级多 Agent 交互按 spec 明确不做。
- 已知偏差（实现时按注释处理）：`ServiceError` 字段名、`SessionInfo` 可选字段、`Usage.cost` 结构以现有源码为准；`computeTotalTokenUsage` 用 `addUsage/emptyUsage` 简化。
