# AgentService Provider 初始化迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `AgentContext` 的构建从调用方收拢到 `AgentService` 内部，新增 `init()` 方法，同时保持 Core 拥有 Provider 配置解析的红线。

**Architecture:** 在 Core 新增 `AgentContextBuilder`（`buildAgentContext`），承载原来 `createAgentFromEnv` 的构建逻辑；`createAgentFromEnv` 改为薄封装。`AgentService` 构造函数改为接收 `AgentServiceOptions`，新增异步 `init()` 内部调用 `buildAgentContext`。Web 容器简化为直接创建 `AgentService` 并 `await init()`。

**Tech Stack:** TypeScript, pnpm workspace, vitest, rem-agent-core, rem-agent-bridge, Next.js (web)

## Global Constraints

- **Provider 配置由 Core 拥有**：`packages/bridge` 不直接读取 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY` 等环境变量。
- **TUI 排除在外**：不改动 `packages/tui`。
- **模块拆分**：新增/修改文件遵循 `module-separation-convention`，保持文件精简、职责单一。
- **测试**：每个 task 结束后有独立可运行的测试；最终运行 `pnpm typecheck && pnpm test`。
- **向后兼容**：`createAgentFromEnv` 保留并委托给 `buildAgentContext`。

---

## 文件变更总览

| 文件 | 操作 | 职责 |
|---|---|---|
| `packages/core/src/agent-context-builder.ts` | 创建 | 统一异步构建 `AgentContext`，导出 `AgentContextBuildOptions` 与 `buildAgentContext` |
| `packages/core/src/agent-factory.ts` | 修改 | `createAgentFromEnv` 改为 `buildAgentContext` 的薄封装 |
| `packages/core/src/index.ts` | 修改 | 导出 `buildAgentContext`、`AgentContextBuildOptions` |
| `packages/core/tests/agent-context-builder.test.ts` | 创建 | 验证 `buildAgentContext` 构建行为 |
| `packages/bridge/src/agent-service.interface.ts` | 修改 | `IAgentService` 增加 `init(): Promise<void>` |
| `packages/bridge/src/agent.ts` | 修改 | `AgentService` 构造函数接收 options，新增 `init()`，方法增加未初始化 guard |
| `packages/bridge/tests/agent-service-init.test.ts` | 创建 | 验证 `init()` 构建上下文、幂等性、未初始化报错 |
| `packages/bridge/tests/agent-service.test.ts` | 修改 | 改用 `new AgentService({ workspaceRoot: dir })` + `await init()` |
| `packages/bridge/tests/agent-service-run.test.ts` | 修改 | 同上，确保 mock provider 在 `init()` 前注册 |
| `packages/web/src/lib/container.ts` | 修改 | 移除 `createAgentFromEnv` 调用，直接创建 `AgentService` 并 `init()` |

---

### Task 1: 在 Core 创建 `AgentContextBuilder`

**Files:**
- Create: `packages/core/src/agent-context-builder.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/agent-context-builder.test.ts`

**Interfaces:**
- Consumes: 无（这是第一个 task）。
- Produces:
  - `AgentContextBuildOptions` interface
  - `buildAgentContext(options?: AgentContextBuildOptions): Promise<AgentContext>`

- [ ] **Step 1: 编写失败测试**

在 `packages/core/tests/agent-context-builder.test.ts` 写入：

```ts
import { describe, it, expect } from 'vitest';
import { buildAgentContext } from '../src/agent-context-builder.js';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('buildAgentContext', () => {
  it('returns raw providers and a toolComposer without pre-merging tools', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rem-agent-test-'));
    writeFileSync(join(dir, 'agent.json'), JSON.stringify({ name: 'test-agent' }));

    const previousHome = process.env.REM_AGENT_HOME;
    process.env.REM_AGENT_HOME = dir;

    try {
      const ctx = await buildAgentContext({ configPath: join(dir, 'agent.json') });

      expect(ctx.toolProvider).toBeDefined();
      expect(ctx.mcpProviders).toBeDefined();
      expect(ctx.mcpProviders).toBeInstanceOf(Array);
      expect(ctx.toolComposer).toBeDefined();
      expect(typeof ctx.toolComposer.compose).toBe('function');

      // read_skill should NOT be pre-registered on the raw toolProvider
      expect(ctx.toolProvider.getToolSet()).not.toHaveProperty('read_skill');
    } finally {
      if (previousHome === undefined) {
        delete process.env.REM_AGENT_HOME;
      } else {
        process.env.REM_AGENT_HOME = previousHome;
      }
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter rem-agent-core test -- tests/agent-context-builder.test.ts
```

Expected: 失败，提示找不到 `buildAgentContext` 模块。

- [ ] **Step 3: 实现 `AgentContextBuilder`**

将 `packages/core/src/agent-factory.ts` 中的实现逻辑迁移到新建文件 `packages/core/src/agent-context-builder.ts`：

```ts
import { registerBuiltInProviders } from './llm/providers/index.js';
import { createDefaultAgentPaths } from './config/paths.js';
import { configureDebugLog } from './shared/debug-log.js';
import { DefaultConfigProvider } from './plugins/config/default/index.js';
import { InMemorySessionProvider } from './plugins/session/in-memory/index.js';
import { InMemoryAgentLiveProvider } from './plugins/state/in-memory/index.js';
import { createFileSystemTools } from './plugins/tool/file-system/index.js';
import { SimpleContextProvider } from './plugins/memory/simple/index.js';
import { FileSkillProvider } from './plugins/skill/file/index.js';
import { FixedBudgetPolicy } from './plugins/budget/fixed/index.js';
import { NoOpCompressor } from './plugins/compressor/no-op/index.js';
import { SimpleErrorHandler } from './plugins/error/simple/index.js';
import { LLMTitleProvider } from './plugins/title/llm/index.js';
import { ReactLoop } from './plugins/loop/react/index.js';
import { McpConnectionManager } from './mcp/connection-manager.js';
import { DefaultToolComposer } from './tool-composer.js';
import type { AgentContext } from './agent-context.js';

export interface AgentContextBuildOptions {
  name?: string;
  configPath?: string;
  maxTurns?: number;
  workspaceRoot?: string;
  readOnly?: boolean;
  autoApproveDangerous?: boolean;
  provider?: string;
  model?: string;
}

export async function buildAgentContext(options?: AgentContextBuildOptions): Promise<AgentContext> {
  registerBuiltInProviders();

  const paths = createDefaultAgentPaths();
  configureDebugLog(paths.debugLogFile);

  const configProvider = new DefaultConfigProvider({
    paths,
    configPath: options?.configPath,
    overrides: {
      name: options?.name,
      maxTurns: options?.maxTurns,
      workspaceRoot: options?.workspaceRoot,
      readOnly: options?.readOnly,
      autoApproveDangerous: options?.autoApproveDangerous,
      ...(options?.provider ? { model: { provider: options.provider, model: options.model ?? '' } } : {}),
    },
  });
  await configProvider.init();

  const sessionProvider = new InMemorySessionProvider();
  const agentLiveProvider = new InMemoryAgentLiveProvider();
  const toolProvider = createFileSystemTools(configProvider);
  const contextProvider = new SimpleContextProvider(configProvider);
  const skillProvider = new FileSkillProvider(configProvider, paths);
  const budgetPolicy = new FixedBudgetPolicy(configProvider);
  const compressor = new NoOpCompressor();
  const errorHandler = new SimpleErrorHandler();
  const titleProvider = new LLMTitleProvider(configProvider);
  const loopStrategy = new ReactLoop();

  const mcpConfig = configProvider.getMcpConfig();
  const mcpManager = new McpConnectionManager();
  const mcpProviders = await mcpManager.connectAll(mcpConfig);

  const toolComposer = new DefaultToolComposer();

  return {
    configProvider,
    sessionProvider,
    agentLiveProvider,
    toolProvider,
    mcpProviders,
    skillProvider,
    toolComposer,
    contextProvider,
    budgetPolicy,
    compressor,
    errorHandler,
    titleProvider,
    loopStrategy,
    mcpManager,
  };
}
```

在 `packages/core/src/index.ts` 新增导出：

```ts
export { buildAgentContext, type AgentContextBuildOptions } from './agent-context-builder.js';
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter rem-agent-core test -- tests/agent-context-builder.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/agent-context-builder.ts packages/core/src/index.ts packages/core/tests/agent-context-builder.test.ts
git commit -m "feat(core): add AgentContextBuilder with buildAgentContext

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 重构 `createAgentFromEnv` 为 `buildAgentContext` 的薄封装

**Files:**
- Modify: `packages/core/src/agent-factory.ts`
- Test: `packages/core/tests/agent-factory.test.ts`

**Interfaces:**
- Consumes: `buildAgentContext(options): Promise<AgentContext>`
- Produces: `createAgentFromEnv(options): Promise<AgentContext>`（行为不变）

- [ ] **Step 1: 精简 `agent-factory.ts`**

替换整个文件内容为：

```ts
import { buildAgentContext, type AgentContextBuildOptions } from './agent-context-builder.js';
import type { AgentContext } from './agent-context.js';

export interface CreateAgentOptions extends AgentContextBuildOptions {}

export async function createAgentFromEnv(options?: CreateAgentOptions): Promise<AgentContext> {
  return buildAgentContext(options);
}
```

- [ ] **Step 2: 运行现有测试**

```bash
pnpm --filter rem-agent-core test -- tests/agent-factory.test.ts
```

Expected: PASS（行为保持向后兼容）。

- [ ] **Step 3: 提交**

```bash
git add packages/core/src/agent-factory.ts
git commit -m "refactor(core): delegate createAgentFromEnv to buildAgentContext

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 更新 `IAgentService` 接口，增加 `init()`

**Files:**
- Modify: `packages/bridge/src/agent-service.interface.ts`

**Interfaces:**
- Consumes: 无。
- Produces: `IAgentService.init(): Promise<void>`

- [ ] **Step 1: 修改接口文件**

在 `packages/bridge/src/agent-service.interface.ts` 的接口中加入：

```ts
init(): Promise<void>;
```

完整接口示例：

```ts
import type { ApprovalDecision, ApprovalRequest } from 'rem-agent-core';
import type { BusEvent, SessionSummary, SessionUpdate, UIMessage } from './types.js';

export interface IAgentService {
  init(): Promise<void>;
  run(sessionId: string, input: string): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  reset(sessionId: string): Promise<void>;
  createSession(): Promise<SessionSummary>;
  listSessions(): Promise<SessionSummary[]>;
  getMessages(sessionId: string): Promise<UIMessage[]>;
  updateSession(sessionId: string, updates: SessionUpdate): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  stream(): AsyncIterable<BusEvent>;
  listPendingApprovals(sessionId: string): Promise<ApprovalRequest[]>;
  resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<boolean>;
}
```

- [ ] **Step 2: 运行 bridge 类型检查**

```bash
pnpm --filter rem-agent-bridge typecheck
```

Expected: 此时 `AgentService` 未实现 `init()`，类型检查会失败，这是预期行为，将在 Task 4 修复。

- [ ] **Step 3: 提交**

```bash
git add packages/bridge/src/agent-service.interface.ts
git commit -m "feat(bridge): add init() to IAgentService interface

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 重构 `AgentService` 构造函数并实现 `init()`

**Files:**
- Modify: `packages/bridge/src/agent.ts`
- Test: `packages/bridge/tests/agent-service-init.test.ts`

**Interfaces:**
- Consumes: `AgentContextBuildOptions`（来自 core），`buildAgentContext(options): Promise<AgentContext>`
- Produces: `AgentService` 实例，支持 `new AgentService(options)` + `await init()`

- [ ] **Step 1: 编写失败测试**

创建 `packages/bridge/tests/agent-service-init.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentService } from '../src/agent.js';

describe('AgentService init', () => {
  let dir: string;
  let service: AgentService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-service-init-test-'));
    service = new AgentService({ workspaceRoot: dir });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('builds AgentContext on init', async () => {
    await service.init();
    const summary = await service.createSession();
    expect(summary.sessionId).toBeDefined();
    expect(summary.title).toBe('New Chat');
  });

  it('is idempotent', async () => {
    await service.init();
    await service.init();
    const summary = await service.createSession();
    expect(summary.sessionId).toBeDefined();
  });

  it('throws when accessed before init', async () => {
    await expect(service.createSession()).rejects.toThrow(/not initialized/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter rem-agent-bridge test -- tests/agent-service-init.test.ts
```

Expected: 编译失败或 `init()` 不存在。

- [ ] **Step 3: 实现 `AgentService` 改造**

修改 `packages/bridge/src/agent.ts`：

```ts
import type { AgentStreamChunk, SessionProvider, ApprovalDecision, ApprovalRequest, AgentLiveProvider, AgentContext } from 'rem-agent-core';
import { runAgent as coreRunAgent, ApprovalRegistry, buildAgentContext } from 'rem-agent-core';
import type { AgentContextBuildOptions } from 'rem-agent-core';
import { ServiceError } from './errors.js';
import { bus } from './broadcast-bus.js';
import { runRegistry } from './run-registry.js';
import type { BusEvent, SessionActivity, SessionSummary, SessionUpdate, UIMessage } from './types.js';
import type { IAgentService } from './agent-service.interface.js';
import { AgentSessionManager } from './agent-session.js';
import { SessionActivityTracker } from './session-activity-tracker.js';
import { streamingSnapshots } from './streaming-snapshots.js';
import { reduceStreamChunk } from './stream-reducer.js';

export type AgentServiceOptions = AgentContextBuildOptions;

export class AgentService implements IAgentService {
  private options: AgentServiceOptions;
  private workspace: string;
  private sessionProvider: SessionProvider | undefined;
  private agentLiveProvider: AgentLiveProvider | undefined;
  private ctx: AgentContext | undefined;
  private sessionManager: AgentSessionManager | undefined;
  private activityTracker: SessionActivityTracker | undefined;
  private approvalRegistry = new ApprovalRegistry();
  private initialized = false;

  constructor(options: AgentServiceOptions, workspace = 'default') {
    this.options = options;
    this.workspace = workspace;
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    this.ctx = await buildAgentContext(this.options);
    this.sessionProvider = this.ctx.sessionProvider;
    this.agentLiveProvider = this.ctx.agentLiveProvider;
    this.sessionManager = new AgentSessionManager(this.sessionProvider);
    this.activityTracker = new SessionActivityTracker((sessionId, activity) => {
      bus.publish({
        workspace: this.workspace,
        sessionId,
        type: 'activity-change',
        activity,
      });
    });

    this.initialized = true;
  }

  get context(): AgentContext | undefined {
    return this.ctx;
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.ctx || !this.sessionManager || !this.activityTracker) {
      throw new ServiceError('AgentService not initialized', 503);
    }
  }

  /* ---- Agent lifecycle ---- */

  async run(sessionId: string, input: string): Promise<void> {
    this.ensureInitialized();
    // 原有 run 实现保持不变，使用 this.ctx! 等断言
    const abortController = new AbortController();
    if (!runRegistry.register(sessionId, abortController)) {
      throw new ServiceError('Session is already running', 409);
    }

    bus.publish({ workspace: this.workspace, sessionId, type: 'session-start' });
    this.activityTracker!.start(sessionId);

    let result: ReturnType<typeof coreRunAgent>;
    try {
      result = coreRunAgent({
        input: { content: input, timestamp: new Date() },
        sessionId,
        signal: abortController.signal,
        ctx: this.ctx!,
        approvalRegistry: this.approvalRegistry,
      });
    } catch (err) {
      bus.publish({ workspace: this.workspace, sessionId, type: 'session-error', error: err instanceof Error ? err.message : String(err) });
      runRegistry.remove(sessionId);
      this.activityTracker!.finish(sessionId);
      throw err;
    }

    void this.drive(sessionId, result);
  }

  private async drive(sessionId: string, result: ReturnType<typeof coreRunAgent>): Promise<void> {
    const workspace = this.workspace;

    const consume = (async () => {
      for await (const chunk of result.stream.fullStream) {
        this.activityTracker!.applyChunk(sessionId, chunk);

        if (chunk.type === 'message-start') {
          streamingSnapshots.start(sessionId, chunk.messageId);
        } else if (isContentChunk(chunk)) {
          const entry = streamingSnapshots.get(sessionId);
          if (entry) {
            try {
              streamingSnapshots.update(sessionId, reduceStreamChunk(entry.parts, chunk));
            } catch {
              // snapshot best-effort
            }
          }
        }

        bus.publish({ workspace, sessionId, type: 'chunk', chunk });

        if (chunk.type === 'finish') {
          streamingSnapshots.clear(sessionId);
          bus.publish({ workspace, sessionId, type: 'session-end' });
        }
        if (chunk.type === 'error') {
          streamingSnapshots.clear(sessionId);
          bus.publish({ workspace, sessionId, type: 'session-error', error: String(chunk.error) });
        }
      }
    })();

    const outputGuard = result.output.then(
      () => new Promise<never>(() => {}),
      (err) => { throw err instanceof Error ? err : new Error(String(err)); },
    );

    try {
      await Promise.race([consume, outputGuard]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      streamingSnapshots.clear(sessionId);
      bus.publish({ workspace, sessionId, type: 'session-error', error: message });
    } finally {
      runRegistry.remove(sessionId);
      streamingSnapshots.clear(sessionId);
      this.activityTracker!.finish(sessionId);
    }
  }

  async interrupt(sessionId: string): Promise<void> {
    runRegistry.abort(sessionId);
  }

  async reset(sessionId: string): Promise<void> {
    runRegistry.abort(sessionId);
    runRegistry.remove(sessionId);
  }

  /* ---- Message tracking ---- */

  async getMessages(sessionId: string): Promise<UIMessage[]> {
    this.ensureInitialized();
    return this.sessionManager!.getMessages(sessionId);
  }

  async createSession(): Promise<SessionSummary> {
    this.ensureInitialized();
    return this.sessionManager!.createSession();
  }

  async listSessions(): Promise<SessionSummary[]> {
    this.ensureInitialized();
    const list = await this.sessionManager!.listSessions();
    return list.map((s) => ({
      ...s,
      activity: this.activityTracker!.get(s.sessionId) ?? 'idle',
    }));
  }

  async updateSession(sessionId: string, updates: SessionUpdate): Promise<void> {
    this.ensureInitialized();
    return this.sessionManager!.updateSession(sessionId, updates);
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.ensureInitialized();
    return this.sessionManager!.deleteSession(sessionId);
  }

  /* ---- Approval ---- */

  async listPendingApprovals(sessionId: string): Promise<ApprovalRequest[]> {
    this.ensureInitialized();
    const liveState = await this.agentLiveProvider!.get(sessionId);
    return liveState?.pendingApprovals ?? [];
  }

  async resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<boolean> {
    return this.approvalRegistry.resolve(approvalId, decision);
  }

  /* ---- Broadcast stream ---- */

  async *stream(): AsyncIterable<BusEvent> {
    const queue: BusEvent[] = [];
    let resolveNext: ((event: BusEvent) => void) | null = null;

    const unsub = bus.subscribe((event) => {
      if (event.workspace !== this.workspace) return;
      if (resolveNext) {
        resolveNext(event);
        resolveNext = null;
      } else {
        queue.push(event);
      }
    });

    try {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          yield await new Promise<BusEvent>((r) => { resolveNext = r; });
        }
      }
    } finally {
      unsub();
    }
  }
}

function isContentChunk(chunk: AgentStreamChunk): boolean {
  return chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' ||
    chunk.type === 'tool-call' || chunk.type === 'tool-result' ||
    chunk.type === 'text-start' || chunk.type === 'reasoning-start' ||
    chunk.type === 'tool-call-start' || chunk.type === 'tool-result-start';
}
```

> 注意：`run`/`drive` 中保留 `this.activityTracker!` 非空断言，因为 `ensureInitialized()` 已保证其存在。若 TypeScript 严格模式报错，可在方法开头解构 `const { ctx, sessionManager, activityTracker } = this;` 并断言，但保持最小改动。

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter rem-agent-bridge test -- tests/agent-service-init.test.ts
```

Expected: PASS。

- [ ] **Step 5: 运行 bridge 类型检查**

```bash
pnpm --filter rem-agent-bridge typecheck
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/bridge/src/agent.ts packages/bridge/src/agent-service.interface.ts packages/bridge/tests/agent-service-init.test.ts
git commit -m "feat(bridge): make AgentService self-contained with init()

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 更新 Web 容器

**Files:**
- Modify: `packages/web/src/lib/container.ts`

**Interfaces:**
- Consumes: `new AgentService(options)`、`service.init()`
- Produces: 容器注册 `agentService` singleton

- [ ] **Step 1: 修改容器**

替换 `packages/web/src/lib/container.ts` 为：

```ts
import { createContainer, asFunction, Lifetime, type AwilixContainer } from 'awilix';
import { AgentService } from 'rem-agent-bridge';

const GLOBAL_CONTAINER_KEY = '__REM_AGENT_CONTAINER__';

async function configureContainer(): Promise<AwilixContainer> {
  const container = createContainer();

  const service = new AgentService({ workspaceRoot: process.cwd() });
  await service.init();

  console.log('[Container] LLM config:', {
    model: service.context?.configProvider.getModelConfig().model,
    provider: service.context?.configProvider.getModelConfig().provider,
    hasApiKey: !!service.context?.configProvider.getModelConfig().apiKey,
    baseURL: service.context?.configProvider.getModelConfig().baseURL,
  });

  container.register({
    agentService: asFunction(() => service, {
      lifetime: Lifetime.SINGLETON,
    }),
  });

  return container;
}

let _initPromise: Promise<AwilixContainer> | null = null;

export async function getContainer(): Promise<AwilixContainer> {
  const globalAny = globalThis as any;
  if (globalAny[GLOBAL_CONTAINER_KEY]) {
    return globalAny[GLOBAL_CONTAINER_KEY];
  }

  if (!_initPromise) {
    _initPromise = configureContainer().then((c) => {
      globalAny[GLOBAL_CONTAINER_KEY] = c;
      _initPromise = null;
      return c;
    });
  }
  return _initPromise;
}
```

- [ ] **Step 2: 运行 web 类型检查**

```bash
pnpm --filter rem-agent-web typecheck
```

Expected: PASS。

- [ ] **Step 3: 提交**

```bash
git add packages/web/src/lib/container.ts
git commit -m "feat(web): simplify container to use self-contained AgentService

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 更新现有 Bridge 测试

**Files:**
- Modify: `packages/bridge/tests/agent-service.test.ts`
- Modify: `packages/bridge/tests/agent-service-run.test.ts`

**Interfaces:**
- Consumes: `new AgentService(options)`、`service.init()`
- Produces: 更新后的测试用例

- [ ] **Step 1: 更新 `agent-service.test.ts`**

将 `beforeEach` 改为：

```ts
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-service-test-'));
  service = new AgentService({ workspaceRoot: dir });
  await service.init();
});
```

移除 `ctx` 变量和 `createAgentFromEnv` 的导入（若后续无用）。若测试体中有 `ctx.sessionProvider` 引用，需改为通过构造 mock ctx 或改用 `service.context?.sessionProvider`。在本文件中只有 `merges tool-result parts` 测试用到 `ctx.sessionProvider`，可改为 `service.context!.sessionProvider`。

- [ ] **Step 2: 更新 `agent-service-run.test.ts`**

将 `beforeEach` 改为：

```ts
beforeEach(async () => {
  clearProviders();
  dir = await mkdtemp(join(tmpdir(), 'agent-service-run-test-'));

  registerProvider('mock-run', {
    resolveConfig() {
      return { model: 'mock-model', apiKey: 'fake-key' };
    },
    async generate() {
      return { text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
    },
    async *stream() {
      yield { type: 'text' as const, text: 'Hello' };
      yield { type: 'usage' as const, inputTokens: 3, outputTokens: 3, totalTokens: 6 };
    },
  });

  service = new AgentService({
    name: 'RunTestAgent',
    provider: 'mock-run',
    model: 'mock-model',
    workspaceRoot: dir,
  });
  await service.init();
});
```

移除 `ctx` 变量和相关导入。

- [ ] **Step 3: 运行 bridge 全部测试**

```bash
pnpm --filter rem-agent-bridge test
```

Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add packages/bridge/tests/agent-service.test.ts packages/bridge/tests/agent-service-run.test.ts
git commit -m "test(bridge): update tests for new AgentService init flow

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: 全仓验证与收尾

**Files:**
- 全仓

**Interfaces:**
- 无新增接口。

- [ ] **Step 1: 运行全仓类型检查**

```bash
pnpm typecheck
```

Expected: PASS。

- [ ] **Step 2: 运行全仓测试**

```bash
pnpm test
```

Expected: PASS。

- [ ] **Step 3: 检查 bridge 不直接读取环境变量**

```bash
grep -R "OPENAI_API_KEY\|ANTHROPIC_API_KEY" packages/bridge/src packages/bridge/tests || true
```

Expected: 无命中（允许在测试 mock 或错误消息中出现，但不应有 `process.env.OPENAI_API_KEY` 直接读取）。

- [ ] **Step 4: 提交（若需）**

如无代码改动则无需提交；若有修复则单独提交。

---

## Self-Review Checklist

- [ ] **Spec coverage**: 每个 spec 要求都有对应 task。
  - `AgentContextBuilder` 在 Core → Task 1
  - `createAgentFromEnv` 向后兼容 → Task 2
  - `AgentService` 自包含 + `init()` → Task 4
  - Web 容器简化 → Task 5
  - 红线（bridge 不读 env）→ Task 7 Step 3
  - 测试覆盖 → Task 1、4、6
- [ ] **Placeholder scan**: 无 "TBD"/"TODO"/"implement later"。
- [ ] **Type consistency**:
  - `AgentContextBuildOptions` 在 Task 1 定义，在 Task 4 作为 `AgentServiceOptions` 使用。
  - `buildAgentContext` 签名在 Task 1、2、4 中保持一致。
  - `AgentService` 构造函数参数类型在 Task 4、5、6 中保持一致。

---

## 执行交接

计划已保存到 `docs/superpowers/plans/2026-07-07-agent-service-provider-init.md`。

两种执行方式可选：

1. **Subagent-Driven（推荐）** — 每个 task 派一个独立子代理执行，task 之间我进行审查，迭代快。
2. **Inline Execution** — 在当前会话使用 `superpowers:executing-plans` 批量执行，带检查点。

你想用哪种？
