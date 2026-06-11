# LLM Provider 层设计 — ApiRegistry 模式

> 替换 vercel/ai `generateText`，自建 Provider 层，P0 支持 OpenAI + Anthropic，流式为主。

---

## 1. 背景与目标

### 1.1 当前问题

`packages/core/src/loop.ts` 当前使用 vercel/ai 的 `generateText()`：

- **不支持流式输出**：`generateText` 是非阻塞等待完整响应
- **工具调用控制不足**：`generateText` 内部有 `maxSteps` 自动多步逻辑，loop 无法完全控制
- **消息格式黑盒**：`generateText` 内部的消息序列化/反序列化不可控
- **Provider 抽象泄漏**：`LanguageModel` 是 vercel/ai 内部类型，不稳定

### 1.2 设计目标

- **自建 Provider 层**：loop 直接调用 Provider 的 `stream()`/`generate()`，不经过 `generateText`
- **P0 支持两家**：OpenAI（`openai` SDK）+ Anthropic（`@anthropic-ai/sdk`）
- **流式为主**：`stream()` 返回 `AsyncIterable<StreamChunk>`，loop 消费流
- **ApiRegistry 模式**：借鉴 OpenClaw，运行时注册 Provider，按 id 路由
- **类型复用**：保留 `ai` SDK 的 `ModelMessage`/`ToolSet`，Provider 内部负责格式转换

---

## 2. 架构总览

```
┌─────────────────────────────────────────────┐
│  Core 层（loop.ts）                           │
│  ├── PREPARE: 消息组装（MemoryProvider）       │
│  ├── REASON: registry.resolve('openai')       │
│  │            → provider.stream(options)      │
│  │            → 消费 StreamChunk              │
│  │            → emit phase:reason:before/after │
│  ├── EXECUTE: toolProvider.execute()          │
│  └── OBSERVE: 状态更新                         │
├─────────────────────────────────────────────┤
│  LLM Runtime 层                               │
│  ├── api-registry.ts    → Map<id, provider>   │
│  ├── types.ts           → GenerateOptions/Result/Chunk │
│  └── providers/                               │
│      ├── openai.ts      → openai SDK          │
│      ├── anthropic.ts   → @anthropic-ai/sdk   │
│      └── index.ts       → 注册内置 provider   │
└─────────────────────────────────────────────┘
```

**设计原则**：
1. loop 层只关心 `stream()`/`generate()` 的调用，不关心 Provider 内部实现
2. Provider 内部负责：消息格式转换、HTTP 调用、流式解析、错误映射
3. ApiRegistry 支持未来动态注册第三方 Provider

---

## 3. ApiRegistry 设计

```typescript
// src/llm/api-registry.ts

export interface LLMProvider {
  /** 非流式生成 */
  generate(options: GenerateOptions): Promise<GenerateResult>;
  /** 流式生成 */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}

const registry = new Map<string, LLMProvider>();

export function registerProvider(id: string, provider: LLMProvider): void {
  if (registry.has(id)) {
    throw new Error(`Provider "${id}" already registered`);
  }
  registry.set(id, provider);
}

export function resolveProvider(id: string): LLMProvider {
  const provider = registry.get(id);
  if (!provider) {
    throw new Error(`Unknown provider: "${id}". Available: ${listProviders().join(', ')}`);
  }
  return provider;
}

export function listProviders(): string[] {
  return [...registry.keys()];
}

export function clearProviders(): void {
  registry.clear();
}
```

**线程安全**：注册表在应用启动时一次性填充，运行期只读，无需锁。

---

## 4. 核心类型定义

```typescript
// src/llm/types.ts
import type { ModelMessage, ToolSet } from 'ai';

/** LLM 调用选项 */
export interface GenerateOptions {
  /** 模型 ID，如 "gpt-4o"、"claude-sonnet-4-7" */
  model: string;
  /** API Key */
  apiKey: string;
  /** 自定义 baseURL（可选，用于代理） */
  baseURL?: string;
  /** 系统提示 */
  system?: string;
  /** 消息历史 */
  messages: ModelMessage[];
  /** 可用工具 */
  tools?: ToolSet;
  /** 温度 */
  temperature?: number;
  /** 最大输出 token */
  maxTokens?: number;
  /** 取消信号 */
  signal?: AbortSignal;
}

/** 生成结果（非流式） */
export interface GenerateResult {
  text: string;
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    input: unknown;
  }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

/** 流式分片 */
export type StreamChunk =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'usage'; inputTokens: number; outputTokens: number; totalTokens: number }
  | { type: 'finish'; reason: string };
```

**类型复用决策**：`ModelMessage` 和 `ToolSet` 复用 `ai` SDK 的类型。Provider 内部负责转换为原生格式。这样 loop 层不依赖具体 Provider 的消息格式。

---

## 5. OpenAI Provider 实现

```typescript
// src/llm/providers/openai.ts
import OpenAI from 'openai';
import type { LLMProvider } from '../api-registry.js';
import type { GenerateOptions, GenerateResult, StreamChunk } from '../types.js';

function convertToOpenAIMessages(messages: GenerateOptions['messages'], system?: string): OpenAI.Chat.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (system) {
    result.push({ role: 'system', content: system });
  }
  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content as string });
    } else if (msg.role === 'assistant') {
      result.push({ role: 'assistant', content: msg.content as string });
    } else if (msg.role === 'tool') {
      result.push({
        role: 'tool',
        tool_call_id: (msg as any).toolCallId,
        content: msg.content as string,
      });
    }
  }
  return result;
}

function convertToOpenAITools(tools: GenerateOptions['tools']): OpenAI.Chat.ChatCompletionTool[] {
  if (!tools) return [];
  return Object.entries(tools).map(([name, tool]) => ({
    type: 'function' as const,
    function: {
      name,
      description: (tool as any).description ?? '',
      parameters: (tool as any).parameters ?? { type: 'object' },
    },
  }));
}

function parseOpenAIResponse(response: OpenAI.Chat.ChatCompletion): GenerateResult {
  const choice = response.choices[0];
  const message = choice.message;

  const text = message.content ?? '';
  const toolCalls = (message.tool_calls ?? []).map(tc => ({
    toolCallId: tc.id,
    toolName: tc.function.name,
    input: JSON.parse(tc.function.arguments),
  }));

  return {
    text,
    toolCalls,
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    },
  };
}

function* parseOpenAIChunk(chunk: OpenAI.Chat.ChatCompletionChunk): Generator<StreamChunk> {
  const delta = chunk.choices[0]?.delta;
  if (!delta) return;

  if (delta.content) {
    yield { type: 'text', text: delta.content };
  }

  if (delta.tool_calls) {
    for (const tc of delta.tool_calls) {
      if (tc.function?.name) {
        yield {
          type: 'tool-call',
          toolCallId: tc.id!,
          toolName: tc.function.name,
          input: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
        };
      }
    }
  }

  if (chunk.usage) {
    yield {
      type: 'usage',
      inputTokens: chunk.usage.prompt_tokens,
      outputTokens: chunk.usage.completion_tokens,
      totalTokens: chunk.usage.total_tokens,
    };
  }
}

export const openaiProvider: LLMProvider = {
  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });

    const response = await client.chat.completions.create({
      model: options.model,
      messages: convertToOpenAIMessages(options.messages, options.system),
      tools: options.tools ? convertToOpenAITools(options.tools) : undefined,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
    }, { signal: options.signal });

    return parseOpenAIResponse(response);
  },

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });

    const stream = await client.chat.completions.create({
      model: options.model,
      messages: convertToOpenAIMessages(options.messages, options.system),
      tools: options.tools ? convertToOpenAITools(options.tools) : undefined,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    }, { signal: options.signal });

    for await (const chunk of stream) {
      yield* parseOpenAIChunk(chunk);
    }

    yield { type: 'finish', reason: 'stop' };
  },
};
```

---

## 6. Anthropic Provider 实现（P0 简化版）

```typescript
// src/llm/providers/anthropic.ts
import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider } from '../api-registry.js';
import type { GenerateOptions, GenerateResult, StreamChunk } from '../types.js';

// 转换逻辑类似 OpenAI，但适配 Anthropic Messages API 格式
// 具体实现参考 Anthropic SDK 文档

export const anthropicProvider: LLMProvider = {
  async generate(options: GenerateOptions): Promise<GenerateResult> {
    // ... 实现 ...
  },

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // ... 实现 ...
  },
};
```

**注**：Anthropic 的 Messages API 格式和 OpenAI 不同（系统提示是 `system` 参数而非 `messages[0]`，工具格式也不同），需要单独的转换逻辑。具体实现略，参考 Anthropic SDK 文档。

---

## 7. loop.ts 集成

### 7.1 TurnContext 扩展

```typescript
export interface TurnContext {
  input: { content: string };
  turnNumber: number;
  conversation: ModelMessage[];
  systemPrompt: string;
  availableTools: ToolSet;
  // 新增：Provider 配置
  provider: string;
  providerConfig: {
    apiKey: string;
    baseURL?: string;
    model: string;
  };
}
```

### 7.2 executeTurn 改造

```typescript
import { resolveProvider } from './llm/api-registry.js';

async executeTurn(ctx: TurnContext, state: AgentState): Promise<TurnResult> {
  await this.events.emit('turn:before', { agent: this, state });
  state.currentTurn = ctx.turnNumber;

  // === 1. PREPARE ===
  await this.events.emit('phase:prepare', { agent: this, state });
  const { systemPrompt, messages: contextMessages } = await this.memoryProvider.buildContext(state);
  let messages: ModelMessage[] = [...contextMessages, { role: 'user', content: ctx.input.content }];
  if (this.compressor.shouldCompress(state)) {
    messages = await this.compressor.compress(messages);
  }

  // === 2. REASON: 流式调用 ===
  await this.events.emit('phase:reason:before', { agent: this, state });

  const provider = resolveProvider(ctx.provider);
  const tools = this.toolProvider.getToolSet();

  let text = '';
  const toolCalls: Array<{toolCallId: string; toolName: string; input: unknown}> = [];
  let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  for await (const chunk of provider.stream({
    model: ctx.providerConfig.model,
    apiKey: ctx.providerConfig.apiKey,
    baseURL: ctx.providerConfig.baseURL,
    system: systemPrompt,
    messages,
    tools: Object.keys(tools).length > 0 ? tools : undefined,
  })) {
    if (chunk.type === 'text') {
      text += chunk.text;
    } else if (chunk.type === 'tool-call') {
      toolCalls.push({ toolCallId: chunk.toolCallId, toolName: chunk.toolName, input: chunk.input });
    } else if (chunk.type === 'usage') {
      usage = { inputTokens: chunk.inputTokens, outputTokens: chunk.outputTokens, totalTokens: chunk.totalTokens };
    }
  }

  await this.events.emit('phase:reason:after', { agent: this, state });

  // === 3. EXECUTE ===
  if (toolCalls.length > 0) {
    await this.events.emit('phase:execute:before', { agent: this, state });
    const results = await this.toolProvider.execute(toolCalls);
    for (const result of results) {
      state.addMessage({
        role: 'tool',
        toolCallId: result.toolCallId,
        toolName: result.toolName,
        content: result.error ?? result.output,
      } as ModelMessage);
    }
    await this.events.emit('phase:execute:after', { agent: this, state });
  }

  // === 4. OBSERVE ===
  state.addMessage({
    role: 'assistant',
    content: toolCalls.length > 0
      ? toolCalls.map(tc => ({ type: 'tool-call' as const, ...tc }))
      : text,
  });

  await this.events.emit('turn:after', { agent: this, state });

  const completed = toolCalls.length === 0;
  return {
    output: { content: text, completed },
    toolCalls,
    completed,
    shouldContinue: !completed,
    usage,
  };
}
```

### 7.3 与现有架构的关系

| 现有模块 | 变化 | 说明 |
|----------|------|------|
| `loop.ts` | 修改 | `generateText` → `resolveProvider().stream()` |
| `core-agent.ts` | 修改 | `CoreAgentConfig` 新增 `provider`/`providerConfig` |
| `TurnContext` | 修改 | 新增 provider 相关字段 |
| `TurnResult` | 不变 | 格式兼容 |
| `ToolProvider` | 不变 | 不受影响 |
| `MemoryProvider` | 不变 | 不受影响 |
| `EventBus` | 不变 | 不受影响 |

---

## 8. 内置 Provider 注册

```typescript
// src/llm/providers/index.ts
import { registerProvider } from '../api-registry.js';
import { openaiProvider } from './openai.js';
import { anthropicProvider } from './anthropic.js';

export function registerBuiltInProviders(): void {
  registerProvider('openai', openaiProvider);
  registerProvider('anthropic', anthropicProvider);
}
```

在 `core-agent.ts` 中调用：

```typescript
import { registerBuiltInProviders } from './llm/providers/index.js';

// CoreAgent 构造函数或 initialize 中
registerBuiltInProviders();
```

---

## 9. 依赖变化

### 新增依赖

```json
{
  "dependencies": {
    "openai": "^4.x",
    "@anthropic-ai/sdk": "^0.x"
  }
}
```

### 移除/弱化依赖

- `ai` 包的 `generateText` / `streamText` 不再使用
- 但保留 `ai` 包作为 devDependency 或 peerDependency，用于 `ModelMessage`/`ToolSet` 类型

---

## 10. 渐进式路线图

| 阶段 | 工作项 | Provider |
|------|--------|----------|
| **P0** | ApiRegistry + OpenAI Provider (stream/generate) | openai |
| **P0** | Anthropic Provider | anthropic |
| **P0** | loop.ts 替换 generateText → stream() | — |
| **P1** | 非流式 fallback（`generate()` 完整测试覆盖） | openai, anthropic |
| **P1** | 第三方 Provider 动态注册（插件化） | 任意 |
| **P2** | 更多内置 Provider（Google、Mistral、Azure） | google, mistral, azure |

---

*设计日期：2026-06-11*
*基于 OpenClaw ApiRegistry 模式，简化实现。*
