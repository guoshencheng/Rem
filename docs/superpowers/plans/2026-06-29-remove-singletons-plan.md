# 移除单例 + 引入 awilix DI 容器 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除 AgentService/ProviderManager 单例模式，引入 awilix DI 容器统一管理依赖，message 折叠内聚到 AgentService 内部，删除 server 包。

**Architecture:** 从内到外：ProviderManager 改为普通实例 + 工厂函数 → runAgent 显式接收 pm → AgentService/SessionService 改为构造注入 → awilix 容器在 web 层装配 → 路由从容器解析依赖。

**Tech Stack:** awilix (DI), rem-agent-core, rem-agent-bridge, Next.js 15

---

## 文件结构预览

```
packages/core/src/
  provider-manager.ts       → 去掉 singleton，导出 createProviderManager()
  run-agent.ts              → 增加 pm 参数
  index.ts                  → 导出 createProviderManager

packages/bridge/src/
  agent.ts                  → 去 singleton，构造注入，tap 模式，listSessions
  sessions.ts               → 构造注入，委托 list()
  index.ts                  → 导出更新

packages/web/
  package.json              → 新增 awilix 依赖
  src/lib/container.ts      → [新增] awilix 容器配置
  src/app/api/agent/run/route.ts         → 容器解析
  src/app/api/stream/[sessionId]/route.ts → 容器解析，去掉 applyChunk
  src/app/api/sessions/route.ts          → 容器解析
  src/app/api/sessions/[id]/route.ts     → 容器解析

packages/server/           → [删除]

packages/core/tests/
  provider-manager.test.ts → 更新测试
  run-agent.test.ts        → 更新测试
packages/bridge/tests/
  agent.test.ts            → [新增] 测试
```

---

### Task 1: 安装 awilix

**Files:**
- Modify: `packages/web/package.json`

- [ ] **Step 1: 安装 awilix**

```bash
pnpm --filter rem-agent-web add awilix
```

- [ ] **Step 2: 验证安装**

```bash
ls packages/web/node_modules/awilix/package.json
```

Expected: 文件存在

---

### Task 2: ProviderManager 去单例

**Files:**
- Modify: `packages/core/src/provider-manager.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 移除 singleton 相关代码，添加 init() 和工厂函数**

修改 `packages/core/src/provider-manager.ts`：

```typescript
// 删除 private static instance?: ProviderManager;
// 删除 static async getInstance(config?: ProviderManagerConfig): Promise<ProviderManager> { ... }
// 删除 static resetInstance(): void { ... }

// 将 private async initialize() 改为公开:
async init(): Promise<void> {
  if (this.initialized) return;

  this.configProvider =
    this.config.configProvider ?? (await this.createDefaultConfigProvider());
  // ... 其余代码保持不变
  this.initialized = true;
}

// 在类定义之外新增工厂函数:
export async function createProviderManager(
  config?: ProviderManagerConfig,
): Promise<ProviderManager> {
  const pm = new ProviderManager(config ?? {});
  await pm.init();
  return pm;
}
```

- [ ] **Step 2: 更新 `packages/core/src/index.ts` 导出**

在文件末尾追加：
```typescript
export { createProviderManager } from './provider-manager.js';
```

---

### Task 3: runAgent 显式接收 ProviderManager

**Files:**
- Modify: `packages/core/src/run-agent.ts`

- [ ] **Step 1: 给 RunAgentParams 增加 pm 参数**

```typescript
export interface RunAgentParams {
  input: UserInput;
  sessionId: string;
  signal?: AbortSignal;
  pm: ProviderManager;  // 新增
}
```

- [ ] **Step 2: 移除 getInstance() 调用，使用传入的 pm**

```typescript
// 修改前 (line 34):
const pm = await ProviderManager.getInstance();

// 修改后:
const pm = params.pm;
```

- [ ] **Step 3: 移除 ProviderManager 的 import（不再需要 getInstance）**

```typescript
// 修改前:
import { ProviderManager } from './provider-manager.js';

// 修改后:
import type { ProviderManager } from './provider-manager.js';
```

`ProviderManager` 只作为类型使用，改为 type-only import。

---

### Task 4: AgentService 去单例 + tap 模式 + listSessions

**Files:**
- Modify: `packages/bridge/src/agent.ts`

- [ ] **Step 1: 重写构造函数，移除 singleton**

```typescript
// 删除 g 全局变量
// 删除 static getInstance()
import { LocalSessionProvider } from 'rem-agent-core';

constructor(private providerManager: ProviderManager) {
  this.sessionProvider = providerManager.require('session') as LocalSessionProvider;
}
```

- [ ] **Step 2: 移除 ensureProviderManager、applyChunk、msgCache**

删除以下内容：
- `private _pmReady = false;`
- `private msgCache = new Map<string, SessionMessages>();`
- `interface SessionMessages { ... }`（仅被 msgCache 使用）
- `private async ensureProviderManager(): Promise<void> { ... }`
- `applyChunk(sessionId: string, chunk: AgentStreamChunk): void { ... }`

- [ ] **Step 3: 重写 run() — tap 模式 + 消息积累**

```typescript
async run(params: RunParams): Promise<RunResult> {
  if (this.activeRuns.has(params.sessionId)) {
    throw new ServiceError('Session is already running', 409);
  }

  const abortController = new AbortController();
  this.activeRuns.set(params.sessionId, abortController);

  const result = coreRunAgent({
    input: { content: params.content, timestamp: new Date() },
    sessionId: params.sessionId,
    signal: abortController.signal,
    pm: this.providerManager,
  });

  const tapped = this.tapFullStream(result.stream.fullStream, params.sessionId);
  const tappedStream = { ...result.stream, fullStream: tapped };

  this.activeStreams.set(params.sessionId, {
    stream: tappedStream,
    output: result.output,
  });

  result.output.finally(() => {
    this.activeRuns.delete(params.sessionId);
    this.activeStreams.delete(params.sessionId);
  });

  return { sessionId: params.sessionId };
}

private tapFullStream(
  source: AsyncIterable<AgentStreamChunk>,
  sessionId: string,
): AsyncIterable<AgentStreamChunk> {
  type TC = { id: string; name: string; arguments: Record<string, unknown>; result?: { success: boolean; output?: string; error?: string; durationMs: number } };
  const assistantMsgId = crypto.randomUUID();
  const assistant: ServerMessage = { id: assistantMsgId, role: 'assistant', content: '', toolCalls: [], status: 'pending' };

  const applyChunk = (chunk: AgentStreamChunk) => {
    if (chunk.type === 'text-delta') {
      assistant.content += chunk.text;
      assistant.status = 'streaming';
    } else if (chunk.type === 'reasoning-delta') {
      assistant.reasoning = (assistant.reasoning ?? '') + chunk.text;
      assistant.status = 'streaming';
    } else if (chunk.type === 'tool-call-start') {
      assistant.toolCalls.push({ id: chunk.toolCallId, name: chunk.toolName, arguments: {} });
      assistant.status = 'streaming';
    } else if (chunk.type === 'tool-call') {
      const tc = assistant.toolCalls.find((t: TC) => t.id === chunk.toolCallId) as TC | undefined;
      if (tc) tc.arguments = (chunk.input as Record<string, unknown>) ?? {};
    } else if (chunk.type === 'tool-result') {
      const tc = assistant.toolCalls.find((t: TC) => t.id === chunk.toolCallId) as TC | undefined;
      if (tc) { tc.result = { success: !chunk.error, output: chunk.output, error: chunk.error, durationMs: 0 }; }
    } else if (chunk.type === 'finish') {
      assistant.status = 'done';
      const existing = this.sessionProvider.pullMessages(sessionId);
      this.sessionProvider.cueMessages(sessionId, [...existing, assistant]);
    } else if (chunk.type === 'error') {
      assistant.status = 'error';
      assistant.error = String(chunk.error);
      const existing = this.sessionProvider.pullMessages(sessionId);
      this.sessionProvider.cueMessages(sessionId, [...existing, assistant]);
    }
  };

  return {
    [Symbol.asyncIterator]() {
      const it = source[Symbol.asyncIterator]();
      return {
        async next() {
          const r = await it.next();
          if (r.value) applyChunk(r.value);
          return r;
        }
      };
    }
  };
}
```

- [ ] **Step 4: 重写 addUserMessage — 去掉 msgCache 和 assistant 占位**

```typescript
addUserMessage(sessionId: string, content: string): void {
  this.sessionProvider.cueMessages(sessionId, [
    {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      toolCalls: [],
      status: 'done',
    },
  ]);
}
```

注：assistant 占位消息现在由 `tapFullStream` 内部创建，`addUserMessage` 只负责用户消息。tap 在 `finish` 时合并已有消息（含用户消息）和 assistant 消息一起写入。

- [ ] **Step 5: 重写 getMessages — 直接委托 sessionProvider**

```typescript
getMessages(sessionId: string): ServerMessage[] {
  return this.sessionProvider.pullMessages(sessionId);
}
```

- [ ] **Step 6: 新增 listSessions 方法**

```typescript
async listSessions(): Promise<{ sessionId: string; title: string; messageCount: number }[]> {
  const summaries = await this.sessionProvider.list();
  return summaries.map((s) => ({
    sessionId: s.sessionId,
    title: s.title ?? 'New Chat',
    messageCount: s.messageCount,
  }));
}
```

- [ ] **Step 7: 更新 import**

```typescript
// 修改前 (第 1-14 行的 import 区域):
import type { AgentStreamChunk, RunAgentResult } from 'rem-agent-core';
import {
  runAgent as coreRunAgent,
  ProviderManager,
  LocalSessionProvider,
  InMemoryToolProvider,
  SimpleMemoryProvider,
  ...
} from 'rem-agent-core';
import type { ServerMessage } from 'rem-agent-core';
import { resolve } from 'path';
import { ServiceError } from './errors.js';

// 修改后:
import type { AgentStreamChunk, RunAgentResult } from 'rem-agent-core';
import {
  runAgent as coreRunAgent,
  LocalSessionProvider,
} from 'rem-agent-core';
import type { ServerMessage } from 'rem-agent-core';
import type { ProviderManager } from 'rem-agent-core';  // 仅作类型
import { ServiceError } from './errors.js';

// 移除不再需要的 import: InMemoryToolProvider, SimpleMemoryProvider, FileSkillProvider,
//   NoOpCompressor, SimpleErrorHandler, FixedBudgetPolicy, resolve
```

注：`InMemoryToolProvider`、`SimpleMemoryProvider` 等之前通过 `ensureProviderManager` 传给 `ProviderManager`，现在由容器管理，AgentService 不再直接使用。

---

### Task 5: SessionService 构造注入

**Files:**
- Modify: `packages/bridge/src/sessions.ts`

- [ ] **Step 1: 重写构造函数**

```typescript
// 修改前:
export class SessionService {
  private agentService: AgentService;

  constructor() {
    this.agentService = AgentService.getInstance();
  }

// 修改后:
export class SessionService {
  constructor(private agentService: AgentService) {}
```

- [ ] **Step 2: list() 改为 async，委托给 agentService.listSessions()**

```typescript
// 修改后:
async list() {
  const sessions = await this.agentService.listSessions();
  return sessions.map((s) => ({
    sessionId: s.sessionId,
    title: meta.get(s.sessionId)?.title ?? s.title,
    updatedAt: Date.now(),
    messageCount: s.messageCount,
  })).sort((a, b) => b.updatedAt - a.updatedAt);
}
```

- [ ] **Step 3: 移除 AgentService 的 import（不再 getInstance）**

```typescript
// 修改前:
import { AgentService } from './agent.js';

// 修改后: 改为 type-only import（仅作为构造函数参数类型）
import type { AgentService } from './agent.js';
```

---

### Task 6: 容器配置

**Files:**
- Create: `packages/web/src/lib/container.ts`

- [ ] **Step 1: 创建容器文件**

```typescript
import { createContainer, asClass, asValue, Lifetime, type AwilixContainer } from 'awilix';
import { createProviderManager } from 'rem-agent-core';
import { AgentService, SessionService } from 'rem-agent-bridge';

async function configureContainer(): Promise<AwilixContainer> {
  const pm = await createProviderManager();
  const container = createContainer();

  container.register({
    providerManager: asValue(pm),
    agentService: asClass(AgentService, { lifetime: Lifetime.SINGLETON }),
    sessionService: asClass(SessionService, { lifetime: Lifetime.SINGLETON }),
  });

  return container;
}

let _container: AwilixContainer | null = null;
let _initPromise: Promise<AwilixContainer> | null = null;

export async function getContainer(): Promise<AwilixContainer> {
  if (_container) return _container;
  if (!_initPromise) {
    _initPromise = configureContainer().then((c) => {
      _container = c;
      _initPromise = null;
      return c;
    });
  }
  return _initPromise;
}
```

- [ ] **Step 2: 验证容器解析**

```bash
node -e "import('./packages/web/src/lib/container.js').then(m => m.getContainer().then(c => console.log(Object.keys(c.registrations))))"
```

---

### Task 7: Web run 路由更新

**Files:**
- Modify: `packages/web/src/app/api/agent/run/route.ts`

- [ ] **Step 1: 重写路由文件**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/container';
import type { AgentService } from 'rem-agent-bridge';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, content, interrupt } = body as {
      sessionId: string;
      content?: string;
      interrupt?: boolean;
    };

    const container = await getContainer();
    const agentService = container.resolve<AgentService>('agentService');

    if (interrupt) {
      const result = agentService.interrupt(sessionId);
      return NextResponse.json({ sessionId, interrupted: result.interrupted });
    }

    if (!content || !sessionId) {
      return NextResponse.json({ error: 'sessionId and content are required' }, { status: 400 });
    }

    await agentService.run({ sessionId, content });
    agentService.addUserMessage(sessionId, content);

    return NextResponse.json({ sessionId, streamUrl: `/api/stream/${sessionId}` });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
```

主要变化：`const agentService = AgentService.getInstance()` → `const agentService = container.resolve<AgentService>('agentService')`

---

### Task 8: Web stream 路由更新

**Files:**
- Modify: `packages/web/src/app/api/stream/[sessionId]/route.ts`

- [ ] **Step 1: 重写路由文件**

```typescript
import { NextRequest } from 'next/server';
import { getContainer } from '@/lib/container';
import type { AgentService } from 'rem-agent-bridge';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  const container = await getContainer();
  const agentService = container.resolve<AgentService>('agentService');

  const active = agentService.getStream(sessionId);
  if (!active) {
    return new Response(JSON.stringify({ error: 'No active stream' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of active.stream.fullStream) {
          controller.enqueue(encoder.encode(`event: chunk\ndata: ${JSON.stringify(chunk)}\n\n`));
          if (chunk.type === 'finish' || chunk.type === 'error') break;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Stream error';
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ type: 'error', error: message })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
```

关键变化：移除 `agentService.applyChunk(sessionId, chunk)` 调用，tap 已在 `AgentService.run()` 内部处理。

---

### Task 9: Web sessions 路由更新

**Files:**
- Modify: `packages/web/src/app/api/sessions/route.ts`
- Modify: `packages/web/src/app/api/sessions/[id]/route.ts`

- [ ] **Step 1: 更新 `sessions/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { getContainer } from '@/lib/container';
import type { SessionService } from 'rem-agent-bridge';

export async function GET() {
  const container = await getContainer();
  const sessionService = container.resolve<SessionService>('sessionService');
  const sessions = await sessionService.list();
  return NextResponse.json({ sessions });
}

export async function POST() {
  const container = await getContainer();
  const sessionService = container.resolve<SessionService>('sessionService');
  const session = sessionService.create();
  return NextResponse.json(session);
}
```

- [ ] **Step 2: 更新 `sessions/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/container';
import type { SessionService } from 'rem-agent-bridge';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const container = await getContainer();
  const sessionService = container.resolve<SessionService>('sessionService');
  return NextResponse.json({ messages: sessionService.getMessages(id) });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const container = await getContainer();
  const sessionService = container.resolve<SessionService>('sessionService');
  sessionService.update(id, body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const container = await getContainer();
  const sessionService = container.resolve<SessionService>('sessionService');
  sessionService.delete(id);
  return NextResponse.json({ ok: true });
}
```

---

### Task 10: 删除 server 包

**Files:**
- Delete: `packages/server/`

- [ ] **Step 1: 删除目录**

```bash
rm -rf packages/server
```

- [ ] **Step 2: 从 pnpm workspace 配置中移除**

检查 `pnpm-workspace.yaml` 是否需要更新（如果 `packages/*` 通配符已覆盖则无需操作）。

---

### Task 11: 清理 addUserMessage 的冗余调用 (可选优化)

**Files:**
- Modify: `packages/web/src/app/api/agent/run/route.ts`

`coreRunAgent` 内部已经保存 user message 到 sessionProvider（`run-agent.ts:69`），route 层的 `addUserMessage` 是冗余的。但先保留不删，作为兼容。

- [ ] **Step 1: 确认 coreRunAgent 已保存 user message**

检查 `packages/core/src/run-agent.ts:69`：
```typescript
state.addMessage(userMessage);
await sessionProvider.save(state.session);
```
确认无误，无需额外操作。

---

### Task 12: 更新测试

**Files:**
- Modify: `packages/core/tests/provider-manager.test.ts`
- Modify: `packages/core/tests/run-agent.test.ts`

- [ ] **Step 1: 更新 provider-manager 测试**

将测试中所有 `ProviderManager.getInstance()` 替换为 `createProviderManager()`，移除 `resetInstance()` 调用：

```typescript
// 修改前:
await ProviderManager.getInstance({ ... });
// ... tests ...
ProviderManager.resetInstance();

// 修改后:
const pm = await createProviderManager({ ... });
// ... tests ...
```

- [ ] **Step 2: 更新 run-agent 测试**

`runAgent()` 调用增加 `pm` 参数：

```typescript
// 修改前:
const result = runAgent({ input, sessionId, signal });

// 修改后:
const pm = await createProviderManager({ ... });
const result = runAgent({ input, sessionId, signal, pm });
```

- [ ] **Step 3: 运行测试验证**

```bash
pnpm test
```

---

### Task 13: 类型检查与最终验证

- [ ] **Step 1: 运行类型检查**

```bash
pnpm typecheck
```

Expected: 无类型错误。

- [ ] **Step 2: 运行全部测试**

```bash
pnpm test
```

Expected: 全部通过。

- [ ] **Step 3: 验证 web 启动**

```bash
pnpm --filter rem-agent-web dev
```

Expected: 无错误启动，无运行时崩溃。

---

### Task 14: Bridge 导出更新

**Files:**
- Modify: `packages/bridge/src/index.ts`

- [ ] **Step 1: 确认导出正确**

检查 `createProviderManager` 不需要从 bridge 导出（只在 core 中导出，web 直接 import core）。

Bridge 导出无需变更，因为 `AgentService` 和 `SessionService` 的类名未变，只是去掉了 `getInstance()`。
