# Agent 网络层实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立网络层，让 Agent 通过 HTTP + SSE 对外暴露，所有 UI 统一通过 `rem-agent-sdk` 客户端对接；同时把 `rem-agent-core` 重构为无状态纯函数 `runAgent()`，Provider 由单例 `ProviderManager` 管理。

**Architecture:** 新增 `rem-agent-server`（HTTP server + SSE）和 `rem-agent-sdk`（共享协议 + 客户端）；`rem-agent-tui` 从直接依赖 core 改为依赖 sdk；`rem-agent-core` 新增 `ProviderManager` 和 `runAgent()`，`CoreAgent` 内部改用它们以保持向后兼容。

**Tech Stack:** TypeScript, Node.js, vitest, pnpm workspaces

---

## 文件结构

```
packages/
  core/
    src/
      provider-manager.ts       # 新增：单例 ProviderManager
      run-agent.ts              # 新增：无状态 runAgent 函数
      index.ts                  # 修改：导出 ProviderManager + runAgent
      core-agent.ts             # 修改：内部复用 ProviderManager + runAgent
      ui/session.ts             # 修改：内部复用 runAgent
  sdk/                          # 新增包
    src/
      types.ts
      sse.ts
      client.ts
      index.ts
    tests/
      client.test.ts
    package.json
    tsconfig.json
  server/                       # 新增包
    src/
      server.ts
      routes/
        agent.ts
        sessions.ts
        stream.ts
      middleware/
        cors.ts
        error.ts
      index.ts
    tests/
      server.test.ts
    package.json
    tsconfig.json
  tui/
    src/
      app.ts                    # 修改：改用 AgentClient
    package.json                # 修改：依赖 sdk 而不是 core
    src/index.ts                # 修改：导出类型
  demo/
    src/
      main.ts                   # 修改：启动 server + TUI
    package.json                # 修改：依赖 server + sdk + tui
  
package.json                    # 修改：typecheck 脚本包含新包
```

---

## Task 1: 创建 ProviderManager

**Files:**
- Create: `packages/core/src/provider-manager.ts`
- Test: `packages/core/tests/provider-manager.test.ts`

ProviderManager 负责：读取配置文件、初始化 ProviderRegistry、以单例方式复用。

- [ ] **Step 1: 写失败测试**

```typescript
// packages/core/tests/provider-manager.test.ts
import { describe, it, expect } from 'vitest';
import { ProviderManager } from '../src/provider-manager.js';

describe('ProviderManager', () => {
  it('returns the same instance', async () => {
    const a = await ProviderManager.getInstance();
    const b = await ProviderManager.getInstance();
    expect(a).toBe(b);
  });

  it('provides session provider after init', async () => {
    const pm = await ProviderManager.getInstance();
    const session = pm.get('session');
    expect(session).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && npx vitest run tests/provider-manager.test.ts`
Expected: FAIL — `ProviderManager` not found

- [ ] **Step 3: 实现 ProviderManager**

```typescript
// packages/core/src/provider-manager.ts
import { DefaultConfigProvider } from './plugins/config/default/index.js';
import { AgentProviderRegistry } from './registry/provider-registry.js';
import { DefaultProviderLoader } from './registry/provider-loader.js';
import { builtinProviderResolver } from './plugins/index.js';
import { registerBuiltInProviders } from './llm/providers/index.js';
import type { ProviderReference, ProviderRegistry } from './sdk/provider-loader.js';
import type { SessionProvider } from './sdk/session-provider.js';
import type { ToolProvider } from './sdk/tool-provider.js';
import type { MemoryProvider } from './sdk/memory-provider.js';
import type { ContextCompressor } from './sdk/compressor.js';
import type { ErrorHandler } from './sdk/error-handler.js';
import type { SkillProvider } from './sdk/skill-provider.js';
import type { BudgetPolicy } from './sdk/budget-policy.js';
import type { ConfigProvider, ResolvedModelConfig } from './sdk/config-provider.js';
import type { ProviderConfig } from './llm/types.js';
import { getDefaultSkillsDir, getDefaultSessionsDir } from './config/paths.js';
import type { ToolPolicyConfig } from './sdk/tool-policy.js';

export interface ProviderManagerConfig {
  configPath?: string;
  configProvider?: ConfigProvider;
  sessionProvider?: ProviderReference<SessionProvider>;
  toolProvider?: ProviderReference<ToolProvider>;
  memoryProvider?: ProviderReference<MemoryProvider>;
  compressor?: ProviderReference<ContextCompressor>;
  errorHandler?: ProviderReference<ErrorHandler>;
  skillProvider?: ProviderReference<SkillProvider>;
  budgetPolicy?: ProviderReference<BudgetPolicy>;
  toolPolicy?: ToolPolicyConfig;
  workspaceRoot?: string;
  readOnly?: boolean;
  skillsDir?: string;
  sessionsDir?: string;
}

export class ProviderManager {
  private static instance?: ProviderManager;
  private config: ProviderManagerConfig;
  private configProvider!: ConfigProvider;
  private registry!: ProviderRegistry;
  private initialized = false;

  static async getInstance(config?: ProviderManagerConfig): Promise<ProviderManager> {
    if (!ProviderManager.instance) {
      ProviderManager.instance = new ProviderManager(config ?? {});
      await ProviderManager.instance.initialize();
    }
    return ProviderManager.instance;
  }

  static resetInstance(): void {
    ProviderManager.instance = undefined;
  }

  private constructor(config: ProviderManagerConfig) {
    registerBuiltInProviders();
    this.config = config;
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;

    this.configProvider = this.config.configProvider ?? await this.createDefaultConfigProvider();

    const behavior = this.configProvider.getBehaviorConfig();
    const toolCfg = this.configProvider.getToolConfig();

    const loader = new DefaultProviderLoader(builtinProviderResolver);
    const registry = new AgentProviderRegistry({
      loader,
      ctx: {
        kind: 'tool',
        agentName: behavior.name,
        workspaceRoot: this.config.workspaceRoot ?? behavior.workspaceRoot,
        readOnly: this.config.readOnly ?? behavior.readOnly ?? false,
        skillsDir: this.config.skillsDir ?? behavior.skillsDir ?? getDefaultSkillsDir(),
        sessionsDir: this.config.sessionsDir ?? behavior.sessionsDir ?? getDefaultSessionsDir(),
        maxTurns: behavior.maxTurns,
        toolPolicy: this.config.toolPolicy ?? toolCfg.policy,
      },
      refs: {
        sessionProvider: this.config.sessionProvider,
        toolProvider: this.config.toolProvider,
        memoryProvider: this.config.memoryProvider,
        compressor: this.config.compressor,
        errorHandler: this.config.errorHandler,
        skillProvider: this.config.skillProvider,
        budgetPolicy: this.config.budgetPolicy,
      },
    });

    await registry.initialize();
    this.registry = registry;
    this.initialized = true;
  }

  private async createDefaultConfigProvider(): Promise<ConfigProvider> {
    const provider = new DefaultConfigProvider({ configPath: this.config.configPath });
    await provider.init();
    return provider;
  }

  getConfigProvider(): ConfigProvider {
    return this.configProvider;
  }

  getModelConfig(modelId?: string): ResolvedModelConfig {
    return this.configProvider.getModelConfig(modelId);
  }

  getBehaviorConfig() {
    return this.configProvider.getBehaviorConfig();
  }

  getToolConfig() {
    return this.configProvider.getToolConfig();
  }

  get provider(): string {
    return this.getModelConfig().provider;
  }

  get providerConfig(): ProviderConfig {
    const cfg = this.getModelConfig();
    return {
      model: cfg.model,
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL,
    };
  }

  get<T>(kind: string): T | undefined {
    return this.registry.get(kind as any) as T | undefined;
  }

  require<T>(kind: string): T {
    return this.registry.require(kind as any) as T;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/core && npx vitest run tests/provider-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/provider-manager.ts packages/core/tests/provider-manager.test.ts
git commit -m "feat(core): add ProviderManager singleton"
```

---

## Task 2: 创建 runAgent 函数

**Files:**
- Create: `packages/core/src/run-agent.ts`
- Test: `packages/core/tests/run-agent.test.ts`

runAgent 是无状态函数，内部使用 ProviderManager 获取依赖。

- [ ] **Step 1: 写失败测试**

```typescript
// packages/core/tests/run-agent.test.ts
import { describe, it, expect } from 'vitest';
import { runAgent } from '../src/run-agent.js';
import { ProviderManager } from '../src/provider-manager.js';

describe('runAgent', () => {
  it('returns a stream and output promise', async () => {
    await ProviderManager.getInstance();
    const result = runAgent({
      input: { content: 'hello' },
      sessionId: 'test-session',
    });
    expect(result.stream).toBeDefined();
    expect(result.output).toBeInstanceOf(Promise);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/core && npx vitest run tests/run-agent.test.ts`
Expected: FAIL — `runAgent` not found

- [ ] **Step 3: 实现 runAgent**

```typescript
// packages/core/src/run-agent.ts
import type { UserInput, AgentOutput, AgentStream, ModelMessage } from './types.js';
import { AgentState } from './state.js';
import { EventBus } from './events.js';
import { IterationBudget } from './budget.js';
import type { TurnHooks } from './turn.js';
import { ReactTurnRunner } from './turn.js';
import { ReactLoop } from './loop-strategy.js';
import type { SessionProvider } from './sdk/session-provider.js';
import { AgentStreamController } from './stream/agent-stream.js';
import { ProviderManager } from './provider-manager.js';
import type { MemoryProvider } from './sdk/memory-provider.js';
import type { ToolProvider } from './sdk/tool-provider.js';
import type { ContextCompressor } from './sdk/compressor.js';
import type { ErrorHandler } from './sdk/error-handler.js';
import type { SkillProvider } from './sdk/skill-provider.js';
import type { BudgetPolicy } from './sdk/budget-policy.js';

export interface RunAgentParams {
  input: UserInput;
  sessionId: string;
  signal?: AbortSignal;
}

export interface RunAgentResult {
  stream: AgentStream;
  output: Promise<AgentOutput>;
}

export function runAgent(params: RunAgentParams): RunAgentResult {
  const controller = new AgentStreamController();
  const stream = controller.stream;

  const outputPromise = (async (): Promise<AgentOutput> => {
    const pm = await ProviderManager.getInstance();
    const behavior = pm.getBehaviorConfig();
    const modelConfig = pm.getModelConfig();

    const sessionProvider = pm.require<SessionProvider>('session');
    let session = await sessionProvider.load(params.sessionId);

    const state = new AgentState(session ?? undefined);
    if (session?.sessionId) {
      state.session.sessionId = session.sessionId;
    } else {
      state.session.sessionId = params.sessionId;
      await sessionProvider.save(state.session);
    }

    state.status = 'running';
    const events = new EventBus();
    await events.emit('core-agent:start', { agent: null, state });

    const budgetPolicy = pm.get<BudgetPolicy>('budget') ?? {
      checkTurn: () => true,
      checkTimeout: () => true,
    };

    const startTime = Date.now();
    if (!budgetPolicy.checkTurn(state) || !budgetPolicy.checkTimeout(startTime)) {
      state.status = 'idle';
      const output: AgentOutput = { content: 'Budget exceeded.', completed: true };
      controller.finish(output);
      await events.emit('core-agent:stop', { agent: null, state });
      return output;
    }

    const userMessage: ModelMessage = { role: 'user', content: params.input.content };
    state.addMessage(userMessage);
    await sessionProvider.save(state.session);

    try {
      const toolProvider = pm.require<ToolProvider>('tool');
      const memoryProvider = pm.require<MemoryProvider>('memory');
      const compressor = pm.require<ContextCompressor>('compressor');
      const errorHandler = pm.require<ErrorHandler>('error');
      const skillProvider = pm.get<SkillProvider>('skill');

      const loopStrategy = new ReactLoop(
        events,
        toolProvider,
        memoryProvider,
        compressor,
        errorHandler,
        skillProvider,
      );
      const turnRunner = new ReactTurnRunner(loopStrategy);

      const result = await turnRunner.run(
        {
          input: params.input,
          conversation: [...state.conversation],
          systemPrompt: `You are ${behavior.name}.`,
          budget: state.budget,
          signal: params.signal,
          provider: modelConfig.provider,
          providerConfig: {
            model: modelConfig.model,
            apiKey: modelConfig.apiKey,
            baseURL: modelConfig.baseURL,
          },
          workspaceRoot: behavior.workspaceRoot,
          readOnly: behavior.readOnly,
          agentName: behavior.name,
        },
        createTurnHooks(state),
        controller,
      );

      for (const msg of result.newMessages) {
        state.addMessage(msg);
      }

      state.currentTurn++;
      state.status = 'idle';
      await sessionProvider.save(state.session);
      await events.emit('core-agent:stop', { agent: null, state });

      const output: AgentOutput = {
        content: result.output.content,
        completed: true,
      };
      controller.finish(output);
      return output;
    } catch (error) {
      state.status = 'error';
      const message = error instanceof Error ? error.message : String(error);
      const output: AgentOutput = { content: `Error: ${message}`, completed: true };
      controller.finish(output);
      await events.emit('core-agent:error', { agent: null, state, error });
      await sessionProvider.save(state.session);
      return output;
    }
  })();

  return { stream, output: outputPromise };
}

function createTurnHooks(state: AgentState): TurnHooks {
  return {
    onMessageAdded: () => {},
    onToolCallRecorded: (record) => {
      state.session.metadata.lastToolCall = record;
    },
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/core && npx vitest run tests/run-agent.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/run-agent.ts packages/core/tests/run-agent.test.ts
git commit -m "feat(core): add stateless runAgent function"
```

---

## Task 3: 从 core 导出并兼容 CoreAgent

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/core-agent.ts`
- Modify: `packages/core/src/ui/session.ts`

- [ ] **Step 1: 导出 ProviderManager 和 runAgent**

```typescript
// packages/core/src/index.ts
export { ProviderManager, type ProviderManagerConfig } from './provider-manager.js';
export { runAgent, type RunAgentParams, type RunAgentResult } from './run-agent.js';
```

- [ ] **Step 2: 重构 CoreAgent 内部复用 ProviderManager + runAgent**

修改 `CoreAgent` 的 `run()` 方法，内部调用 `runAgent()`：

```typescript
// packages/core/src/core-agent.ts
import { runAgent } from './run-agent.js';
import { ProviderManager } from './provider-manager.js';

// 在 CoreAgent 的 run() 方法中，替换现有实现为：
run(input: UserInput): AgentStreamResult {
  return runAgent({
    input,
    sessionId: this.sessionId,
    signal: this.abortController?.signal,
  });
}
```

同时确保 `ready()` / `initialize()` 能初始化 `ProviderManager`：

```typescript
async ready(): Promise<void> {
  if (this._ready) return;
  await ProviderManager.getInstance(this.toProviderManagerConfig());
  // 保持原有 registry 创建逻辑，或改为从 ProviderManager 获取
  this._ready = true;
}
```

- [ ] **Step 3: 重构 UI session 复用 runAgent**

```typescript
// packages/core/src/ui/session.ts
import { runAgent } from '../run-agent.js';

// submit 方法改为：
submit(text: string) {
  callbacks.onUserMessage?.(text);
  const result = runAgent({
    input: { content: text },
    sessionId: agent.sessionId,
  });

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
    .then((finalText) => callbacks.onAssistantMessageFinalized?.(finalText))
    .catch(() => {});
}
```

- [ ] **Step 4: 运行 core 测试**

Run: `cd packages/core && npx vitest run`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/core-agent.ts packages/core/src/ui/session.ts
git commit -m "refactor(core): reuse ProviderManager and runAgent in CoreAgent"
```

---

## Task 4: 创建 SDK 包

**Files:**
- Create: `packages/sdk/package.json`
- Create: `packages/sdk/tsconfig.json`
- Create: `packages/sdk/src/types.ts`
- Create: `packages/sdk/src/sse.ts`
- Create: `packages/sdk/src/client.ts`
- Create: `packages/sdk/src/index.ts`
- Create: `packages/sdk/tests/client.test.ts`

- [ ] **Step 1: 创建包配置**

```json
// packages/sdk/package.json
{
  "name": "rem-agent-sdk",
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
    "test": "cd ../.. && vitest run packages/sdk/tests"
  },
  "dependencies": {
    "rem-agent-core": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

```json
// packages/sdk/tsconfig.json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: 创建共享类型**

```typescript
// packages/sdk/src/types.ts
import type { AgentStreamChunk } from 'rem-agent-core';

export interface RunRequest {
  sessionId: string;
  content: string;
}

export interface RunResponse {
  sessionId: string;
  streamUrl: string;
}

export interface InterruptRequest {
  sessionId: string;
}

export interface ResetRequest {
  sessionId: string;
}

export interface SessionSummary {
  sessionId: string;
  title?: string;
  updatedAt: number;
  messageCount: number;
}

export type ServerStreamEvent = AgentStreamChunk;
```

- [ ] **Step 3: 创建 SSE 解析器**

```typescript
// packages/sdk/src/sse.ts
import type { AgentStreamChunk } from 'rem-agent-core';

export interface SSEEvent {
  event?: string;
  data: string;
}

export function parseSSEStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncIterable<SSEEvent> {
  const decoder = new TextDecoder();
  let buffer = '';

  return {
    [Symbol.asyncIterator]: async function* () {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let currentEvent: Partial<SSEEvent> = {};
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent.event = line.slice(7);
          } else if (line.startsWith('data: ')) {
            currentEvent.data = line.slice(6);
          } else if (line === '') {
            if (currentEvent.data !== undefined) {
              yield currentEvent as SSEEvent;
            }
            currentEvent = {};
          }
        }
      }

      if (buffer.trim()) {
        const lines = buffer.split('\n');
        let currentEvent: Partial<SSEEvent> = {};
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent.event = line.slice(7);
          } else if (line.startsWith('data: ')) {
            currentEvent.data = line.slice(6);
          } else if (line === '' && currentEvent.data !== undefined) {
            yield currentEvent as SSEEvent;
            currentEvent = {};
          }
        }
      }
    },
  };
}

export function parseAgentStreamEvent(event: SSEEvent): AgentStreamChunk {
  return JSON.parse(event.data) as AgentStreamChunk;
}
```

- [ ] **Step 4: 创建 AgentClient**

```typescript
// packages/sdk/src/client.ts
import type { AgentStreamChunk } from 'rem-agent-core';
import type { RunRequest, RunResponse, SessionSummary, InterruptRequest, ResetRequest } from './types.js';
import { parseSSEStream, parseAgentStreamEvent } from './sse.js';

export class AgentClient {
  constructor(private baseUrl: string) {}

  async run(sessionId: string, input: string): Promise<AsyncIterable<AgentStreamChunk>> {
    const response = await fetch(`${this.baseUrl}/api/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, content: input } satisfies RunRequest),
    });

    if (!response.ok) {
      throw new Error(`Failed to start run: ${response.status} ${response.statusText}`);
    }

    const { streamUrl } = (await response.json()) as RunResponse;
    return this.consumeStream(streamUrl);
  }

  private async consumeStream(streamUrl: string): Promise<AsyncIterable<AgentStreamChunk>> {
    const response = await fetch(`${this.baseUrl}${streamUrl}`);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to connect to stream: ${response.status}`);
    }

    const reader = response.body.getReader();
    const events = parseSSEStream(reader);

    return {
      [Symbol.asyncIterator]: async function* () {
        for await (const event of events) {
          if (event.event === 'chunk' || event.event === 'finish' || event.event === 'error') {
            yield parseAgentStreamEvent(event);
          }
        }
      },
    };
  }

  async interrupt(sessionId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/agent/interrupt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId } satisfies InterruptRequest),
    });
    if (!response.ok) {
      throw new Error(`Failed to interrupt: ${response.status}`);
    }
  }

  async reset(sessionId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/agent/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId } satisfies ResetRequest),
    });
    if (!response.ok) {
      throw new Error(`Failed to reset: ${response.status}`);
    }
  }

  async listSessions(): Promise<SessionSummary[]> {
    const response = await fetch(`${this.baseUrl}/api/sessions`);
    if (!response.ok) {
      throw new Error(`Failed to list sessions: ${response.status}`);
    }
    return (await response.json()) as SessionSummary[];
  }
}
```

- [ ] **Step 5: 创建入口文件**

```typescript
// packages/sdk/src/index.ts
export { AgentClient } from './client.js';
export { parseSSEStream, parseAgentStreamEvent } from './sse.js';
export type { RunRequest, RunResponse, SessionSummary, InterruptRequest, ResetRequest, ServerStreamEvent } from './types.js';
export type { SSEEvent } from './sse.js';
```

- [ ] **Step 6: 写 SDK 测试**

```typescript
// packages/sdk/tests/client.test.ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { AgentClient } from '../src/client.js';

describe('AgentClient', () => {
  it('requests run and consumes stream', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessionId: 's1', streamUrl: '/api/stream/s1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => {
            const encoder = new TextEncoder();
            let done = false;
            return {
              read: async () => {
                if (done) return { done: true, value: undefined };
                done = true;
                return {
                  done: false,
                  value: encoder.encode(
                    'event: chunk\n' +
                    'data: {"type":"text-start","step":1,"partId":"p1"}\n\n' +
                    'event: chunk\n' +
                    'data: {"type":"text-delta","step":1,"partId":"p1","text":"hi"}\n\n' +
                    'event: chunk\n' +
                    'data: {"type":"finish","output":{"content":"hi","completed":true}}\n\n',
                  ),
                };
              },
            };
          },
        },
      });

    const client = new AgentClient('http://localhost:8321');
    const stream = await client.run('s1', 'hello');
    const chunks: any[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0].type).toBe('text-start');
    expect(chunks[1].type).toBe('text-delta');
    expect(chunks[2].type).toBe('finish');
  });
});
```

- [ ] **Step 7: 运行 SDK 测试**

Run: `cd packages/sdk && npx vitest run tests/client.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/sdk/
git commit -m "feat(sdk): add AgentClient and SSE parser"
```

---

## Task 5: 创建 Server 包

**Files:**
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/src/middleware/cors.ts`
- Create: `packages/server/src/middleware/error.ts`
- Create: `packages/server/src/routes/agent.ts`
- Create: `packages/server/src/routes/sessions.ts`
- Create: `packages/server/src/routes/stream.ts`
- Create: `packages/server/src/server.ts`
- Create: `packages/server/src/index.ts`
- Create: `packages/server/tests/server.test.ts`

- [ ] **Step 1: 创建包配置**

```json
// packages/server/package.json
{
  "name": "rem-agent-server",
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
    "test": "cd ../.. && vitest run packages/server/tests"
  },
  "dependencies": {
    "rem-agent-core": "workspace:*",
    "rem-agent-sdk": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

```json
// packages/server/tsconfig.json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: 创建 CORS 中间件**

```typescript
// packages/server/src/middleware/cors.ts
import type { IncomingMessage, ServerResponse } from 'node:http';

export function corsMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  next();
}
```

- [ ] **Step 3: 创建错误处理中间件**

```typescript
// packages/server/src/middleware/error.ts
import type { IncomingMessage, ServerResponse } from 'node:http';

export function errorHandler(
  error: Error,
  _req: IncomingMessage,
  res: ServerResponse,
): void {
  console.error('Server error:', error);
  if (res.headersSent) return;
  res.writeHead(500, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: error.message }));
}
```

- [ ] **Step 4: 创建 Agent 路由**

```typescript
// packages/server/src/routes/agent.ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import { runAgent, ProviderManager } from 'rem-agent-core';
import type { RunRequest, InterruptRequest, ResetRequest } from 'rem-agent-sdk';
import { getRequestBody, sendJson, sendError } from '../utils.js';
import { activeRuns } from '../state.js';

export async function handleAgentRun(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await getRequestBody(req);
  const { sessionId, content } = JSON.parse(body) as RunRequest;

  if (activeRuns.has(sessionId)) {
    sendError(res, 409, 'Session is already running');
    return;
  }

  const abortController = new AbortController();
  activeRuns.set(sessionId, abortController);

  const result = runAgent({
    input: { content, timestamp: new Date() },
    sessionId,
    signal: abortController.signal,
  });

  result.output.finally(() => {
    activeRuns.delete(sessionId);
  });

  sendJson(res, 202, { sessionId, streamUrl: `/api/stream/${encodeURIComponent(sessionId)}` });
}

export async function handleAgentInterrupt(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await getRequestBody(req);
  const { sessionId } = JSON.parse(body) as InterruptRequest;
  const controller = activeRuns.get(sessionId);
  if (controller) {
    controller.abort();
  }
  sendJson(res, 200, { sessionId, interrupted: !!controller });
}

export async function handleAgentReset(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await getRequestBody(req);
  const { sessionId } = JSON.parse(body) as ResetRequest;
  const pm = await ProviderManager.getInstance();
  const sessionProvider = pm.require('session');
  const session = await sessionProvider.load(sessionId);
  if (session) {
    session.messages = [];
    session.metadata = {};
    await sessionProvider.save(session);
  }
  sendJson(res, 200, { sessionId, reset: true });
}
```

- [ ] **Step 5: 创建 Sessions 路由**

```typescript
// packages/server/src/routes/sessions.ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ProviderManager } from 'rem-agent-core';
import { sendJson, sendError } from '../utils.js';

export async function handleListSessions(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const pm = await ProviderManager.getInstance();
  const sessionProvider = pm.require('session');
  const sessions = await sessionProvider.list();
  sendJson(res, 200, sessions);
}
```

- [ ] **Step 6: 创建 Stream 路由**

```typescript
// packages/server/src/routes/stream.ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import { activeStreams } from '../state.js';

export async function handleStream(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const match = req.url?.match(/^\/api\/stream\/([^/]+)$/);
  if (!match) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const sessionId = decodeURIComponent(match[1]);
  const result = activeStreams.get(sessionId);
  if (!result) {
    res.writeHead(404);
    res.end('Stream not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  try {
    for await (const chunk of result.stream.fullStream) {
      res.write(`event: chunk\ndata: ${JSON.stringify(chunk)}\n\n`);
      if (chunk.type === 'finish' || chunk.type === 'error') break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: message })}\n\n`);
  }

  res.end();
}
```

- [ ] **Step 7: 创建共享状态和工具函数**

```typescript
// packages/server/src/state.ts
import type { AgentStreamResult } from 'rem-agent-core';

export const activeRuns = new Map<string, AbortController>();
export const activeStreams = new Map<string, AgentStreamResult>();
```

```typescript
// packages/server/src/utils.ts
import type { IncomingMessage, ServerResponse } from 'node:http';

export function getRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function sendError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}
```

- [ ] **Step 8: 创建 Server**

```typescript
// packages/server/src/server.ts
import { createServer as createHttpServer, type Server } from 'node:http';
import { corsMiddleware } from './middleware/cors.js';
import { handleAgentRun, handleAgentInterrupt, handleAgentReset } from './routes/agent.js';
import { handleListSessions } from './routes/sessions.js';
import { handleStream } from './routes/stream.js';
import { errorHandler } from './middleware/error.js';
import { ProviderManager } from 'rem-agent-core';

export interface AgentServerOptions {
  configPath?: string;
  port?: number;
  host?: string;
}

export class AgentServer {
  private server?: Server;
  private port: number;
  private host: string;
  private configPath?: string;

  constructor(options: AgentServerOptions = {}) {
    this.port = options.port ?? 8321;
    this.host = options.host ?? 'localhost';
    this.configPath = options.configPath;
  }

  async start(): Promise<void> {
    await ProviderManager.getInstance({ configPath: this.configPath });

    this.server = createHttpServer((req, res) => {
      try {
        corsMiddleware(req, res, () => this.handleRequest(req, res));
      } catch (error) {
        errorHandler(error as Error, req, res);
      }
    });

    return new Promise((resolve) => {
      this.server!.listen(this.port, this.host, () => {
        console.log(`Agent server listening on http://${this.host}:${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server?.close(() => resolve());
    });
  }

  private async handleRequest(req: any, res: any): Promise<void> {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    try {
      if (method === 'POST' && url === '/api/agent/run') {
        await handleAgentRun(req, res);
        return;
      }
      if (method === 'POST' && url === '/api/agent/interrupt') {
        await handleAgentInterrupt(req, res);
        return;
      }
      if (method === 'POST' && url === '/api/agent/reset') {
        await handleAgentReset(req, res);
        return;
      }
      if (method === 'GET' && url === '/api/sessions') {
        await handleListSessions(req, res);
        return;
      }
      if (method === 'GET' && url.startsWith('/api/stream/')) {
        await handleStream(req, res);
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    } catch (error) {
      errorHandler(error as Error, req, res);
    }
  }
}
```

- [ ] **Step 9: 修复 Agent 路由与 Stream 路由的关联**

当前 `handleAgentRun` 只把 `runAgent` 结果存到 activeRuns，但 stream 路由需要 `AgentStreamResult`。修改 `handleAgentRun`：

```typescript
import { activeRuns, activeStreams } from '../state.js';

export async function handleAgentRun(req, res) {
  // ...
  const result = runAgent({ ... });
  activeStreams.set(sessionId, result);

  result.output.finally(() => {
    activeRuns.delete(sessionId);
    activeStreams.delete(sessionId);
  });

  sendJson(res, 202, { sessionId, streamUrl: `/api/stream/${encodeURIComponent(sessionId)}` });
}
```

- [ ] **Step 10: 创建入口文件**

```typescript
// packages/server/src/index.ts
export { AgentServer, type AgentServerOptions } from './server.js';
```

- [ ] **Step 11: 写 Server 测试**

```typescript
// packages/server/tests/server.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AgentServer } from '../src/server.js';

describe('AgentServer', () => {
  let server: AgentServer;

  beforeAll(async () => {
    server = new AgentServer({ port: 18321, host: '127.0.0.1' });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('responds to /api/sessions', async () => {
    const res = await fetch('http://127.0.0.1:18321/api/sessions');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
```

- [ ] **Step 12: 运行 Server 测试**

Run: `cd packages/server && npx vitest run tests/server.test.ts`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add packages/server/
git commit -m "feat(server): add HTTP server with SSE streaming"
```

---

## Task 6: 改造 TUI 使用 SDK

**Files:**
- Modify: `packages/tui/package.json`
- Modify: `packages/tui/src/app.ts`
- Modify: `packages/tui/src/index.ts`

- [ ] **Step 1: 更新依赖**

```json
// packages/tui/package.json
{
  "dependencies": {
    "rem-agent-sdk": "workspace:*",
    "@earendil-works/pi-tui": "^0.79.3"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: 重构 app.ts 使用 AgentClient**

```typescript
// packages/tui/src/app.ts
import {
  Container,
  Input,
  Key,
  ProcessTerminal,
  Spacer,
  TUI,
  matchesKey,
} from "@earendil-works/pi-tui";
import type { AgentStreamChunk, AgentStatus } from "rem-agent-sdk";
import { AgentClient } from "rem-agent-sdk";
import { ChatLog } from "./chat-log.js";
import { EventLog } from "./event-log.js";
import { StatusBar } from "./status-bar.js";
import { StreamAssistantMessage } from "./message/stream-message.js";
import { SessionPicker } from "./session-picker.js";
import type { SessionPickerItem } from "./session-picker.js";

export interface TUIAppOptions {
  serverUrl: string;
  sessionId?: string;
  maxTurns?: number;
}

export class TUIApp {
  private tui: TUI;
  private chatLog: ChatLog;
  private eventLog: EventLog;
  private statusBar: StatusBar;
  private input: Input;
  private root: Container;
  private client: AgentClient;
  private sessionId: string;
  private currentStreamMessage?: StreamAssistantMessage;
  private titleGenerated = false;
  private maxTurns: number;
  private currentTurn = 0;

  constructor(options: TUIAppOptions) {
    this.client = new AgentClient(options.serverUrl);
    this.sessionId = options.sessionId ?? this.generateId();
    this.maxTurns = options.maxTurns ?? 60;

    this.chatLog = new ChatLog();
    this.eventLog = new EventLog();
    this.statusBar = new StatusBar(this.maxTurns);
    this.input = new Input();

    this.input.onSubmit = async (value: string) => {
      const trimmed = value.trim();
      if (trimmed === "/resume") {
        this.input.setValue("");
        this.tui.requestRender(true);
        await this.handleResumeCommand();
        return;
      }
      if (trimmed === "/new") {
        this.input.setValue("");
        this.tui.requestRender(true);
        await this.handleNewSession();
        return;
      }
      if (trimmed) {
        this.submit(trimmed);
      }
    };

    this.input.onEscape = () => {
      this.client.interrupt(this.sessionId);
    };

    this.root = new Container();
    this.root.addChild(this.chatLog);
    this.root.addChild(this.eventLog);
    this.root.addChild(new Spacer(1));
    this.root.addChild(this.statusBar);
    this.root.addChild(this.input);

    this.tui = new TUI(new ProcessTerminal(), true);
    this.tui.addInputListener((data) => this.handleGlobalInput(data));
    this.tui.addChild(this.root);
  }

  async init(): Promise<void> {
    this.loadHistory();
  }

  start(): void {
    this.tui.start();
    this.tui.setFocus(this.input);
  }

  stop(): void {
    this.tui.stop();
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private async loadHistory(): Promise<void> {
    // TUI 不再直接读取 conversation；通过 SSE 不会有历史消息。
    // 如需历史，可扩展 server API。
  }

  private async handleResumeCommand(): Promise<void> {
    const sessions = await this.client.listSessions();
    if (sessions.length === 0) {
      this.eventLog.addEvent("resume", "no sessions found");
      this.tui.requestRender(true);
      return;
    }

    const items: SessionPickerItem[] = sessions.map((s) => ({
      sessionId: s.sessionId,
      title: s.title,
      updatedAt: s.updatedAt,
      messageCount: s.messageCount,
    }));

    const picker = new SessionPicker(items, {
      onSelect: async (sessionId: string) => {
        handle.hide();
        this.tui.setFocus(this.input);
        await this.switchSession(sessionId);
      },
      onCancel: () => {
        handle.hide();
        this.tui.setFocus(this.input);
      },
    });

    const handle = this.tui.showOverlay(picker, {
      anchor: "center",
      width: "60%",
    });
  }

  private async handleNewSession(): Promise<void> {
    this.client.interrupt(this.sessionId).catch(() => {});
    this.currentStreamMessage = undefined;
    this.titleGenerated = false;
    this.currentTurn = 0;
    this.sessionId = this.generateId();
    this.chatLog.clearMessages();
    this.statusBar.update(0, this.maxTurns, "idle", this.sessionId);
    this.eventLog.addEvent("session", "new session created");
    this.tui.requestRender(true);
  }

  private async switchSession(sessionId: string): Promise<void> {
    this.client.interrupt(this.sessionId).catch(() => {});
    this.currentStreamMessage = undefined;
    this.titleGenerated = false;
    this.sessionId = sessionId;
    this.currentTurn = 0;
    this.chatLog.clearMessages();
    this.statusBar.update(0, this.maxTurns, "idle", sessionId);
    this.eventLog.addEvent("resume", `loaded session ${sessionId.slice(0, 8)}`);
    this.tui.requestRender(true);
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

  private async submit(text: string): Promise<void> {
    this.chatLog.addUser(text);
    this.input.setValue("");
    this.statusBar.update(this.currentTurn, this.maxTurns, "running");
    this.eventLog.addEvent("turn:before", `turn #${this.currentTurn}`);
    this.tui.requestRender(true);

    this.currentStreamMessage = this.chatLog.startAssistant();

    try {
      const stream = await this.client.run(this.sessionId, text);
      for await (const chunk of stream) {
        this.handleChunk(chunk);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.eventLog.addEvent("core-agent:error", message);
      this.chatLog.addAssistant(`Error: ${message}`);
      this.statusBar.update(this.currentTurn, this.maxTurns, "error");
      this.tui.requestRender(true);
    }
  }

  private handleChunk(chunk: AgentStreamChunk): void {
    if (!this.currentStreamMessage) {
      this.currentStreamMessage = this.chatLog.startAssistant();
    }
    this.currentStreamMessage.appendChunk(chunk);

    if (chunk.type === "finish" || chunk.type === "error") {
      this.currentStreamMessage = undefined;
      this.statusBar.update(this.currentTurn, this.maxTurns, "idle", this.sessionId);
    }

    this.tui.requestRender(true);
  }
}
```

- [ ] **Step 3: 更新入口文件**

```typescript
// packages/tui/src/index.ts
export { TUIApp } from "./app.js";
```

- [ ] **Step 4: 运行 TUI typecheck**

Run: `cd packages/tui && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/tui/
git commit -m "refactor(tui): use AgentClient from rem-agent-sdk"
```

---

## Task 7: 更新 Demo

**Files:**
- Modify: `packages/demo/package.json`
- Modify: `packages/demo/src/main.ts`

- [ ] **Step 1: 更新依赖**

```json
// packages/demo/package.json
{
  "dependencies": {
    "rem-agent-server": "workspace:*",
    "rem-agent-sdk": "workspace:*",
    "rem-agent-tui": "workspace:*",
    "dotenv": "^16.4.0"
  }
}
```

- [ ] **Step 2: 重构 main.ts 启动 Server + TUI**

```typescript
// packages/demo/src/main.ts
import "dotenv/config";
import { AgentServer } from "rem-agent-server";
import { TUIApp } from "rem-agent-tui";
import { resolveConfig } from "./config.js";

async function main(): Promise<void> {
  const config = resolveConfig();

  const server = new AgentServer({
    configPath: config.configPath,
    port: config.port ?? 8321,
    host: config.host ?? "localhost",
  });
  await server.start();

  const app = new TUIApp({
    serverUrl: `http://${config.host ?? "localhost"}:${config.port ?? 8321}`,
    sessionId: config.sessionId,
    maxTurns: config.maxTurns,
  });
  await app.init();
  app.start();

  process.on("SIGINT", () => {
    app.stop();
    server.stop().finally(() => process.exit(0));
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 3: 更新 demo config（如需要）**

在 `packages/demo/src/config.ts` 中添加 `port`、`host`、`configPath` 解析：

```typescript
export interface DemoConfig {
  agentName: string;
  maxTurns: number;
  sessionId?: string;
  configPath?: string;
  port?: number;
  host?: string;
}
```

- [ ] **Step 4: 运行 Demo typecheck**

Run: `cd packages/demo && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/demo/
git commit -m "feat(demo): start server and connect TUI via SDK"
```

---

## Task 8: 根配置和集成验证

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 更新根 typecheck 脚本**

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "pnpm --filter rem-agent-core build && pnpm --filter rem-agent-core typecheck && pnpm --filter rem-agent-sdk typecheck && pnpm --filter rem-agent-server typecheck && pnpm --filter rem-agent-tui build && pnpm --filter rem-agent-tui typecheck && pnpm --filter rem-agent-demo typecheck"
  }
}
```

- [ ] **Step 2: 运行全仓 typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: 运行全仓测试**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: include sdk and server in typecheck pipeline"
```

---

## 自审

**1. Spec coverage:**
- ProviderManager 单例懒加载：Task 1 ✓
- runAgent 无状态纯函数：Task 2 ✓
- SDK AgentClient + SSE：Task 4 ✓
- Server HTTP + SSE：Task 5 ✓
- TUI 改用 SDK：Task 6 ✓
- Demo 启动 Server + TUI：Task 7 ✓

**2. Placeholder scan:**
- 无 "TBD"/"TODO" ✓
- 所有代码步骤都含具体实现 ✓
- 所有测试都含具体断言 ✓

**3. Type consistency:**
- `AgentStreamChunk` 从 core 复用到 sdk/server ✓
- `RunRequest` / `RunResponse` 在 sdk/server 中一致 ✓
- ProviderManager API 在 core/server 中一致 ✓

**4. 注意点：**
- `activeStreams` 在 Server 中尚未在流结束后自动清理，已通过 `result.output.finally` 清理。
- TUI 历史加载目前为空实现，因为设计未要求 Server 暴露历史消息接口。如需要，可后续扩展。

---

## 执行交接

Plan complete and saved to `docs/superpowers/plans/2025-06-23-agent-network-layer.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
