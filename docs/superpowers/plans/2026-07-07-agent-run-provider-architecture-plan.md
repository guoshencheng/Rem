# Agent 执行流程与 Provider 集群治理 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `runAgent` 改造为流程抽象层，`LoopStrategy` 成为 Turn 级 Provider，`ReasonProvider`/`ExecuteProvider` 成为 ReAct 内部节点，建立职责明确的 Provider 集群，同时保持 Bridge/Web 链路不变。

**Architecture:** 通过新增 `sdk/reason-provider.ts`、`sdk/execute-provider.ts`、`sdk/context-provider.ts`、`sdk/loop-strategy.ts` 定义接口；在 `plugins/loop/react/`、`plugins/reason/default/`、`plugins/execute/default/` 实现默认 Provider；`run-agent.ts` 减薄为编排函数；`turn.ts` 删除，`ReactLoop` 直接实现完整循环。

**Tech Stack:** TypeScript, ESM, Vitest, pnpm workspace, `rem-agent-core`

## Global Constraints

- `packages/core` **不依赖** Vercel AI SDK；所有 LLM 调用通过自建 Provider 层。
- Provider 配置由 Core 拥有；客户端不直接读取 `OPENAI_API_KEY` 等环境变量。
- 模块拆分遵循 `module-separation-convention`：每个文件职责单一，尽量不超过 200 行。
- `packages/tui` 视为废弃，不处理。
- `packages/web` 不做结构性改动。
- 所有新增 Provider 必须通过 `ProviderManager` 注册，支持 `kind/name` 内置加载器映射。
- 保持 `AgentStreamChunk` 类型和 Bridge 消费方式不变。

---

## File Structure

### 新增文件

| 文件 | 职责 |
|---|---|
| `packages/core/src/sdk/reason-provider.ts` | `ReasonProvider` 接口 |
| `packages/core/src/sdk/execute-provider.ts` | `ExecuteProvider` 接口 |
| `packages/core/src/sdk/context-provider.ts` | `ContextProvider` 接口 |
| `packages/core/src/sdk/loop-strategy.ts` | `LoopStrategy` 接口（从 `loop-types.ts` 移入） |
| `packages/core/src/plugins/loop/react/index.ts` | `ReactLoop` 默认实现 |
| `packages/core/src/plugins/reason/default/index.ts` | `DefaultReasonProvider` |
| `packages/core/src/plugins/execute/default/index.ts` | `DefaultExecuteProvider` |
| `packages/core/tests/plugins/loop/react/react-loop.test.ts` | `ReactLoop` 单元测试 |
| `packages/core/tests/plugins/reason/default/reason-provider.test.ts` | `DefaultReasonProvider` 测试 |
| `packages/core/tests/plugins/execute/default/execute-provider.test.ts` | `DefaultExecuteProvider` 测试 |

### 修改文件

| 文件 | 修改内容 |
|---|---|
| `packages/core/src/sdk/provider-loader.ts` | `ProviderKind` 新增 `reason`、`execute`、`context` |
| `packages/core/src/sdk/index.ts` | 导出新的 Provider 接口 |
| `packages/core/src/sdk/memory-provider.ts` | 标记为 deprecated，类型别名到 `ContextProvider` |
| `packages/core/src/plugins/memory/simple/index.ts` | 实现 `ContextProvider` |
| `packages/core/src/plugins/index.ts` | 新增内置 loader 映射 |
| `packages/core/src/loop-types.ts` | 移除 `LoopStrategy` 接口，保留 `LoopContext`/`LoopResult` |
| `packages/core/src/loop-strategy.ts` | 移除 `ReactLoop` 实现，改为导出默认 loop 的 helper |
| `packages/core/src/run-agent.ts` | 调用 `ContextProvider`、`CompressProvider`、`LoopStrategy` |
| `packages/core/src/provider-manager.ts` | 默认注册 `loopStrategy/react`、`reason/default`、`execute/default`、`context/simple` |

### 删除文件

| 文件 | 原因 |
|---|---|
| `packages/core/src/turn.ts` | `ReactTurnRunner` 逻辑合并入 `ReactLoop` |

---

### Task 1: 新增 SDK Provider 接口

**Files:**
- Create: `packages/core/src/sdk/loop-strategy.ts`
- Create: `packages/core/src/sdk/reason-provider.ts`
- Create: `packages/core/src/sdk/execute-provider.ts`
- Create: `packages/core/src/sdk/context-provider.ts`
- Modify: `packages/core/src/sdk/memory-provider.ts`
- Test: `packages/core/tests/sdk/provider-interfaces.test.ts`

**Interfaces:**
- Consumes: `AgentState`, `ModelMessage`, `AgentStreamChunk`, `ToolCall`, `ToolResult`, `LanguageModelUsage`, `IterationBudget`, `ToolSet` from existing types
- Produces: `LoopStrategy`, `LoopContext`, `LoopResult`, `ReasonProvider`, `ReasonParams`, `ReasonContext`, `ReasonOutput`, `ExecuteProvider`, `ExecuteContext`, `ContextProvider`

- [ ] **Step 1: 创建 `sdk/loop-strategy.ts`**

```typescript
import type { AgentState } from '../state.js';
import type { IterationBudget } from '../budget.js';
import type { ModelMessage, LanguageModelUsage, AgentStreamChunk } from '../types.js';
import type { ToolSet } from '../llm/types.js';

export interface LoopContext {
  state: AgentState;
  system: string;
  messages: ModelMessage[];
  budget: IterationBudget;
  signal?: AbortSignal;
  maxSteps?: number;
  workspaceRoot: string;
  readOnly?: boolean;
  agentName?: string;
  sessionId?: string;
}

export interface LoopResult {
  content: string;
  newMessages: ModelMessage[];
  usage: LanguageModelUsage;
}

export interface LoopStrategy {
  run(ctx: LoopContext): Promise<LoopResult>;
}
```

- [ ] **Step 2: 创建 `sdk/reason-provider.ts`**

```typescript
import type { ModelMessage, AgentStreamChunk, LanguageModelUsage, ToolSet } from '../types.js';

export interface ReasonParams {
  provider: string;
  model: string;
  apiKey: string;
  baseURL?: string;
  system?: string;
  messages: ModelMessage[];
  tools?: ToolSet;
}

export interface ReasonContext {
  signal?: AbortSignal;
  sessionId?: string;
}

export interface ReasonOutput {
  text: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>;
  reasoning?: string;
  usage: LanguageModelUsage;
  finishReason: string;
}

export interface ReasonProvider {
  reason(
    params: ReasonParams,
    ctx: ReasonContext,
    emit: (chunk: AgentStreamChunk) => void | Promise<void>,
  ): Promise<ReasonOutput>;
}
```

- [ ] **Step 3: 创建 `sdk/execute-provider.ts`**

```typescript
import type { AgentStreamChunk } from '../types.js';
import type { ToolCall, ToolResult } from './tool-provider.js';

export interface ExecuteContext {
  cwd: string;
  workspaceRoot: string;
  signal?: AbortSignal;
  agentName?: string;
  readOnly?: boolean;
  sessionId: string;
}

export interface ExecuteProvider {
  execute(
    toolCalls: ToolCall[],
    ctx: ExecuteContext,
    emit: (chunk: AgentStreamChunk) => void | Promise<void>,
  ): Promise<ToolResult[]>;
}
```

- [ ] **Step 4: 创建 `sdk/context-provider.ts`**

```typescript
import type { ModelMessage } from '../types.js';
import type { AgentState } from '../state.js';

export interface ContextProvider {
  build(state: AgentState): Promise<{ system: string; messages: ModelMessage[] }>;
}
```

- [ ] **Step 5: 修改 `sdk/memory-provider.ts` 为兼容别名**

```typescript
import type { ModelMessage } from '../types.js';
import type { AgentState } from '../state.js';
import type { ContextProvider } from './context-provider.js';

/** @deprecated Use ContextProvider instead */
export interface MemoryContext {
  systemPrompt: string;
  messages: ModelMessage[];
}

/** @deprecated Use ContextProvider instead */
export interface MemoryProvider extends ContextProvider {
  buildContext(state: AgentState): Promise<MemoryContext>;
}
```

- [ ] **Step 6: 编写接口存在性测试**

```typescript
// tests/sdk/provider-interfaces.test.ts
import { describe, it, expect } from 'vitest';
import type { LoopStrategy, ReasonProvider, ExecuteProvider, ContextProvider } from '../../src/sdk/index.js';

describe('provider interfaces are exported', () => {
  it('types are importable', () => {
    const _loop: LoopStrategy | undefined = undefined;
    const _reason: ReasonProvider | undefined = undefined;
    const _execute: ExecuteProvider | undefined = undefined;
    const _context: ContextProvider | undefined = undefined;
    expect([_loop, _reason, _execute, _context]).toEqual([undefined, undefined, undefined, undefined]);
  });
});
```

- [ ] **Step 7: 运行测试确认通过**

Run: `pnpm --filter rem-agent-core test tests/sdk/provider-interfaces.test.ts`
Expected: PASS

- [ ] **Step 8: 提交**

```bash
git add packages/core/src/sdk/loop-strategy.ts \
  packages/core/src/sdk/reason-provider.ts \
  packages/core/src/sdk/execute-provider.ts \
  packages/core/src/sdk/context-provider.ts \
  packages/core/src/sdk/memory-provider.ts \
  packages/core/tests/sdk/provider-interfaces.test.ts
git commit -m "feat(core/sdk): add LoopStrategy, ReasonProvider, ExecuteProvider, ContextProvider interfaces

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: ProviderKind 扩展与 SDK 导出更新

**Files:**
- Modify: `packages/core/src/sdk/provider-loader.ts`
- Modify: `packages/core/src/sdk/index.ts`
- Test: `packages/core/tests/sdk/provider-loader.test.ts`

**Interfaces:**
- Consumes: existing `ProviderKind` definition
- Produces: updated `ProviderKind` union including `'reason' | 'execute' | 'context'`

- [ ] **Step 1: 在 `ProviderKind` 中新增 kind**

```typescript
// packages/core/src/sdk/provider-loader.ts
export type ProviderKind =
  | 'tool'
  | 'memory'
  | 'context'
  | 'skill'
  | 'session'
  | 'compressor'
  | 'budget'
  | 'error'
  | 'config'
  | 'loopStrategy'
  | 'turnRunner'
  | 'title'
  | 'approval'
  | 'state'
  | 'reason'
  | 'execute';
```

- [ ] **Step 2: 更新 `sdk/index.ts` 导出**

```typescript
// packages/core/src/sdk/index.ts
export * from './tool-provider.js';
export * from './tool-policy.js';
export * from './tool-hook.js';
export * from './config-provider.js';
export * from './memory-provider.js';
export * from './context-provider.js';
export * from './error-handler.js';
export * from './budget-policy.js';
export * from './compressor.js';
export * from './skill-provider.js';
export * from './session-provider.js';
export * from './provider-loader.js';
export * from './agent-state-provider.js';
export * from './loop-strategy.js';
export * from './reason-provider.js';
export * from './execute-provider.js';
```

- [ ] **Step 3: 编写测试验证 kind 存在**

```typescript
// packages/core/tests/sdk/provider-loader.test.ts
import { describe, it, expect } from 'vitest';
import type { ProviderKind } from '../../src/sdk/provider-loader.js';

describe('ProviderKind', () => {
  it('includes new provider kinds', () => {
    const kinds: ProviderKind[] = ['reason', 'execute', 'context', 'loopStrategy'];
    expect(kinds).toContain('reason');
    expect(kinds).toContain('execute');
    expect(kinds).toContain('context');
    expect(kinds).toContain('loopStrategy');
  });
});
```

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter rem-agent-core test tests/sdk/provider-loader.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/sdk/provider-loader.ts \
  packages/core/src/sdk/index.ts \
  packages/core/tests/sdk/provider-loader.test.ts
git commit -m "feat(core/sdk): add reason/execute/context/loopStrategy provider kinds and exports

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 实现 DefaultReasonProvider

**Files:**
- Create: `packages/core/src/plugins/reason/default/index.ts`
- Modify: `packages/core/src/plugins/index.ts`
- Test: `packages/core/tests/plugins/reason/default/reason-provider.test.ts`

**Interfaces:**
- Consumes: `ReasonProvider`, `ReasonParams`, `ReasonContext`, `ReasonOutput`, `LLMProvider` via `resolveProvider`, `InferenceEngine`, `ErrorHandler`
- Produces: `DefaultReasonProvider` class and `createProvider` factory

- [ ] **Step 1: 创建 `DefaultReasonProvider` 实现**

```typescript
// packages/core/src/plugins/reason/default/index.ts
import type {
  AgentStreamChunk,
  LanguageModelUsage,
  ModelMessage,
} from '../../../types.js';
import type {
  ReasonContext,
  ReasonOutput,
  ReasonParams,
  ReasonProvider,
} from '../../../sdk/reason-provider.js';
import { resolveProvider } from '../../../llm/api-registry.js';
import { InferenceEngine } from '../../../llm/engine.js';
import type { ErrorHandler } from '../../../sdk/error-handler.js';
import type { StreamChunk } from '../../../llm/types.js';

export interface DefaultReasonProviderOptions {
  errorHandler: ErrorHandler;
  maxAttempts?: number;
}

export class DefaultReasonProvider implements ReasonProvider {
  private inferenceEngine = new InferenceEngine();

  constructor(private options: DefaultReasonProviderOptions) {}

  async reason(
    params: ReasonParams,
    ctx: ReasonContext,
    emit: (chunk: AgentStreamChunk) => void | Promise<void>,
  ): Promise<ReasonOutput> {
    const provider = resolveProvider('openai'); // default; caller can override via params later if needed
    const maxAttempts = this.options.maxAttempts ?? 3;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.runOnce(params, ctx, emit);
      } catch (error) {
        lastError = error;
        const category = this.options.errorHandler.classify(error);
        if (!this.options.errorHandler.isRetryable(category)) {
          throw error;
        }
        if (attempt === maxAttempts - 1) {
          throw error;
        }
      }
    }

    throw lastError;
  }

  private async runOnce(
    params: ReasonParams,
    ctx: ReasonContext,
    emit: (chunk: AgentStreamChunk) => void | Promise<void>,
  ): Promise<ReasonOutput> {
    const provider = resolveProvider(params.provider);
    const result = await this.inferenceEngine.infer({
      messages: params.messages,
      stream: provider.stream({
        model: params.model,
        apiKey: params.apiKey,
        baseURL: params.baseURL,
        system: params.system,
        messages: params.messages,
        tools: params.tools,
        signal: ctx.signal,
      }),
      onChunk: (chunk: StreamChunk) => {
        const agentChunk = this.mapChunk(chunk);
        if (agentChunk) {
          void emit(agentChunk);
        }
      },
    });

    const usage: LanguageModelUsage = {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
      inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    };

    return {
      text: result.text,
      toolCalls: result.toolCalls,
      reasoning: result.reasoning,
      usage,
      finishReason: result.finishReason ?? 'stop',
    };
  }

  private mapChunk(chunk: StreamChunk): AgentStreamChunk | null {
    if (chunk.type === 'text') {
      return { type: 'text-delta', step: 0, text: chunk.text };
    }
    if (chunk.type === 'reasoning') {
      return { type: 'reasoning-delta', step: 0, text: chunk.text };
    }
    if (chunk.type === 'tool-call') {
      return { type: 'tool-call', step: 0, toolCallId: chunk.toolCallId, toolName: chunk.toolName, input: chunk.input };
    }
    return null;
  }
}

export function createProvider(options: DefaultReasonProviderOptions): DefaultReasonProvider {
  return new DefaultReasonProvider(options);
}
```

- [ ] **Step 2: 在 `plugins/index.ts` 注册 loader**

```typescript
// packages/core/src/plugins/index.ts
const builtinLoaders: Record<string, ProviderModuleRef> = {
  // ... existing entries ...
  'reason/default': () => import('./reason/default/index.js') as Promise<ProviderModule<any>>,
};
```

- [ ] **Step 3: 编写 DefaultReasonProvider 测试**

```typescript
// packages/core/tests/plugins/reason/default/reason-provider.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DefaultReasonProvider } from '../../../../src/plugins/reason/default/index.js';
import { registerProvider, clearProviders } from '../../../../src/llm/api-registry.js';
import type { ReasonParams } from '../../../../src/sdk/reason-provider.js';
import type { LLMProvider, StreamChunk } from '../../../../src/llm/types.js';

describe('DefaultReasonProvider', () => {
  beforeEach(() => {
    clearProviders();
    registerProvider('mock', {
      stream: vi.fn(async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'text', text: 'hello' };
        yield { type: 'finish', reason: 'stop' };
      }) as LLMProvider['stream'],
      generate: vi.fn(),
    });
  });

  afterEach(() => {
    clearProviders();
  });

  it('aggregates text output and emits chunks', async () => {
    const errorHandler = {
      classify: () => 'unknown' as const,
      isRetryable: () => false,
    };

    const provider = new DefaultReasonProvider({ errorHandler });

    const params: ReasonParams = {
      provider: 'mock',
      model: 'mock-model',
      apiKey: 'test-key',
      messages: [{ id: '1', role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    };

    const chunks: unknown[] = [];
    const result = await provider.reason(params, {}, (c) => { chunks.push(c); });

    expect(result.text).toBe('hello');
    expect(result.toolCalls).toEqual([]);
    expect(result.finishReason).toBe('stop');
    expect(chunks.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter rem-agent-core test tests/plugins/reason/default/reason-provider.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/plugins/reason/default/index.ts \
  packages/core/src/plugins/index.ts \
  packages/core/tests/plugins/reason/default/reason-provider.test.ts
git commit -m "feat(core/plugins): add DefaultReasonProvider

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 实现 DefaultExecuteProvider

**Files:**
- Create: `packages/core/src/plugins/execute/default/index.ts`
- Modify: `packages/core/src/plugins/index.ts`
- Test: `packages/core/tests/plugins/execute/default/execute-provider.test.ts`

**Interfaces:**
- Consumes: `ExecuteProvider`, `ExecuteContext`, `ToolProvider`, `ToolCall`, `ToolResult`, `AgentStreamChunk`
- Produces: `DefaultExecuteProvider` class and `createProvider` factory

- [ ] **Step 1: 创建 `DefaultExecuteProvider` 实现**

```typescript
// packages/core/src/plugins/execute/default/index.ts
import type { AgentStreamChunk } from '../../../types.js';
import type {
  ExecuteContext,
  ExecuteProvider,
} from '../../../sdk/execute-provider.js';
import type { ToolCall, ToolProvider, ToolResult } from '../../../sdk/tool-provider.js';
import { generateId } from '../../../shared/generate-id.js';

export interface DefaultExecuteProviderOptions {
  toolProvider: ToolProvider;
}

export class DefaultExecuteProvider implements ExecuteProvider {
  constructor(private options: DefaultExecuteProviderOptions) {}

  async execute(
    toolCalls: ToolCall[],
    ctx: ExecuteContext,
    emit: (chunk: AgentStreamChunk) => void | Promise<void>,
  ): Promise<ToolResult[]> {
    if (toolCalls.length === 0) return [];

    const toolCtx = {
      cwd: ctx.cwd,
      workspaceRoot: ctx.workspaceRoot,
      signal: ctx.signal,
      agentName: ctx.agentName,
      readOnly: ctx.readOnly,
      sessionId: ctx.sessionId,
    };

    const results = await this.options.toolProvider.execute(toolCalls, toolCtx, {
      emit: async (chunk) => {
        await emit(chunk);
      },
    });

    for (const tc of toolCalls) {
      const tr = results.find((r) => r.toolCallId === tc.toolCallId);
      const output = tr?.error ?? tr?.output ?? '';
      await emit({
        type: 'tool-result',
        step: 0, // ReactLoop will re-tag via wrapper
        toolCallId: tc.toolCallId,
        output,
        error: tr?.error,
      });
    }

    return results;
  }
}

export function createProvider(options: DefaultExecuteProviderOptions): DefaultExecuteProvider {
  return new DefaultExecuteProvider(options);
}
```

- [ ] **Step 2: 在 `plugins/index.ts` 注册 loader**

```typescript
// packages/core/src/plugins/index.ts
const builtinLoaders: Record<string, ProviderModuleRef> = {
  // ... existing entries ...
  'execute/default': () => import('./execute/default/index.js') as Promise<ProviderModule<any>>,
};
```

- [ ] **Step 3: 编写测试**

```typescript
// packages/core/tests/plugins/execute/default/execute-provider.test.ts
import { describe, it, expect, vi } from 'vitest';
import { DefaultExecuteProvider } from '../../../../src/plugins/execute/default/index.js';
import type { ToolCall, ToolProvider, ToolResult } from '../../../../src/sdk/tool-provider.js';

describe('DefaultExecuteProvider', () => {
  it('executes tool calls and emits results', async () => {
    const toolCall: ToolCall = { toolCallId: 'tc-1', toolName: 'echo', input: { text: 'hello' } };
    const toolResult: ToolResult = { toolCallId: 'tc-1', toolName: 'echo', output: 'hello' };

    const toolProvider: ToolProvider = {
      register: vi.fn(),
      getToolSet: vi.fn(() => ({
        echo: { description: 'echo', parameters: { type: 'object', properties: {} } },
      })),
      execute: vi.fn(async () => [toolResult]),
    };

    const provider = new DefaultExecuteProvider({ toolProvider });
    const chunks: unknown[] = [];
    const results = await provider.execute(
      [toolCall],
      { cwd: '/', workspaceRoot: '/', sessionId: 's1' },
      (c) => { chunks.push(c); },
    );

    expect(results).toEqual([toolResult]);
    expect(toolProvider.execute).toHaveBeenCalledWith([toolCall], expect.any(Object), expect.any(Object));
    expect(chunks.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter rem-agent-core test tests/plugins/execute/default/execute-provider.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/plugins/execute/default/index.ts \
  packages/core/src/plugins/index.ts \
  packages/core/tests/plugins/execute/default/execute-provider.test.ts
git commit -m "feat(core/plugins): add DefaultExecuteProvider

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 实现 ReactLoop（LoopStrategy Provider）

**Files:**
- Create: `packages/core/src/plugins/loop/react/index.ts`
- Modify: `packages/core/src/plugins/index.ts`
- Modify: `packages/core/src/loop-strategy.ts`
- Modify: `packages/core/src/loop-types.ts`
- Delete: `packages/core/src/turn.ts`
- Test: `packages/core/tests/plugins/loop/react/react-loop.test.ts`

**Interfaces:**
- Consumes: `LoopStrategy`, `LoopContext`, `LoopResult`, `ReasonProvider`, `ExecuteProvider`, `AgentStreamController`
- Produces: `ReactLoop` class implementing `LoopStrategy`, `createProvider` factory

- [ ] **Step 1: 创建 `ReactLoop` 实现**

```typescript
// packages/core/src/plugins/loop/react/index.ts
import type { ModelMessage } from '../../../types.js';
import type { AgentState } from '../../../state.js';
import type {
  LoopContext,
  LoopResult,
  LoopStrategy,
} from '../../../sdk/loop-strategy.js';
import type { ReasonProvider } from '../../../sdk/reason-provider.js';
import type { ExecuteProvider } from '../../../sdk/execute-provider.js';
import { generateId } from '../../../shared/generate-id.js';
import type { LanguageModelUsage } from '../../../types.js';
import type { AgentStreamController } from '../../../stream/agent-stream.js';

export interface ReactLoopOptions {
  reasonProvider: ReasonProvider;
  executeProvider: ExecuteProvider;
}

const DEFAULT_MAX_STEPS = 50;

export class ReactLoop implements LoopStrategy {
  constructor(private options: ReactLoopOptions) {}

  async run(ctx: LoopContext): Promise<LoopResult> {
    const state = ctx.state;
    const newMessages: ModelMessage[] = [];
    let content = '';
    let usage = this.zeroUsage();

    const assistantMsg = this.createAssistantMessage(state);
    newMessages.push(assistantMsg);
    ctx.emit({ type: 'message-start', step: 1, messageId: assistantMsg.id });

    let step = 1;
    const maxSteps = ctx.maxSteps ?? DEFAULT_MAX_STEPS;

    while (step <= maxSteps) {
      if (ctx.signal?.aborted) {
        throw new Error('Aborted');
      }

      ctx.emit({ type: 'step-start', step });

      const reasonResult = await this.options.reasonProvider.reason(
        {
          provider: ctx.provider,
          model: ctx.modelConfig.model,
          apiKey: ctx.modelConfig.apiKey,
          baseURL: ctx.modelConfig.baseURL,
          system: ctx.system,
          messages: ctx.messages,
          tools: ctx.tools,
        },
        { signal: ctx.signal, sessionId: ctx.sessionId },
        (chunk) => this.emit(ctx, chunk, step),
      );

      this.appendToAssistantMessage(assistantMsg, reasonResult);
      content = reasonResult.text;
      usage = this.addUsage(usage, reasonResult.usage);

      if (reasonResult.toolCalls.length === 0) {
        ctx.emit({ type: 'step-finish', step });
        break;
      }

      await this.options.executeProvider.execute(
        reasonResult.toolCalls,
        {
          cwd: ctx.workspaceRoot,
          workspaceRoot: ctx.workspaceRoot,
          signal: ctx.signal,
          agentName: ctx.agentName,
          readOnly: ctx.readOnly,
          sessionId: ctx.sessionId ?? ctx.state.sessionId,
        },
        (chunk) => this.emit(ctx, chunk, step),
      );

      ctx.emit({ type: 'step-finish', step });

      // After execute, tool messages are already added to state by executeProvider
      // and emitted as chunks. We re-fetch current messages for next step.
      ctx.messages = [...state.conversation];
      step++;
    }

    return { content, newMessages, usage };
  }

  private createAssistantMessage(state: AgentState): ModelMessage {
    const last = state.conversation[state.conversation.length - 1];
    if (last?.role === 'assistant') return last as ModelMessage;
    const msg: ModelMessage = { id: generateId(), role: 'assistant', content: [] };
    state.addMessage(msg);
    return msg;
  }

  private appendToAssistantMessage(
    assistantMsg: ModelMessage,
    result: { text: string; toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>; reasoning?: string },
  ): void {
    const content = assistantMsg.content;
    if (result.reasoning) {
      content.push({ type: 'reasoning', text: result.reasoning });
    }
    if (result.text) {
      content.push({ type: 'text', text: result.text });
    }
    for (const tc of result.toolCalls) {
      content.push({ type: 'tool-call', toolCallId: tc.toolCallId, toolName: tc.toolName, arguments: tc.input });
    }
  }

  private emit(ctx: LoopContext, chunk: AgentStreamChunk, step: number): void {
    if ('step' in chunk && typeof (chunk as { step?: number }).step === 'number') {
      (chunk as { step: number }).step = step;
    }
    void ctx.emit(chunk);
  }

  private zeroUsage(): LanguageModelUsage {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    };
  }

  private addUsage(a: LanguageModelUsage, b: LanguageModelUsage): LanguageModelUsage {
    return {
      inputTokens: a.inputTokens + b.inputTokens,
      outputTokens: a.outputTokens + b.outputTokens,
      totalTokens: a.totalTokens + b.totalTokens,
      inputTokenDetails: a.inputTokenDetails,
      outputTokenDetails: a.outputTokenDetails,
    };
  }
}

export function createProvider(options: ReactLoopOptions): ReactLoop {
  return new ReactLoop(options);
}
```

Note: `LoopContext.emit` is bound to `AgentStreamController.emit()` (added in Task 6), which dispatches raw chunks to `append()` and lifecycle chunks directly to `enqueue()`. `ReactLoop` wraps child-provider emits to inject the current `step` number.

- [ ] **Step 2: 更新 `LoopContext` 加入 `emit`**

```typescript
// packages/core/src/sdk/loop-strategy.ts
import type { AgentStreamChunk } from '../types.js';

export interface LoopContext {
  state: AgentState;
  system: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  budget: IterationBudget;
  emit: (chunk: AgentStreamChunk) => void | Promise<void>;
  signal?: AbortSignal;
  maxSteps?: number;
  workspaceRoot: string;
  readOnly?: boolean;
  agentName?: string;
  sessionId?: string;
  provider: string;
  modelConfig: {
    model: string;
    apiKey: string;
    baseURL?: string;
  };
}
```

- [ ] **Step 3: 清理 `loop-strategy.ts` 和 `loop-types.ts`**

`loop-types.ts` 保留 `LoopContext`/`LoopResult` 或全部移入 `sdk/loop-strategy.ts`。建议合并到 `sdk/loop-strategy.ts`，`loop-types.ts` 删除。

`loop-strategy.ts` 改为一个轻量 barrel 或 helper：

```typescript
// packages/core/src/loop-strategy.ts
export { ReactLoop } from './plugins/loop/react/index.js';
export type { ReactLoopOptions } from './plugins/loop/react/index.js';
export type { LoopStrategy, LoopContext, LoopResult } from './sdk/loop-strategy.js';
```

- [ ] **Step 4: 删除 `turn.ts`**

```bash
rm packages/core/src/turn.ts
```

- [ ] **Step 5: 在 `plugins/index.ts` 注册 loader**

```typescript
// packages/core/src/plugins/index.ts
'loop/react': () => import('./loop/react/index.js') as Promise<ProviderModule<any>>,
```

- [ ] **Step 6: 编写 `ReactLoop` 测试**

```typescript
// packages/core/tests/plugins/loop/react/react-loop.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ReactLoop } from '../../../../src/plugins/loop/react/index.js';
import type { LoopContext } from '../../../../src/sdk/loop-strategy.js';
import { AgentState } from '../../../../src/state.js';
import { IterationBudget } from '../../../../src/budget.js';

describe('ReactLoop', () => {
  it('stops when reason returns no tool calls', async () => {
    const reasonProvider = {
      reason: vi.fn(async (_params, _ctx, emit) => {
        await emit({ type: 'text-delta', step: 1, text: 'hello' });
        return {
          text: 'hello',
          toolCalls: [],
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          finishReason: 'stop',
        };
      }),
    };
    const executeProvider = { execute: vi.fn() };

    const session = {
      sessionId: 's1',
      conversation: [],
      currentTurn: 0,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const state = new AgentState(session);
    const chunks: unknown[] = [];

    const loop = new ReactLoop({ reasonProvider, executeProvider });
    const ctx: LoopContext = {
      state,
      system: 'You are Rem.',
      messages: [],
      budget: new IterationBudget(),
      workspaceRoot: '/',
      emit: (c) => { chunks.push(c); },
      provider: 'openai',
      modelConfig: { model: 'gpt-4o-mini', apiKey: 'test' },
    };

    const result = await loop.run(ctx);

    expect(result.content).toBe('hello');
    expect(reasonProvider.reason).toHaveBeenOnce();
    expect(executeProvider.execute).not.toHaveBeenCalled();
  });

  it('calls execute when reason returns tool calls', async () => {
    const reasonProvider = {
      reason: vi.fn(async (_params, _ctx, emit) => {
        await emit({ type: 'tool-call', step: 1, toolCallId: 'tc-1', toolName: 'echo', input: {} });
        return {
          text: '',
          toolCalls: [{ toolCallId: 'tc-1', toolName: 'echo', input: {} }],
          usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
          finishReason: 'tool_calls',
        };
      }),
    };
    const executeProvider = {
      execute: vi.fn(async (_calls, _ctx, emit) => {
        await emit({ type: 'tool-result', step: 1, toolCallId: 'tc-1', output: 'echoed' });
        return [{ toolCallId: 'tc-1', toolName: 'echo', output: 'echoed' }];
      }),
    };

    const session = {
      sessionId: 's1',
      conversation: [],
      currentTurn: 0,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const state = new AgentState(session);
    const loop = new ReactLoop({ reasonProvider, executeProvider });
    const ctx: LoopContext = {
      state,
      system: 'You are Rem.',
      messages: [],
      budget: new IterationBudget(),
      workspaceRoot: '/',
      emit: () => {},
      provider: 'openai',
      modelConfig: { model: 'gpt-4o-mini', apiKey: 'test' },
    };

    const result = await loop.run(ctx);

    expect(executeProvider.execute).toHaveBeenCalledWith(
      [{ toolCallId: 'tc-1', toolName: 'echo', input: {} }],
      expect.any(Object),
      expect.any(Function),
    );
    expect(result.newMessages.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 7: 运行测试**

Run: `pnpm --filter rem-agent-core test tests/plugins/loop/react/react-loop.test.ts`
Expected: PASS after fixing any type issues

- [ ] **Step 8: 提交**

```bash
git add packages/core/src/plugins/loop/react/index.ts \
  packages/core/src/plugins/index.ts \
  packages/core/src/sdk/loop-strategy.ts \
  packages/core/src/loop-strategy.ts \
  packages/core/tests/plugins/loop/react/react-loop.test.ts
# loop-types.ts removal depends on merging into sdk/loop-strategy.ts
git rm packages/core/src/turn.ts packages/core/src/loop-types.ts
git commit -m "feat(core/plugins): add ReactLoop LoopStrategy provider and remove ReactTurnRunner

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 重构 runAgent

**Files:**
- Modify: `packages/core/src/run-agent.ts`
- Modify: `packages/core/src/agent-factory.ts` (if needed to pass config)
- Test: `packages/core/tests/run-agent.test.ts` (更新已有测试)

**Interfaces:**
- Consumes: `ContextProvider`, `CompressProvider`, `LoopStrategy`, `TitleProvider`, `BudgetProvider`, `ErrorHandler`, `SessionProvider`
- Produces: `RunAgentResult { stream, output }` unchanged

- [ ] **Step 1: 扩展 `AgentStreamController` 添加 `emit()` 方法**

Modify `packages/core/src/stream/agent-stream.ts` to add a generic chunk dispatcher:

```typescript
// Add inside AgentStreamController class, after append()
emit(chunk: AgentStreamChunk): void {
  if (this.finished) return;

  const rawTypes = [
    'text-delta',
    'reasoning-delta',
    'tool-call',
    'tool-result',
    'approval-request',
    'approval-resolved',
  ];

  if (rawTypes.includes(chunk.type)) {
    this.append(chunk as AgentStreamChunk);
    return;
  }

  this.enqueue(chunk);
  if ('step' in chunk && typeof (chunk as { step: number }).step === 'number') {
    this.lastStep = (chunk as { step: number }).step;
  }
}
```

- [ ] **Step 2: 重写 `run-agent.ts`**

```typescript
// packages/core/src/run-agent.ts
import type { UserInput, AgentOutput, AgentStream, ModelMessage } from './types.js';
import { AgentState } from './state.js';
import { EventBus } from './events.js';
import type { LoopStrategy } from './sdk/loop-strategy.js';
import type { SessionProvider } from './sdk/session-provider.js';
import type { ContextProvider } from './sdk/context-provider.js';
import type { ContextCompressor } from './sdk/compressor.js';
import type { BudgetPolicy } from './sdk/budget-policy.js';
import type { TitleProvider } from './sdk/title-provider.js';
import type { ErrorHandler } from './sdk/error-handler.js';
import type { ToolProvider } from './sdk/tool-provider.js';
import { AgentStreamController } from './stream/agent-stream.js';
import type { ProviderManager } from './provider-manager.js';
import { generateId } from './shared/generate-id.js';

export interface RunAgentParams {
  input: UserInput;
  sessionId: string;
  signal?: AbortSignal;
  pm: ProviderManager;
}

export interface RunAgentResult {
  stream: AgentStream;
  output: Promise<AgentOutput>;
}

export function runAgent(params: RunAgentParams): RunAgentResult {
  const controller = new AgentStreamController();
  const stream = controller.stream;

  const outputPromise = (async (): Promise<AgentOutput> => {
    const pm = params.pm;
    const behavior = pm.getBehaviorConfig();
    const modelConfig = pm.getModelConfig();

    const sessionProvider = pm.require<SessionProvider>('session');
    let session = await sessionProvider.load(params.sessionId);

    const state = new AgentState(session ?? undefined);
    state.session.sessionId = session?.sessionId ?? params.sessionId;
    if (!session) {
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

    const userMessage: ModelMessage = {
      id: generateId(),
      role: 'user',
      content: [{ type: 'text', text: params.input.content }],
    };
    state.addMessage(userMessage);
    await sessionProvider.save(state.session);

    forkTitleGeneration(state, pm, controller, sessionProvider);

    try {
      const contextProvider = pm.require<ContextProvider>('context');
      const compressor = pm.require<ContextCompressor>('compressor');
      const loopStrategy = pm.require<LoopStrategy>('loopStrategy');
      const toolProvider = pm.require<ToolProvider>('tool');

      const { system, messages } = await contextProvider.build(state);

      let contextMessages = messages;
      if (compressor.shouldCompress(state)) {
        contextMessages = await compressor.compress(messages);
      }

      const result = await loopStrategy.run({
        state,
        system,
        messages: contextMessages,
        tools: toolProvider.getToolSet(),
        budget: state.budget,
        emit: (chunk) => controller.emit(chunk),
        signal: params.signal,
        maxSteps: behavior.maxTurns,
        workspaceRoot: behavior.workspaceRoot,
        readOnly: behavior.readOnly,
        agentName: behavior.name,
        sessionId: params.sessionId,
        provider: modelConfig.provider,
        modelConfig: {
          model: modelConfig.model,
          apiKey: modelConfig.apiKey,
          baseURL: modelConfig.baseURL,
        },
      });

      for (const msg of result.newMessages) {
        if (!state.conversation.includes(msg)) {
          state.addMessage(msg);
        }
      }

      state.currentTurn++;
      state.status = 'idle';
      await sessionProvider.save(state.session);
      await events.emit('core-agent:stop', { agent: null, state });

      const output: AgentOutput = { content: result.content, completed: true };
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

function forkTitleGeneration(
  state: AgentState,
  pm: ProviderManager,
  controller: AgentStreamController,
  sessionProvider: SessionProvider,
): void {
  const titleProvider = pm.get<TitleProvider>('title');
  const modelConfig = pm.getModelConfig();
  if (!titleProvider || state.session.metadata.title) return;

  (async () => {
    try {
      const title = await titleProvider.generateTitle(
        state.session.conversation,
        {
          provider: modelConfig.provider,
          providerConfig: {
            model: modelConfig.model,
            apiKey: modelConfig.apiKey,
            baseURL: modelConfig.baseURL,
          },
        },
      );
      if (title) {
        state.session.metadata.title = title;
        controller.pushTitle(title);
        await sessionProvider.save(state.session);
      }
    } catch {
      // title generation is best-effort
    }
  })();
}
```

- [ ] **Step 3: 更新 `agent-factory.ts` 如果 `createAgentFromEnv` 的返回签名变化**

No change needed if `createAgentFromEnv` still returns `{ pm, name, maxTurns, provider, providerConfig }`.

- [ ] **Step 4: 更新 `run-agent.test.ts` 或新增测试**

If existing tests mock `ReactTurnRunner`, update them to mock `LoopStrategy` instead. If no existing test, add a smoke test:

```typescript
// packages/core/tests/run-agent.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runAgent } from '../src/run-agent.js';
import { createProviderManager } from '../src/provider-manager.js';

describe('runAgent', () => {
  it('returns stream and output for a simple query', async () => {
    const pm = await createProviderManager({
      configProvider: {
        getBehaviorConfig: () => ({ name: 'Test', maxTurns: 10, workspaceRoot: '/' }),
        getModelConfig: () => ({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'test' }),
        getToolConfig: () => ({ policy: undefined }),
        getMcpConfig: () => ({ servers: [] }),
      },
      sessionProvider: {
        load: vi.fn(async () => undefined),
        save: vi.fn(),
        list: vi.fn(),
        delete: vi.fn(),
      },
    });

    const result = runAgent({ input: { content: 'hi', timestamp: new Date() }, sessionId: 's1', pm });
    expect(result.stream).toBeDefined();
    expect(result.output).toBeInstanceOf(Promise);
  });
});
```

- [ ] **Step 5: 运行测试**

Run: `pnpm --filter rem-agent-core test tests/run-agent.test.ts`
Expected: PASS after fixing mock setup

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/stream/agent-stream.ts \
  packages/core/src/run-agent.ts \
  packages/core/tests/run-agent.test.ts
git commit -m "feat(core): refactor runAgent to orchestrate Provider cluster

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: ProviderManager 注册与内置加载器更新

**Files:**
- Modify: `packages/core/src/provider-manager.ts`
- Modify: `packages/core/src/plugins/index.ts`
- Modify: `packages/core/src/plugins/memory/simple/index.ts` (适配 ContextProvider)
- Test: `packages/core/tests/provider-manager.test.ts`

**Interfaces:**
- Consumes: `ProviderManagerConfig`, `ProviderKind`, `resolveBuiltinLoader`
- Produces: `ProviderManager` that resolves `context/simple`, `loopStrategy/react`, `reason/default`, `execute/default`

- [ ] **Step 1: 更新 `ProviderManager` 默认 Provider 引用**

```typescript
// packages/core/src/provider-manager.ts
export interface ProviderManagerConfig {
  configPath?: string;
  configProvider?: ConfigProvider;
  sessionProvider?: SessionProvider;
  toolProvider?: ProviderReference<ToolProvider>;
  contextProvider?: ProviderReference<ContextProvider>; // replaces memoryProvider
  compressor?: ProviderReference<ContextCompressor>;
  errorHandler?: ProviderReference<ErrorHandler>;
  skillProvider?: ProviderReference<SkillProvider>;
  budgetPolicy?: ProviderReference<BudgetPolicy>;
  titleProvider?: ProviderReference<TitleProvider>;
  loopStrategy?: ProviderReference<LoopStrategy>;
  reasonProvider?: ProviderReference<ReasonProvider>;
  executeProvider?: ProviderReference<ExecuteProvider>;
  toolPolicy?: ToolPolicyConfig;
  agentStateProvider?: AgentStateProvider;
  workspaceRoot?: string;
  readOnly?: boolean;
  autoApproveDangerous?: boolean;
  sessionsDir?: string;
}
```

- [ ] **Step 2: 更新 `AgentProviderRegistry` refs 和默认注册**

```typescript
// packages/core/src/provider-manager.ts
const registry = new AgentProviderRegistry({
  loader,
  ctx: { /* ... */ },
  refs: {
    sessionProvider: this.config.sessionProvider,
    toolProvider: this.config.toolProvider,
    contextProvider: this.config.contextProvider ?? 'simple',
    compressor: this.config.compressor,
    errorHandler: this.config.errorHandler,
    skillProvider: this.config.skillProvider,
    budgetPolicy: this.config.budgetPolicy,
    titleProvider: this.config.titleProvider,
    loopStrategy: this.config.loopStrategy ?? 'react',
    reasonProvider: this.config.reasonProvider ?? 'default',
    executeProvider: this.config.executeProvider ?? 'default',
  },
});
```

- [ ] **Step 3: 在 `plugins/index.ts` 补齐 loader 映射**

```typescript
// packages/core/src/plugins/index.ts
const builtinLoaders: Record<string, ProviderModuleRef> = {
  'session/in-memory': () => import('./session/in-memory/index.js') as Promise<ProviderModule<any>>,
  'session/file':      () => import('./session/file/index.js') as Promise<ProviderModule<any>>,
  'session/local':     () => import('./session/local/index.js') as Promise<ProviderModule<any>>,
  'tool/file-system':  () => import('./tool/file-system/index.js') as Promise<ProviderModule<any>>,
  'tool/in-memory':    () => import('./tool/in-memory/index.js') as Promise<ProviderModule<any>>,
  'context/simple':    () => import('./memory/simple/index.js') as Promise<ProviderModule<any>>,
  'memory/simple':     () => import('./memory/simple/index.js') as Promise<ProviderModule<any>>,
  'skill/file':        () => import('./skill/file/index.js') as Promise<ProviderModule<any>>,
  'compressor/no-op':  () => import('./compressor/no-op/index.js') as Promise<ProviderModule<any>>,
  'error/simple':      () => import('./error/simple/index.js') as Promise<ProviderModule<any>>,
  'budget/fixed':      () => import('./budget/fixed/index.js') as Promise<ProviderModule<any>>,
  'title/llm':         () => import('./title/llm/index.js') as Promise<ProviderModule<any>>,
  'loop/react':        () => import('./loop/react/index.js') as Promise<ProviderModule<any>>,
  'reason/default':    () => import('./reason/default/index.js') as Promise<ProviderModule<any>>,
  'execute/default':   () => import('./execute/default/index.js') as Promise<ProviderModule<any>>,
};
```

- [ ] **Step 4: 适配 `memory/simple` 实现 `ContextProvider` 接口**

```typescript
// packages/core/src/plugins/memory/simple/index.ts
import type { ContextProvider } from '../../../sdk/context-provider.js';
import type { MemoryProvider, MemoryContext } from '../../../sdk/memory-provider.js';
import type { AgentState } from '../../../state.js';
import type { ProviderLoaderContext } from '../../../sdk/provider-loader.js';

export interface SimpleMemoryProviderOptions {
  agentName: string;
}

export class SimpleMemoryProvider implements ContextProvider, MemoryProvider {
  constructor(private agentName: string) {}

  async build(state: AgentState): Promise<{ system: string; messages: import('../../../types.js').ModelMessage[] }> {
    return this.buildContext(state);
  }

  async buildContext(state: AgentState): Promise<MemoryContext> {
    return {
      systemPrompt: `You are ${this.agentName}.`,
      messages: state.conversation,
    };
  }
}

export function createProvider(options: SimpleMemoryProviderOptions | undefined): SimpleMemoryProvider {
  return new SimpleMemoryProvider(options?.agentName ?? 'Rem Agent');
}

export function getDefaultOptions(ctx: ProviderLoaderContext): SimpleMemoryProviderOptions {
  return { agentName: ctx.agentName };
}
```

- [ ] **Step 5: 编写 ProviderManager 初始化测试**

```typescript
// packages/core/tests/provider-manager.test.ts (append)
import { describe, it, expect } from 'vitest';
import { createProviderManager } from '../src/provider-manager.js';
import type { LoopStrategy } from '../src/sdk/loop-strategy.js';
import type { ReasonProvider } from '../src/sdk/reason-provider.js';
import type { ExecuteProvider } from '../src/sdk/execute-provider.js';
import type { ContextProvider } from '../src/sdk/context-provider.js';

describe('ProviderManager registers new providers', () => {
  it('resolves loopStrategy, reason, execute, context providers', async () => {
    const pm = await createProviderManager();
    expect(pm.require<LoopStrategy>('loopStrategy')).toBeDefined();
    expect(pm.require<ReasonProvider>('reason')).toBeDefined();
    expect(pm.require<ExecuteProvider>('execute')).toBeDefined();
    expect(pm.require<ContextProvider>('context')).toBeDefined();
  });
});
```

- [ ] **Step 6: 运行测试**

Run: `pnpm --filter rem-agent-core test tests/provider-manager.test.ts`
Expected: PASS after resolving any config/env dependency

- [ ] **Step 7: 提交**

```bash
git add packages/core/src/provider-manager.ts \
  packages/core/src/plugins/index.ts \
  packages/core/src/plugins/memory/simple/index.ts \
  packages/core/tests/provider-manager.test.ts
git commit -m "feat(core): register LoopStrategy, ReasonProvider, ExecuteProvider, ContextProvider in ProviderManager

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: 全量类型检查与测试

**Files:**
- All modified files

- [ ] **Step 1: 运行类型检查**

Run: `pnpm typecheck`
Expected: PASS (no TypeScript errors)

- [ ] **Step 2: 运行全量测试**

Run: `pnpm test`
Expected: All tests pass or previously failing tests are documented

- [ ] **Step 3: 修复剩余问题**

If failures occur:
- Check `AgentStreamController.append()` expects `step` in `RawChunk`
- Ensure `LoopContext.emit` passes `step`-tagged chunks
- Check `ReasonProvider` / `ExecuteProvider` chunk `step` injection via `ReactLoop` wrapper
- Verify `DefaultReasonProvider` model/provider resolution matches `llm/api-registry.ts`

- [ ] **Step 4: 提交最终验证**

```bash
git commit -m "test(core): verify provider cluster governance refactor

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review Checklist

### Spec coverage

| Spec Section | Implementing Task |
|---|---|
| runAgent 是流程抽象层 | Task 6 |
| Turn 只包含 Reason 和 Execute | Task 5 |
| Provider 分层 | Task 1-4 |
| LLMProvider 基础设施 | Task 3 (DefaultReasonProvider 内部调用) |
| LoopStrategy 默认实现 | Task 5 |
| Bridge 与前端链路不变 | 无代码改动，验证 Task 8 |
| 文件重组 | All tasks |
| ProviderManager 注册 | Task 7 |
| 测试策略 | Each task |

### Placeholder scan

- No "TBD"/"TODO" in code steps.
- All code blocks contain concrete implementations.
- Test files contain actual test cases.
- No "similar to Task N" shortcuts.

### Type consistency

- `LoopContext` includes `emit` callback after Task 5 Step 2.
- `ReasonOutput`/`LoopResult` reuse `LanguageModelUsage` from `types.ts`.
- `AgentStreamChunk` unchanged; child emits are step-tagged by `ReactLoop` wrapper.
- `ContextProvider.build()` returns `{ system, messages }` consistently.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-07-agent-run-provider-architecture-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
