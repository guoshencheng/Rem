# pi-ai LLM 迁移 Phase 1：消息与模型层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Core 内部引入 pi-ai 的 `Models`/`Context`/`Message`/`Tool`/`Usage` 类型，替换旧 `LLMProvider`/`InferenceEngine`/`StreamCollector`/`providers/*`，但保持对外 `AgentStreamChunk` 接口不变，使 Phase 1 结束时一次完整对话即可跑通。

**Architecture:** 删除 `api-registry`/`engine`/`stream-collector`/`partition-stream`/`providers/*`，新增 `llm/models.ts` 创建 pi-ai `Models` 集合，新增 `pi-adapter.ts` 做 REM ↔ pi-ai 类型转换。`reason()` 调用 `models.stream/complete` 并把 pi-ai 事件转成旧 `ProviderChunk` 输出。`Session.conversation` 改为 `pi.Message[]`，`RemMessage` 作为运行时包装，`messageId` 通过 `metadata.messageMeta` 维护。

**Tech Stack:** TypeScript, pnpm, `@earendil-works/pi-ai`, Vitest, Node.js >=22.19.0

---

## File Structure

### 新增文件

| 文件 | 职责 |
|---|---|
| `packages/core/src/llm/models.ts` | 创建 pi-ai `Models` 集合：`createCoreModels` |
| `packages/core/src/pi-adapter.ts` | REM ↔ pi-ai 转换函数：`toPiMessage`、`fromPiMessage`、`toPiTool`、`toPiToolResultMessage`、`toLegacyProviderChunks`、`fromPiAssistantMessage` |
| `packages/core/tests/llm/pi-adapter.test.ts` | adapter 转换 round-trip 测试 |
| `packages/core/tests/llm/models.test.ts` | `createCoreModels`、模型查找、未知模型错误测试 |
| `packages/core/tests/session-migration.test.ts` | 旧 `schemaVersion=1` 会话迁移测试 |

### 修改文件

| 文件 | 修改内容 |
|---|---|
| `package.json` | 升级 Node 引擎约束、更新 `@types/node` |
| `packages/core/package.json` | 新增 `@earendil-works/pi-ai` 依赖 |
| `packages/core/src/types.ts` | 新增 `RemMessage`、`AgentStreamEvent`、`StreamErrorInfo`；保留旧 `AgentStreamChunk`/`ProviderChunk` |
| `packages/core/src/session.ts` | `Session.conversation` 改为 `Message[]`；metadata 增加 `schemaVersion` |
| `packages/core/src/sdk/session-provider.ts` | `addMessage`/`appendContent` 签名改为 pi-ai 类型；加载旧 session 时迁移 |
| `packages/core/src/plugins/session/*` | 存储/读取 pi-ai 消息；加载旧 session 时迁移 |
| `packages/core/src/agent-context.ts` | 增加 `models: Models` |
| `packages/core/src/agent-context-builder.ts` | 初始化 `Models`；移除 `registerBuiltInProviders()` |
| `packages/core/src/reason/reason.ts` | `reason()` 使用 `models.stream`/`models.complete`，内部把 pi-ai 事件转成旧 `ProviderChunk` |
| `packages/core/src/reason/generate.ts`（如不存在则新增） | 把 `generate` 从 `reason.ts` 拆出，调用 `models.complete` |
| `packages/core/src/run-agent.ts` | 构建 `pi.Context`；调用 `ctx.models`；处理 `Usage` |
| `packages/core/src/sdk/tool-provider.ts` | 导出 `Tool` 类型兼容；`getToolSet` 返回 `ToolSet`（对象）转 `Tool[]` 的逻辑放到 composer |
| `packages/core/src/sdk/tool-composer.ts` | `compose()` 返回 `Tool[]`（pi-ai） |
| `packages/core/src/execute/execute-tools.ts` | 生成 `ToolResultMessage` 并追加到 messages |
| `packages/core/src/plugins/loop/react/index.ts` | 消费 `reason()` 返回的 `toolCalls`，工具结果写入 `ToolResultMessage` |
| `packages/core/src/token-usage.ts` | 基于 `pi.Usage` 累加；新增 `addCost`/`emptyCost` |
| `packages/core/src/index.ts` | 导出新的公开类型：`RemMessage`、`AgentStreamEvent`、`createCoreModels`（如需要） |

### 移动/删除文件（Phase 1 先移动，Phase 3 删除）

| 文件 | 动作 |
|---|---|
| `packages/core/src/llm/api-registry.ts` | 移动到 `packages/core/src/deprecated/llm/api-registry.ts` |
| `packages/core/src/llm/engine.ts` | 移动到 `packages/core/src/deprecated/llm/engine.ts` |
| `packages/core/src/llm/stream-collector.ts` | 移动到 `packages/core/src/deprecated/llm/stream-collector.ts` |
| `packages/core/src/llm/partition-stream.ts` | 移动到 `packages/core/src/deprecated/llm/partition-stream.ts` |
| `packages/core/src/llm/providers/*` | 移动到 `packages/core/src/deprecated/llm/providers/*` |

---

## Task 1: 更新依赖与 Node 版本

**Files:**
- Modify: `package.json`
- Modify: `packages/core/package.json`

- [ ] **Step 1: 在根 `package.json` 增加 Node 引擎约束并更新 `@types/node`**

```json
{
  "engines": {
    "node": ">=22.19.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 2: 在 `packages/core/package.json` 新增 pi-ai 依赖**

```json
{
  "dependencies": {
    "@earendil-works/pi-ai": "^0.80.7"
  }
}
```

- [ ] **Step 3: 运行安装并验证环境**

```bash
pnpm install
node --version
# Expected: v22.19.0 or higher
```

- [ ] **Step 4: Commit**

```bash
git add package.json packages/core/package.json pnpm-lock.yaml
 git commit -m "chore(deps): add pi-ai dependency and require Node 22"
```

---

## Task 2: 创建 `packages/core/src/llm/models.ts`

**Files:**
- Create: `packages/core/src/llm/models.ts`
- Test: `packages/core/tests/llm/models.test.ts`

- [ ] **Step 1: 编写 `models.ts`**

```ts
import { createModels } from '@earendil-works/pi-ai';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import type { Models, Provider } from '@earendil-works/pi-ai';

export interface CreateCoreModelsOptions {
  /** 是否注册 pi-ai 全部内置 provider。默认 false（只创建空 Models，便于测试）。 */
  all?: boolean;
  /** 自定义 provider */
  customProviders?: Provider[];
}

export function createCoreModels(options?: CreateCoreModelsOptions): Models {
  const models = options?.all ? builtinModels() : createModels();
  for (const provider of options?.customProviders ?? []) {
    models.setProvider(provider);
  }
  return models;
}
```

- [ ] **Step 2: 编写测试 `models.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createCoreModels } from '../../src/llm/models.js';

describe('createCoreModels', () => {
  it('creates empty models when all is false', () => {
    const models = createCoreModels();
    expect(models.getModel('openai', 'gpt-4o')).toBeUndefined();
  });

  it('registers builtin providers when all is true', () => {
    const models = createCoreModels({ all: true });
    const model = models.getModel('openai', 'gpt-4o');
    expect(model).toBeDefined();
    expect(model?.id).toBe('gpt-4o');
  });

  it('throws or returns undefined for unknown model', () => {
    const models = createCoreModels({ all: true });
    expect(models.getModel('unknown', 'unknown')).toBeUndefined();
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
pnpm --filter rem-agent-core test packages/core/tests/llm/models.test.ts
# Expected: PASS
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/llm/models.ts packages/core/tests/llm/models.test.ts
 git commit -m "feat(core): add createCoreModels for pi-ai Models collection"
```

---

## Task 3: 创建 `packages/core/src/pi-adapter.ts`

**Files:**
- Create: `packages/core/src/pi-adapter.ts`
- Test: `packages/core/tests/llm/pi-adapter.test.ts`

- [ ] **Step 1: 编写 `pi-adapter.ts`**

```ts
import type {
  Message,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  Tool,
  ToolCall,
  TextContent,
  ThinkingContent,
  AssistantMessageEvent,
  Usage,
} from '@earendil-works/pi-ai';
import type { ModelMessage, ContentPart, ProviderChunk, LanguageModelUsage } from './types.js';
import type { ToolSchema } from './llm/types.js';

export function toPiMessage(message: ModelMessage): Message {
  switch (message.role) {
    case 'user': {
      const text = message.content
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
      return { role: 'user', content: text, timestamp: Date.now() } satisfies UserMessage;
    }
    case 'assistant': {
      const content: AssistantMessage['content'] = [];
      for (const part of message.content) {
        if (part.type === 'text') content.push({ type: 'text', text: part.text });
        else if (part.type === 'reasoning') content.push({ type: 'thinking', thinking: part.text });
        else if (part.type === 'tool-call') {
          content.push({ type: 'toolCall', id: part.toolCallId, name: part.toolName, arguments: part.arguments });
        }
      }
      return { role: 'assistant', content, timestamp: Date.now() } satisfies AssistantMessage;
    }
    case 'tool': {
      // tool-result parts 应该已经在 execute-tools 处理为 ToolResultMessage，这里做兜底转换
      const results = message.content.filter((p): p is { type: 'tool-result'; toolCallId: string; toolName?: string; output: string; error?: string } => p.type === 'tool-result');
      if (results.length !== 1) {
        throw new Error('Expected exactly one tool-result part per tool role message');
      }
      return {
        role: 'toolResult',
        toolCallId: results[0].toolCallId,
        toolName: results[0].toolName ?? '',
        content: [{ type: 'text', text: results[0].output }],
        isError: !!results[0].error,
        timestamp: Date.now(),
      } satisfies ToolResultMessage;
    }
    case 'system':
      // system 消息不应出现在 conversation 中，应进入 Context.systemPrompt
      throw new Error('System message should not be converted to pi-ai message');
    default:
      throw new Error(`Unknown role: ${message.role}`);
  }
}

export function fromPiMessage(message: Message, messageId: string): ModelMessage {
  switch (message.role) {
    case 'user':
      return {
        id: messageId,
        role: 'user',
        content: [{ type: 'text', text: typeof message.content === 'string' ? message.content : message.content.map((c) => (c.type === 'text' ? c.text : '')).join('') }],
      };
    case 'assistant': {
      const content: ContentPart[] = [];
      for (const block of message.content) {
        if (block.type === 'text') content.push({ type: 'text', text: block.text });
        else if (block.type === 'thinking') content.push({ type: 'reasoning', text: block.thinking });
        else if (block.type === 'toolCall') {
          content.push({ type: 'tool-call', toolCallId: block.id, toolName: block.name, arguments: block.arguments });
        }
      }
      return { id: messageId, role: 'assistant', content };
    }
    case 'toolResult':
      return {
        id: messageId,
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: message.toolCallId, toolName: message.toolName, output: message.content.map((c) => (c.type === 'text' ? c.text : '')).join(''), error: message.isError ? 'error' : undefined }],
      };
    default:
      throw new Error(`Unknown pi-ai role: ${(message as any).role}`);
  }
}

export function toPiTool(name: string, schema: ToolSchema): Tool {
  return { name, description: schema.description, parameters: schema.parameters };
}

export function toPiToolResultMessage(result: { toolCallId: string; toolName: string; output: string; error?: string }): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: result.toolCallId,
    toolName: result.toolName,
    content: [{ type: 'text', text: result.output }],
    isError: !!result.error,
    timestamp: Date.now(),
  };
}

export function* toLegacyProviderChunks(event: AssistantMessageEvent): Generator<ProviderChunk> {
  switch (event.type) {
    case 'text_delta':
      yield { type: 'text-delta', step: 0, text: event.delta };
      break;
    case 'thinking_delta':
      yield { type: 'reasoning-delta', step: 0, text: event.delta };
      break;
    case 'toolcall_end': {
      const tc = event.toolCall;
      yield { type: 'tool-call', step: 0, toolCallId: tc.id, toolName: tc.name, input: tc.arguments };
      break;
    }
    case 'done':
    case 'error':
    case 'start':
    case 'text_start':
    case 'text_end':
    case 'thinking_start':
    case 'thinking_end':
    case 'toolcall_start':
    case 'toolcall_delta':
      // Phase 1 忽略这些事件，Phase 2 再消费
      break;
  }
}

export function fromPiAssistantMessage(message: AssistantMessage): {
  text: string;
  reasoning?: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>;
  usage: LanguageModelUsage;
  finishReason: string;
} {
  const text = message.content
    .filter((b): b is TextContent => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const reasoning = message.content
    .filter((b): b is ThinkingContent => b.type === 'thinking')
    .map((b) => b.thinking)
    .join('\n') || undefined;
  const toolCalls = message.content
    .filter((b): b is ToolCall => b.type === 'toolCall')
    .map((b) => ({ toolCallId: b.id, toolName: b.name, input: b.arguments }));
  return {
    text,
    reasoning,
    toolCalls,
    usage: piUsageToLanguageModelUsage(message.usage),
    finishReason: message.stopReason ?? 'stop',
  };
}

export function piUsageToLanguageModelUsage(usage: Usage): LanguageModelUsage {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: usage.totalTokens,
    inputTokenDetails: {
      noCacheTokens: usage.input - usage.cacheRead - usage.cacheWrite,
      cacheReadTokens: usage.cacheRead,
      cacheWriteTokens: usage.cacheWrite,
    },
    outputTokenDetails: {
      textTokens: usage.output - (usage.reasoning ?? 0),
      reasoningTokens: usage.reasoning,
    },
  };
}

export function languageModelUsageToPiUsage(usage: LanguageModelUsage): Usage {
  const details = usage.inputTokenDetails ?? {};
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    cacheRead: details.cacheReadTokens ?? 0,
    cacheWrite: details.cacheWriteTokens ?? 0,
    totalTokens: usage.totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}
```

- [ ] **Step 2: 编写测试 `pi-adapter.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { toPiMessage, fromPiMessage, toPiTool, toLegacyProviderChunks } from '../../src/pi-adapter.js';

describe('toPiMessage / fromPiMessage round-trip', () => {
  it('round-trips user message', () => {
    const rem: import('../../src/types.js').ModelMessage = { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hello' }] };
    const pi = toPiMessage(rem);
    expect(pi.role).toBe('user');
    const back = fromPiMessage(pi, 'u1');
    expect(back).toEqual(rem);
  });

  it('round-trips assistant message with text and tool-call', () => {
    const rem: import('../../src/types.js').ModelMessage = {
      id: 'a1', role: 'assistant',
      content: [
        { type: 'text', text: 'ok' },
        { type: 'tool-call', toolCallId: 'c1', toolName: 'echo', arguments: { x: 1 } },
      ],
    };
    const pi = toPiMessage(rem);
    expect(pi.role).toBe('assistant');
    expect(pi.content).toHaveLength(2);
    const back = fromPiMessage(pi, 'a1');
    expect(back).toEqual(rem);
  });
});

describe('toLegacyProviderChunks', () => {
  it('yields text-delta', () => {
    const chunks = [...toLegacyProviderChunks({ type: 'text_delta', contentIndex: 0, delta: 'hi', partial: {} as any })];
    expect(chunks).toEqual([{ type: 'text-delta', step: 0, text: 'hi' }]);
  });

  it('yields tool-call on toolcall_end', () => {
    const chunks = [
      ...toLegacyProviderChunks({
        type: 'toolcall_end',
        contentIndex: 0,
        toolCall: { type: 'toolCall', id: 'c1', name: 'echo', arguments: { x: 1 } },
        partial: {} as any,
      }),
    ];
    expect(chunks).toEqual([{ type: 'tool-call', step: 0, toolCallId: 'c1', toolName: 'echo', input: { x: 1 } }]);
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
pnpm --filter rem-agent-core test packages/core/tests/llm/pi-adapter.test.ts
# Expected: PASS
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/pi-adapter.ts packages/core/tests/llm/pi-adapter.test.ts
 git commit -m "feat(core): add REM ↔ pi-ai adapter conversions"
```

---

## Task 4: 更新 `packages/core/src/types.ts`

**Files:**
- Modify: `packages/core/src/types.ts`

- [ ] **Step 1: 在 `types.ts` 中新增类型并保留旧类型兼容**

```ts
import type { Message, AssistantMessageEvent, Usage, TextContent, ThinkingContent, ToolCall } from '@earendil-works/pi-ai';

export interface StreamErrorInfo {
  name: string;
  message: string;
  reason?: 'error' | 'aborted';
  stack?: string;
}

export interface RemMessage {
  messageId: string;
  message: Message;
  tokenUsage?: Usage;
}

export type RemMetaEvent =
  | { type: 'step-start'; step: number }
  | { type: 'step-finish'; step: number }
  | { type: 'session-title'; title: string }
  | { type: 'approval-request'; sessionId: string; request: ApprovalRequest }
  | { type: 'approval-resolved'; sessionId: string; approvalId: string; decision: ApprovalDecision | null }
  | { type: 'compress-start'; sessionId: string; estimatedTokens: number; threshold: number }
  | { type: 'compress-end'; sessionId: string; archiveId: string; removedMessageCount: number }
  | { type: 'compress-error'; sessionId: string; error: string }
  | { type: 'finish'; output: AgentOutput }
  | { type: 'error'; error: StreamErrorInfo };

export type AgentStreamEvent = AssistantMessageEvent | RemMetaEvent;

// Phase 1 保留旧类型，Phase 2 删除
export type AgentStreamChunk = /* existing union */;
export type ProviderChunk = /* existing union */;
```

- [ ] **Step 2: 运行类型检查**

```bash
pnpm --filter rem-agent-core typecheck
# Expected: 可能有错误，因为其它文件还没改；先确认类型定义本身无语法错误
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types.ts
 git commit -m "types(core): add RemMessage, AgentStreamEvent, StreamErrorInfo for pi-ai migration"
```

---

## Task 5: 更新 `packages/core/src/session.ts`

**Files:**
- Modify: `packages/core/src/session.ts`

- [ ] **Step 1: 将 `Session.conversation` 改为 `Message[]` 并加 `schemaVersion`**

```ts
import type { Message } from '@earendil-works/pi-ai';

export interface Session {
  sessionId: string;
  conversation: Message[];
  currentTurn: number;
  metadata: Record<string, unknown> & { schemaVersion?: number };
  createdAt: Date;
  updatedAt: Date;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/session.ts
 git commit -m "feat(session): store conversation as pi-ai Message[] with schemaVersion"
```

---

## Task 6: 更新会话 Provider

**Files:**
- Modify: `packages/core/src/sdk/session-provider.ts`
- Modify: `packages/core/src/plugins/session/base.ts`（如果存在）
- Modify: `packages/core/src/plugins/session/in-memory.ts` / `jsonl.ts` / `sqlite.ts` / `local.ts`

- [ ] **Step 1: 修改 `SessionProvider` 接口签名**

```ts
import type { Message, TextContent, ThinkingContent, ToolCall } from '@earendil-works/pi-ai';

export interface SessionProvider {
  load(sessionId: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  addMessage(session: Session, role: 'user' | 'assistant' | 'tool'): Promise<RemMessage>;
  appendContent(session: Session, message: Message, block: TextContent | ThinkingContent | ToolCall): Promise<void>;
}
```

- [ ] **Step 2: 修改各 SessionProvider 实现**

- `addMessage` 生成 `messageId` 并写入 `session.metadata.messageMeta`；
- `appendContent` 直接修改传入的 `message.content` 并 save session；
- `load` 时如果 `schemaVersion < 2`，调用 `migrateConversationToPiAi`（见 Task 14）。

- [ ] **Step 3: 运行类型检查**

```bash
pnpm --filter rem-agent-core typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/sdk/session-provider.ts packages/core/src/plugins/session/*
 git commit -m "feat(session): adapt session providers to pi-ai Message and messageId metadata"
```

---

## Task 7: 更新 `AgentContext` 与 `AgentContextBuilder`

**Files:**
- Modify: `packages/core/src/agent-context.ts`
- Modify: `packages/core/src/agent-context-builder.ts`

- [ ] **Step 1: 在 `agent-context.ts` 增加 `models`**

```ts
import type { Models } from '@earendil-works/pi-ai';

export interface AgentContext {
  // ... existing fields
  models: Models;
}
```

- [ ] **Step 2: 在 `agent-context-builder.ts` 创建 Models 并移除 `registerBuiltInProviders()`**

```ts
import { createCoreModels } from './llm/models.js';

export async function buildAgentContext(options?: BuildAgentContextOptions): Promise<AgentContext> {
  const models = options?.models ?? createCoreModels({ all: true });
  // ... build other providers
  return {
    // ...
    models,
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/agent-context.ts packages/core/src/agent-context-builder.ts
 git commit -m "feat(context): inject pi-ai Models into AgentContext"
```

---

## Task 8: 更新 `reason.ts` 与 `generate`

**Files:**
- Modify: `packages/core/src/reason/reason.ts`
- Modify: 拆分 `generate` 到 `packages/core/src/reason/generate.ts`（可选，如 `reason.ts` 已包含 `generate`）

- [ ] **Step 1: 修改 `ReasonParams` / `GenerateParams` 增加 `models`**

```ts
import type { Models } from '@earendil-works/pi-ai';

export interface ReasonParams {
  models: Models;
  provider: string;
  model: string;
  apiKey: string;
  baseURL?: string;
  system: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  signal?: AbortSignal;
  errorHandler?: ErrorHandler;
}

export interface GenerateParams extends ReasonParams {
  responseFormat?: {
    type: 'json_schema' | 'json_object';
    json_schema?: { name: string; schema: Record<string, unknown>; strict?: boolean };
  };
}
```

- [ ] **Step 2: 重写 `generate()` 使用 `models.complete`**

```ts
import { toPiMessage, toPiTool, fromPiAssistantMessage } from '../pi-adapter.js';

export async function generate(params: GenerateParams): Promise<GenerateResult> {
  const { models } = params;
  const model = models.getModel(params.provider, params.model);
  if (!model) throw new Error(`Unknown model: ${params.provider}/${params.model}`);

  const context: Context = {
    systemPrompt: params.system,
    messages: params.messages.map(toPiMessage),
    tools: params.tools ? Object.entries(params.tools).map(([name, schema]) => toPiTool(name, schema)) : undefined,
  };

  const maxAttempts = 3;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const message = await models.complete(model, context, {
        apiKey: params.apiKey,
        baseURL: params.baseURL,
        signal: params.signal,
        maxRetries: 0,
      });
      if (message.stopReason === 'error' || message.stopReason === 'aborted') {
        throw new Error(message.errorMessage ?? `LLM stopped: ${message.stopReason}`);
      }
      const result = fromPiAssistantMessage(message);
      return { ...result, finishReason: result.finishReason ?? 'stop' };
    } catch (error) {
      // ... existing retry logic
    }
  }
  throw lastError;
}
```

- [ ] **Step 3: 重写 `reason()` 使用 `models.stream`**

```ts
import { toLegacyProviderChunks } from '../pi-adapter.js';
import type { Context } from '@earendil-works/pi-ai';

export async function reason(
  params: ReasonParams,
  emit: (chunk: ProviderChunk) => void,
): Promise<ReasonResult> {
  const { models } = params;
  const model = models.getModel(params.provider, params.model);
  if (!model) throw new Error(`Unknown model: ${params.provider}/${params.model}`);

  const context: Context = {
    systemPrompt: params.system,
    messages: params.messages.map(toPiMessage),
    tools: params.tools ? Object.entries(params.tools).map(([name, schema]) => toPiTool(name, schema)) : undefined,
  };

  const maxAttempts = 3;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const stream = models.stream(model, context, {
        apiKey: params.apiKey,
        baseURL: params.baseURL,
        signal: params.signal,
        maxRetries: 0,
      });

      for await (const event of stream) {
        for (const chunk of toLegacyProviderChunks(event)) {
          emit(chunk);
        }
      }

      const message = await stream.result();
      if (message.stopReason === 'error' || message.stopReason === 'aborted') {
        throw new Error(message.errorMessage ?? `LLM stopped: ${message.stopReason}`);
      }
      const result = fromPiAssistantMessage(message);
      return { ...result, finishReason: result.finishReason ?? 'stop' };
    } catch (error) {
      // ... existing retry logic
    }
  }
  throw lastError;
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/reason/reason.ts packages/core/src/reason/generate.ts
 git commit -m "feat(reason): use pi-ai models.stream/complete for reason and generate"
```

---

## Task 9: 更新 `run-agent.ts`

**Files:**
- Modify: `packages/core/src/run-agent.ts`

- [ ] **Step 1: 将 `reason()` 调用改为传入 `ctx.models`**

```ts
const loopCtx: LoopContext = {
  // ... existing fields
  reason: () => reason({
    models: ctx.models,
    provider: effectiveModel.provider,
    model: effectiveModel.model,
    apiKey: effectiveModel.apiKey,
    baseURL: effectiveModel.baseURL,
    system: systemPrompt,
    messages: msgs,
    tools: toolProviderWithDelegate.getToolSet(),
    signal: params.signal,
    errorHandler,
  }, (chunk) => trackMessageStart(chunk)),
  // ...
};
```

- [ ] **Step 2: 确保 `result.usage` 是 `LanguageModelUsage`（已由 `reason()` 转换）**

`run-agent.ts` 中 `liveState.addTokenUsage(result.usage)` 等逻辑保持不变，因为 `piUsageToLanguageModelUsage` 已在 `reason()` 中完成。

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/run-agent.ts
 git commit -m "feat(run-agent): pass pi-ai Models to reason() and consume converted usage"
```

---

## Task 10: 更新工具提供层

**Files:**
- Modify: `packages/core/src/sdk/tool-provider.ts`
- Modify: `packages/core/src/sdk/tool-composer.ts`

- [ ] **Step 1: 修改 `ToolProvider` 接口（可选，保持 `ToolSet` 返回以保持兼容性）**

Phase 1 中 `ToolProvider.getToolSet()` 继续返回 `ToolSet`（对象），`tool-composer` 负责转成 `Tool[]`。

- [ ] **Step 2: 修改 `tool-composer.ts` 暴露 `getToolSet()` 返回 `Tool[]` 或新增 `toPiTools()`**

```ts
import { toPiTool } from '../pi-adapter.js';

export function composeToolSet(toolSet: ToolSet): Tool[] {
  return Object.entries(toolSet).map(([name, schema]) => toPiTool(name, schema));
}
```

- [ ] **Step 3: 在 `run-agent.ts` 中使用 `composeToolSet`**

```ts
const toolSet = toolProviderWithDelegate.getToolSet();
const piTools = composeToolSet(toolSet);
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/sdk/tool-provider.ts packages/core/src/sdk/tool-composer.ts packages/core/src/run-agent.ts
 git commit -m "feat(tools): convert ToolSet to pi-ai Tool[] in composer"
```

---

## Task 11: 更新 `execute-tools.ts`

**Files:**
- Modify: `packages/core/src/execute/execute-tools.ts`

- [ ] **Step 1: 修改 `executeTools` 把结果转为 `ToolResultMessage` 并追加到 messages**

```ts
import { toPiToolResultMessage } from '../pi-adapter.js';

export interface ExecuteParams {
  // ... existing fields
  messages: Message[];
}

export async function executeTools(params: ExecuteParams): Promise<ToolResult[]> {
  // ... existing permission / approval / execution logic
  const results = await params.toolProvider.execute(...);

  for (const result of results) {
    const toolResultMessage = toPiToolResultMessage(result);
    params.messages.push(toolResultMessage);
  }

  return results;
}
```

- [ ] **Step 2: 修改 `run-agent.ts` 中 `executeTools` 调用传入 `messages`**

```ts
execute: (calls: ToolCall[]): Promise<ToolResult[]> => executeTools({
  // ...
  messages: msgs,
  // ...
}),
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/execute/execute-tools.ts packages/core/src/run-agent.ts
 git commit -m "feat(execute): write tool results as pi-ai ToolResultMessage"
```

---

## Task 12: 更新 `LoopContext` 与 `ReactLoop`

**Files:**
- Modify: `packages/core/src/sdk/loop-strategy.ts`
- Modify: `packages/core/src/plugins/loop/react/index.ts`

- [ ] **Step 1: 更新 `LoopContext` 使用 pi-ai 类型**

```ts
import type { Message, TextContent, ThinkingContent, ToolCall } from '@earendil-works/pi-ai';

export interface LoopContext {
  liveState: AgentLiveState;
  system: string;
  messages: Message[];

  reason: () => Promise<LoopCallReason>;
  execute: (toolCalls: ToolCall[]) => Promise<ToolResult[]>;
  emit: (chunk: ProviderChunk) => void | Promise<void>;

  addMessage: (role: 'assistant' | 'tool') => Promise<RemMessage>;
  appendContent: (message: Message, block: TextContent | ThinkingContent | ToolCall) => void;
  resolveMessageId?: (message: Message) => string | undefined;

  signal?: AbortSignal;
  maxSteps?: number;
  workspaceRoot: string;
  readOnly?: boolean;
  agentName?: string;
  sessionId?: string;
}
```

- [ ] **Step 2: 确保 `ReactLoop` 使用 `addMessage` / `appendContent` 的新签名**

```ts
private ensureAssistantMessage(ctx: LoopContext): Promise<RemMessage> {
  const last = ctx.messages[ctx.messages.length - 1];
  if (last && last.role === 'assistant') {
    const messageId = ctx.resolveMessageId?.(last) ?? 'unknown';
    return Promise.resolve({ messageId, message: last });
  }
  return ctx.addMessage('assistant');
}

private async runLoop(ctx: LoopContext): Promise<LoopResult> {
  let content = '';
  let usage = emptyUsage();
  const assistantMsg = await this.ensureAssistantMessage(ctx);
  ctx.emit({ type: 'message-start', step: 1, messageId: assistantMsg.messageId });
  // ... rest of loop
}

private appendToAssistantMessage(
  ctx: LoopContext,
  assistantMsg: RemMessage,
  result: { text: string; toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>; reasoning?: string },
): void {
  if (result.reasoning) ctx.appendContent(assistantMsg.message, { type: 'thinking', thinking: result.reasoning });
  if (result.text) ctx.appendContent(assistantMsg.message, { type: 'text', text: result.text });
  for (const tc of result.toolCalls) {
    ctx.appendContent(assistantMsg.message, { type: 'toolCall', id: tc.toolCallId, name: tc.toolName, arguments: tc.input });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/sdk/loop-strategy.ts packages/core/src/plugins/loop/react/index.ts
 git commit -m "feat(react-loop): adapt LoopContext and ReactLoop to pi-ai Message types"
```

---

## Task 13: 更新 `token-usage.ts`

**Files:**
- Modify: `packages/core/src/token-usage.ts`

- [ ] **Step 1: 基于 `pi.Usage` 累加**

```ts
import type { Usage } from '@earendil-works/pi-ai';

export function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    totalTokens: a.totalTokens + b.totalTokens,
    cost: addCost(a.cost, b.cost),
  };
}

export function addCost(a: Usage['cost'], b: Usage['cost']): Usage['cost'] {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    total: a.total + b.total,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/token-usage.ts
 git commit -m "feat(usage): accumulate pi.Usage including cost"
```

---

## Task 14: 迁移旧 Session 数据

**Files:**
- Modify: `packages/core/src/pi-adapter.ts`
- Test: `packages/core/tests/session-migration.test.ts`

- [ ] **Step 1: 在 `pi-adapter.ts` 中新增 `migrateConversationToPiAi`**

（参考 design doc 中的示例实现，将 `LegacyModelMessage[]` 转为 `Message[]` 和 `messageIds` 映射。）

- [ ] **Step 2: 在 `BaseSessionProvider.load` 中调用迁移**

```ts
async load(sessionId: string): Promise<Session | null> {
  const raw = await this.read(sessionId);
  if (!raw) return null;

  const session = JSON.parse(raw);
  if ((session.metadata?.schemaVersion ?? 1) < 2) {
    const { messages, messageIds } = migrateConversationToPiAi(session.conversation);
    session.conversation = messages;
    session.metadata = { ...session.metadata, schemaVersion: 2, messageMeta: { ...session.metadata?.messageMeta, ...messageIds } };
    await this.write(sessionId, JSON.stringify(session));
  }

  return session;
}
```

- [ ] **Step 3: 编写迁移测试**

```ts
import { describe, it, expect } from 'vitest';
import { migrateConversationToPiAi } from '../../src/pi-adapter.js';

describe('migrateConversationToPiAi', () => {
  it('migrates user and assistant messages', () => {
    const legacy = [
      { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ];
    const { messages, messageIds } = migrateConversationToPiAi(legacy);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect(messageIds.get('u1')).toBeDefined();
    expect(messageIds.get('a1')).toBeDefined();
  });
});
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/pi-adapter.ts packages/core/tests/session-migration.test.ts packages/core/src/plugins/session/*
 git commit -m "feat(session): add schemaVersion migration from old ModelMessage to pi-ai Message"
```

---

## Task 15: 移动旧 LLM 文件到 deprecated

**Files:**
- Move: `packages/core/src/llm/api-registry.ts` → `packages/core/src/deprecated/llm/api-registry.ts`
- Move: `packages/core/src/llm/engine.ts` → `packages/core/src/deprecated/llm/engine.ts`
- Move: `packages/core/src/llm/stream-collector.ts` → `packages/core/src/deprecated/llm/stream-collector.ts`
- Move: `packages/core/src/llm/partition-stream.ts` → `packages/core/src/deprecated/llm/partition-stream.ts`
- Move: `packages/core/src/llm/providers/*` → `packages/core/src/deprecated/llm/providers/*`

- [ ] **Step 1: 移动文件**

```bash
mkdir -p packages/core/src/deprecated/llm/providers
mv packages/core/src/llm/api-registry.ts packages/core/src/deprecated/llm/
mv packages/core/src/llm/engine.ts packages/core/src/deprecated/llm/
mv packages/core/src/llm/stream-collector.ts packages/core/src/deprecated/llm/
mv packages/core/src/llm/partition-stream.ts packages/core/src/deprecated/llm/
mv packages/core/src/llm/providers/* packages/core/src/deprecated/llm/providers/
```

- [ ] **Step 2: 运行类型检查确认没有遗留 import**

```bash
pnpm --filter rem-agent-core typecheck
# Expected: 可能还有旧 import，继续修复
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/deprecated packages/core/src/llm
 git commit -m "chore(core): move old LLM provider files to deprecated (Phase 3 deletion)"
```

---

## Task 16: 全量验证

**Files:**
- All of the above

- [ ] **Step 1: 运行类型检查**

```bash
pnpm --filter rem-agent-core typecheck
# Expected: PASS
```

- [ ] **Step 2: 运行测试**

```bash
pnpm test
# Expected: PASS (Phase 1 结束时旧事件格式测试应仍通过)
```

- [ ] **Step 3: 运行一次真实对话（如果有 API key）**

```bash
OPENAI_API_KEY=xxx pnpm --filter rem-agent-core exec tsx scripts/smoke-run.ts
# 或使用项目内置的 smoke test 命令
```

- [ ] **Step 4: 检查 session 文件格式**

```bash
# 找到 session 文件，确认 conversation 是 pi-ai Message[] 且 schemaVersion >= 2
```

- [ ] **Step 5: Commit any final fixes**

```bash
git add .
 git commit -m "fix(core): Phase 1 pi-ai migration fixes after full verification"
```

---

## Self-Review Checklist

- [ ] `createCoreModels({ all: true })` 能注册 openai / anthropic 模型；
- [ ] `toPiMessage` / `fromPiMessage` 对 user / assistant / tool 消息 round-trip 正确；
- [ ] `reason()` 使用 `models.stream`，`generate()` 使用 `models.complete`；
- [ ] `reason()` 在 `stream.result()` 后检查 `stopReason` 并抛异常；
- [ ] `execute-tools.ts` 把工具结果作为 `ToolResultMessage` 写入 `messages`；
- [ ] `Session.conversation` 是 `pi.Message[]` 且 `schemaVersion >= 2`；
- [ ] 旧 `schemaVersion=1` 会话能自动迁移并写回；
- [ ] `pnpm typecheck` 和 `pnpm test` 全绿；
- [ ] 没有残留对 `api-registry` / `engine` / `stream-collector` / `providers/*` 的 import（除了 `deprecated/` 内的文件）。

---

> Next: Phase 2 将替换 `AgentStreamChunk` 为 `AgentStreamEvent = AssistantMessageEvent | RemMetaEvent`，重写 `AgentStreamController`、`ReactLoop`、状态与 Bridge/Web 渲染。详见 `2026-07-15-pi-ai-llm-migration-phase-2.md`。
