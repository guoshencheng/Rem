# LLM Provider 层实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自建 LLM Provider 层，替换 `loop.ts` 中的 `generateText`，实现 OpenAI + Anthropic 两家 Provider 的流式/非流式调用，loop 通过 `InferenceEngine` 调用。

**Architecture:** ApiRegistry 注册 Provider，`LLMProvider` 接口定义 `generate()`/`stream()`，`InferenceEngine` 封装 Provider 解析、stream 调用、结果聚合。loop 只调用 `engine.infer()`。

**Tech Stack:** TypeScript ESM, `openai` SDK, `@anthropic-ai/sdk`, Vitest

---

## 文件结构

```
packages/core/src/
├── llm/
│   ├── types.ts                    # GenerateOptions/Result/Chunk/Collector
│   ├── api-registry.ts             # ApiRegistry + LLMProvider 接口
│   ├── engine.ts                   # InferenceEngine
│   └── providers/
│       ├── openai.ts               # OpenAI Provider
│       ├── anthropic.ts            # Anthropic Provider
│       └── index.ts                # 注册内置 Provider
├── loop.ts                         # 改造：InferenceEngine 替换 generateText
├── core-agent.ts                   # 改造：新增 provider/providerConfig
├── index.ts                        # 导出 llm 模块
└── package.json                    # 新增 openai / @anthropic-ai/sdk 依赖

packages/core/tests/
├── llm/
│   ├── types.test.ts               # StreamCollector 测试
│   ├── api-registry.test.ts        # Registry 测试
│   ├── engine.test.ts              # InferenceEngine 测试
│   └── providers/
│       ├── openai.test.ts          # OpenAI Provider 测试
│       └── anthropic.test.ts       # Anthropic Provider 测试
├── loop.test.ts                    # 更新：mock InferenceEngine
└── core-agent.test.ts              # 更新：provider 配置
```

---

## Task 1: 新增 LLM 核心类型（types.ts）

**Files:**
- Create: `packages/core/src/llm/types.ts`
- Create: `packages/core/tests/llm/types.test.ts`

- [ ] **Step 1: 写测试**

Create `packages/core/tests/llm/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { StreamCollector, collectStream } from '../../src/llm/types.js';
import type { StreamChunk } from '../../src/llm/types.js';

describe('StreamCollector', () => {
  it('should aggregate text chunks', () => {
    const collector = new StreamCollector();
    collector.feed({ type: 'text', text: 'Hello' });
    collector.feed({ type: 'text', text: ' world' });
    expect(collector.result().text).toBe('Hello world');
  });

  it('should aggregate tool calls', () => {
    const collector = new StreamCollector();
    collector.feed({ type: 'tool-call', toolCallId: 'tc1', toolName: 'echo', input: { msg: 'hi' } });
    expect(collector.result().toolCalls).toHaveLength(1);
    expect(collector.result().toolCalls[0].toolName).toBe('echo');
  });

  it('should aggregate usage', () => {
    const collector = new StreamCollector();
    collector.feed({ type: 'usage', inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(collector.result().usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });

  it('should ignore finish chunks', () => {
    const collector = new StreamCollector();
    collector.feed({ type: 'finish', reason: 'stop' });
    expect(collector.result().text).toBe('');
  });
});

describe('collectStream', () => {
  it('should collect async stream', async () => {
    async function* stream(): AsyncIterable<StreamChunk> {
      yield { type: 'text', text: 'Hi' };
      yield { type: 'usage', inputTokens: 1, outputTokens: 1, totalTokens: 2 };
    }

    const result = await collectStream(stream());
    expect(result.text).toBe('Hi');
    expect(result.usage.totalTokens).toBe(2);
  });
});
```

- [ ] **Step 2: 运行测试（应失败）**

```bash
cd /Users/guoshencheng/Documents/work/rem && npx vitest run packages/core/tests/llm/types.test.ts
```

Expected: FAIL — `StreamCollector` not found

- [ ] **Step 3: 实现 types.ts**

Create `packages/core/src/llm/types.ts`:

```typescript
import type { ModelMessage, ToolSet } from 'ai';

export interface GenerateOptions {
  model: string;
  apiKey: string;
  baseURL?: string;
  system?: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

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

export type StreamChunk =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'usage'; inputTokens: number; outputTokens: number; totalTokens: number }
  | { type: 'finish'; reason: string };

export class StreamCollector {
  private text = '';
  private toolCalls: GenerateResult['toolCalls'] = [];
  private usage: GenerateResult['usage'] = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  feed(chunk: StreamChunk): void {
    if (chunk.type === 'text') {
      this.text += chunk.text;
    } else if (chunk.type === 'tool-call') {
      this.toolCalls.push({
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        input: chunk.input,
      });
    } else if (chunk.type === 'usage') {
      this.usage = {
        inputTokens: chunk.inputTokens,
        outputTokens: chunk.outputTokens,
        totalTokens: chunk.totalTokens,
      };
    }
  }

  result(): GenerateResult {
    return {
      text: this.text,
      toolCalls: this.toolCalls,
      usage: this.usage,
    };
  }
}

export async function collectStream(stream: AsyncIterable<StreamChunk>): Promise<GenerateResult> {
  const collector = new StreamCollector();
  for await (const chunk of stream) {
    collector.feed(chunk);
  }
  return collector.result();
}
```

- [ ] **Step 4: 运行测试（应通过）**

```bash
cd /Users/guoshencheng/Documents/work/rem && npx vitest run packages/core/tests/llm/types.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/llm/types.ts packages/core/tests/llm/types.test.ts
git commit -m "feat(llm): add StreamCollector and core LLM types

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 新增 ApiRegistry（api-registry.ts）

**Files:**
- Create: `packages/core/src/llm/api-registry.ts`
- Create: `packages/core/tests/llm/api-registry.test.ts`

- [ ] **Step 1: 写测试**

Create `packages/core/tests/llm/api-registry.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerProvider,
  resolveProvider,
  listProviders,
  clearProviders,
  type LLMProvider,
} from '../../src/llm/api-registry.js';

const mockProvider: LLMProvider = {
  generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
  stream: async function* () { yield { type: 'finish', reason: 'stop' }; },
};

describe('ApiRegistry', () => {
  beforeEach(() => {
    clearProviders();
  });

  it('should register and resolve provider', () => {
    registerProvider('mock', mockProvider);
    expect(resolveProvider('mock')).toBe(mockProvider);
  });

  it('should list registered providers', () => {
    registerProvider('a', mockProvider);
    registerProvider('b', mockProvider);
    expect(listProviders().sort()).toEqual(['a', 'b']);
  });

  it('should throw on unknown provider', () => {
    expect(() => resolveProvider('unknown')).toThrow('Unknown provider');
  });

  it('should throw on duplicate registration', () => {
    registerProvider('mock', mockProvider);
    expect(() => registerProvider('mock', mockProvider)).toThrow('already registered');
  });
});
```

- [ ] **Step 2: 运行测试（应失败）**

```bash
cd /Users/guoshencheng/Documents/work/rem && npx vitest run packages/core/tests/llm/api-registry.test.ts
```

Expected: FAIL — registry functions not found

- [ ] **Step 3: 实现 api-registry.ts**

Create `packages/core/src/llm/api-registry.ts`:

```typescript
import type { GenerateOptions, GenerateResult, StreamChunk } from './types.js';

export interface LLMProvider {
  generate(options: GenerateOptions): Promise<GenerateResult>;
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
    throw new Error(
      `Unknown provider: "${id}". Available: ${listProviders().join(', ') || 'none'}`,
    );
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

- [ ] **Step 4: 运行测试（应通过）**

```bash
cd /Users/guoshencheng/Documents/work/rem && npx vitest run packages/core/tests/llm/api-registry.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/llm/api-registry.ts packages/core/tests/llm/api-registry.test.ts
git commit -m "feat(llm): add ApiRegistry for provider resolution

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: OpenAI Provider

**Files:**
- Create: `packages/core/src/llm/providers/openai.ts`
- Create: `packages/core/tests/llm/providers/openai.test.ts`

- [ ] **Step 1: 安装依赖**

```bash
cd /Users/guoshencheng/Documents/work/rem/packages/core && npm install openai
```

- [ ] **Step 2: 写测试**

Create `packages/core/tests/llm/providers/openai.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { openaiProvider } from '../../../src/llm/providers/openai.js';
import OpenAI from 'openai';

vi.mock('openai');

describe('openaiProvider', () => {
  it('should generate text', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{
        message: {
          content: 'Hello!',
          tool_calls: [],
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    vi.mocked(OpenAI).mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    }) as any);

    const result = await openaiProvider.generate({
      model: 'gpt-4o',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.text).toBe('Hello!');
    expect(result.usage.totalTokens).toBe(15);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o', stream: undefined }),
      expect.anything(),
    );
  });

  it('should parse tool calls', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{
        message: {
          content: '',
          tool_calls: [{
            id: 'tc1',
            function: { name: 'echo', arguments: '{"msg":"hi"}' },
          }],
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    vi.mocked(OpenAI).mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    }) as any);

    const result = await openaiProvider.generate({
      model: 'gpt-4o',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'Hi' }],
      tools: {
        echo: { description: 'echo', parameters: { type: 'object' } },
      } as any,
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].toolName).toBe('echo');
    expect(result.toolCalls[0].input).toEqual({ msg: 'hi' });
  });

  it('should stream text chunks', async () => {
    async function* mockStream() {
      yield { choices: [{ delta: { content: 'Hello' } }] };
      yield { choices: [{ delta: { content: ' world' } }] };
      yield { usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } };
    }

    const mockCreate = vi.fn().mockResolvedValue(mockStream());
    vi.mocked(OpenAI).mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    }) as any);

    const chunks: any[] = [];
    for await (const chunk of openaiProvider.stream({
      model: 'gpt-4o',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'Hi' }],
    })) {
      chunks.push(chunk);
    }

    const text = chunks.filter(c => c.type === 'text').map(c => c.text).join('');
    expect(text).toBe('Hello world');
  });
});
```

- [ ] **Step 3: 运行测试（应失败）**

```bash
cd /Users/guoshencheng/Documents/work/rem && npx vitest run packages/core/tests/llm/providers/openai.test.ts
```

Expected: FAIL — OpenAI Provider 未实现

- [ ] **Step 4: 实现 openai.ts**

Create `packages/core/src/llm/providers/openai.ts`:

```typescript
import OpenAI from 'openai';
import type { LLMProvider } from '../api-registry.js';
import type { GenerateOptions, GenerateResult, StreamChunk } from '../types.js';

function convertToOpenAIMessages(
  messages: GenerateOptions['messages'],
  system?: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
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
      const toolMsg = msg as any;
      result.push({
        role: 'tool',
        tool_call_id: toolMsg.toolCallId,
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
  const message = response.choices[0]?.message ?? { content: '', tool_calls: [] };
  const text = message.content ?? '';
  const toolCalls = (message.tool_calls ?? []).map(tc => ({
    toolCallId: tc.id,
    toolName: tc.function.name,
    input: safeJsonParse(tc.function.arguments),
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
          toolCallId: tc.id ?? '',
          toolName: tc.function.name,
          input: safeJsonParse(tc.function.arguments ?? '{}'),
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

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
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
      stream: false,
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

- [ ] **Step 5: 运行测试（应通过）**

```bash
cd /Users/guoshencheng/Documents/work/rem && npx vitest run packages/core/tests/llm/providers/openai.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/llm/providers/openai.ts packages/core/tests/llm/providers/openai.test.ts packages/core/package.json packages/core/package-lock.json 2>/dev/null || true
git commit -m "feat(llm): add OpenAI provider with streaming and tool support

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Anthropic Provider

**Files:**
- Create: `packages/core/src/llm/providers/anthropic.ts`
- Create: `packages/core/tests/llm/providers/anthropic.test.ts`

- [ ] **Step 1: 安装依赖**

```bash
cd /Users/guoshencheng/Documents/work/rem/packages/core && npm install @anthropic-ai/sdk
```

- [ ] **Step 2: 写测试**

Create `packages/core/tests/llm/providers/anthropic.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { anthropicProvider } from '../../../src/llm/providers/anthropic.js';
import Anthropic from '@anthropic-ai/sdk';

vi.mock('@anthropic-ai/sdk');

describe('anthropicProvider', () => {
  it('should generate text', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Hello!' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    vi.mocked(Anthropic).mockImplementation(() => ({
      messages: { create: mockCreate },
    }) as any);

    const result = await anthropicProvider.generate({
      model: 'claude-sonnet-4-7',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.text).toBe('Hello!');
    expect(result.usage.totalTokens).toBe(15);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-7', stream: false }),
      expect.anything(),
    );
  });

  it('should parse tool_use blocks', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{
        type: 'tool_use',
        id: 'tc1',
        name: 'echo',
        input: { msg: 'hi' },
      }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    vi.mocked(Anthropic).mockImplementation(() => ({
      messages: { create: mockCreate },
    }) as any);

    const result = await anthropicProvider.generate({
      model: 'claude-sonnet-4-7',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].toolName).toBe('echo');
  });

  it('should stream text chunks', async () => {
    async function* mockStream() {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } };
      yield { type: 'message_delta', usage: { output_tokens: 2 } };
    }

    const mockCreate = vi.fn().mockResolvedValue(mockStream());
    vi.mocked(Anthropic).mockImplementation(() => ({
      messages: { create: mockCreate },
    }) as any);

    const chunks: any[] = [];
    for await (const chunk of anthropicProvider.stream({
      model: 'claude-sonnet-4-7',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'Hi' }],
    })) {
      chunks.push(chunk);
    }

    const text = chunks.filter(c => c.type === 'text').map(c => c.text).join('');
    expect(text).toBe('Hello world');
  });
});
```

- [ ] **Step 3: 运行测试（应失败）**

```bash
cd /Users/guoshencheng/Documents/work/rem && npx vitest run packages/core/tests/llm/providers/anthropic.test.ts
```

Expected: FAIL — Anthropic Provider 未实现

- [ ] **Step 4: 实现 anthropic.ts**

Create `packages/core/src/llm/providers/anthropic.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider } from '../api-registry.js';
import type { GenerateOptions, GenerateResult, StreamChunk } from '../types.js';

function convertToAnthropicMessages(messages: GenerateOptions['messages']): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content as string });
    } else if (msg.role === 'assistant') {
      const content = msg.content;
      if (typeof content === 'string') {
        result.push({ role: 'assistant', content });
      } else if (Array.isArray(content)) {
        const blocks: Anthropic.ContentBlockParam[] = [];
        for (const part of content) {
          if (part.type === 'text') {
            blocks.push({ type: 'text', text: part.text });
          } else if (part.type === 'tool-call') {
            blocks.push({
              type: 'tool_use',
              id: part.toolCallId,
              name: part.toolName,
              input: part.input,
            });
          }
        }
        result.push({ role: 'assistant', content: blocks });
      }
    } else if (msg.role === 'tool') {
      const toolMsg = msg as any;
      result.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: toolMsg.toolCallId,
          content: msg.content as string,
        }],
      });
    }
  }

  return result;
}

function convertToAnthropicTools(tools: GenerateOptions['tools']): Anthropic.Tool[] {
  if (!tools) return [];
  return Object.entries(tools).map(([name, tool]) => ({
    name,
    description: (tool as any).description ?? '',
    input_schema: (tool as any).parameters ?? { type: 'object' },
  }));
}

function parseAnthropicResponse(response: Anthropic.Message): GenerateResult {
  const text = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map(c => c.text)
    .join('');

  const toolCalls = response.content
    .filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use')
    .map(tc => ({
      toolCallId: tc.id,
      toolName: tc.name,
      input: tc.input,
    }));

  return {
    text,
    toolCalls,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    },
  };
}

function* parseAnthropicStreamEvent(event: Anthropic.Messages.RawMessageStreamEvent): Generator<StreamChunk> {
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    yield { type: 'text', text: event.delta.text };
  } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
    yield {
      type: 'tool-call',
      toolCallId: event.content_block.id,
      toolName: event.content_block.name,
      input: event.content_block.input,
    };
  } else if (event.type === 'message_delta' && event.usage) {
    yield {
      type: 'usage',
      inputTokens: 0,
      outputTokens: event.usage.output_tokens,
      totalTokens: event.usage.output_tokens,
    };
  }
}

export const anthropicProvider: LLMProvider = {
  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });

    const response = await client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens ?? 4096,
      system: options.system,
      messages: convertToAnthropicMessages(options.messages),
      tools: options.tools ? convertToAnthropicTools(options.tools) : undefined,
      temperature: options.temperature,
      stream: false,
    }, { signal: options.signal });

    return parseAnthropicResponse(response);
  },

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });

    const stream = await client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens ?? 4096,
      system: options.system,
      messages: convertToAnthropicMessages(options.messages),
      tools: options.tools ? convertToAnthropicTools(options.tools) : undefined,
      temperature: options.temperature,
      stream: true,
    }, { signal: options.signal });

    for await (const event of stream) {
      yield* parseAnthropicStreamEvent(event);
    }

    yield { type: 'finish', reason: 'stop' };
  },
};
```

- [ ] **Step 5: 运行测试（应通过）**

```bash
cd /Users/guoshencheng/Documents/work/rem && npx vitest run packages/core/tests/llm/providers/anthropic.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/llm/providers/anthropic.ts packages/core/tests/llm/providers/anthropic.test.ts packages/core/package.json packages/core/package-lock.json 2>/dev/null || true
git commit -m "feat(llm): add Anthropic provider with streaming and tool support

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Provider 注册模块

**Files:**
- Create: `packages/core/src/llm/providers/index.ts`

- [ ] **Step 1: 创建注册文件**

Create `packages/core/src/llm/providers/index.ts`:

```typescript
import { registerProvider } from '../api-registry.js';
import { openaiProvider } from './openai.js';
import { anthropicProvider } from './anthropic.js';

export function registerBuiltInProviders(): void {
  registerProvider('openai', openaiProvider);
  registerProvider('anthropic', anthropicProvider);
}

export { openaiProvider, anthropicProvider };
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/llm/providers/index.ts
git commit -m "feat(llm): add built-in provider registration

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: InferenceEngine

**Files:**
- Create: `packages/core/src/llm/engine.ts`
- Create: `packages/core/tests/llm/engine.test.ts`

- [ ] **Step 1: 写测试**

Create `packages/core/tests/llm/engine.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InferenceEngine } from '../../src/llm/engine.js';
import { registerProvider, clearProviders } from '../../src/llm/api-registry.js';

describe('InferenceEngine', () => {
  beforeEach(() => {
    clearProviders();
  });

  it('should infer using registered provider', async () => {
    registerProvider('mock', {
      generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
      stream: async function* () {
        yield { type: 'text', text: 'Hello' };
        yield { type: 'usage', inputTokens: 1, outputTokens: 1, totalTokens: 2 };
      },
    });

    const engine = new InferenceEngine();
    const result = await engine.infer({
      provider: 'mock',
      providerConfig: { apiKey: 'key', model: 'model' },
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.text).toBe('Hello');
    expect(result.usage.totalTokens).toBe(2);
  });

  it('should call onChunk for each chunk', async () => {
    registerProvider('mock', {
      generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
      stream: async function* () {
        yield { type: 'text', text: 'A' };
        yield { type: 'text', text: 'B' };
      },
    });

    const onChunk = vi.fn();
    const engine = new InferenceEngine();
    await engine.infer({
      provider: 'mock',
      providerConfig: { apiKey: 'key', model: 'model' },
      messages: [],
      onChunk,
    });

    expect(onChunk).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: 运行测试（应失败）**

```bash
cd /Users/guoshencheng/Documents/work/rem && npx vitest run packages/core/tests/llm/engine.test.ts
```

Expected: FAIL — InferenceEngine 未实现

- [ ] **Step 3: 实现 engine.ts**

Create `packages/core/src/llm/engine.ts`:

```typescript
import type { ModelMessage, ToolSet } from 'ai';
import { resolveProvider } from './api-registry.js';
import { StreamCollector } from './types.js';
import type { GenerateOptions, GenerateResult, StreamChunk } from './types.js';

export interface InferenceOptions {
  provider: string;
  providerConfig: {
    apiKey: string;
    baseURL?: string;
    model: string;
  };
  system?: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onChunk?: (chunk: StreamChunk) => void | Promise<void>;
}

export interface InferenceResult extends GenerateResult {}

export class InferenceEngine {
  async infer(options: InferenceOptions): Promise<InferenceResult> {
    const provider = resolveProvider(options.provider);
    const collector = new StreamCollector();

    const generateOptions: GenerateOptions = {
      model: options.providerConfig.model,
      apiKey: options.providerConfig.apiKey,
      baseURL: options.providerConfig.baseURL,
      system: options.system,
      messages: options.messages,
      tools: options.tools,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      signal: options.signal,
    };

    for await (const chunk of provider.stream(generateOptions)) {
      collector.feed(chunk);
      if (options.onChunk) {
        await options.onChunk(chunk);
      }
    }

    return collector.result();
  }
}
```

- [ ] **Step 4: 运行测试（应通过）**

```bash
cd /Users/guoshencheng/Documents/work/rem && npx vitest run packages/core/tests/llm/engine.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/llm/engine.ts packages/core/tests/llm/engine.test.ts
git commit -m "feat(llm): add InferenceEngine to encapsulate provider calls

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 改造 loop.ts

**Files:**
- Modify: `packages/core/src/loop.ts`
- Modify: `packages/core/tests/loop.test.ts`

- [ ] **Step 1: 更新测试**

Replace `packages/core/tests/loop.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLoop } from '../src/loop.js';
import { AgentState } from '../src/state.js';
import { EventBus } from '../src/events.js';
import { IterationBudget } from '../src/budget.js';
import { registerProvider, clearProviders } from '../src/llm/api-registry.js';

const createMockModel = (): any => ({ provider: 'test', modelId: 'test-model' });

const createMockProviders = () => ({
  toolProvider: {
    getToolSet: vi.fn().mockReturnValue({}),
    execute: vi.fn().mockResolvedValue([]),
  },
  memoryProvider: {
    buildContext: vi.fn().mockResolvedValue({
      systemPrompt: 'You are test',
      messages: [],
    }),
  },
  compressor: {
    shouldCompress: vi.fn().mockReturnValue(false),
  },
});

describe('AgentLoop', () => {
  beforeEach(() => {
    clearProviders();
    registerProvider('mock', {
      generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
      stream: async function* () {
        yield { type: 'text', text: 'Hello!' };
        yield { type: 'usage', inputTokens: 5, outputTokens: 5, totalTokens: 10 };
      },
    });
  });

  it('should execute a simple turn without tools', async () => {
    const state = new AgentState(new IterationBudget({ maxTurns: 5 }));
    const events = new EventBus();
    const mocks = createMockProviders();
    const loop = new AgentLoop(createMockModel(), events, mocks.toolProvider, mocks.memoryProvider, mocks.compressor);

    const result = await loop.executeTurn({
      input: { content: 'Hi' },
      turnNumber: 1,
      conversation: [],
      systemPrompt: 'You are helpful',
      availableTools: {},
      provider: 'mock',
      providerConfig: { apiKey: 'key', model: 'model' },
    }, state);

    expect(result.output.content).toBe('Hello!');
    expect(result.completed).toBe(true);
    expect(result.shouldContinue).toBe(false);
  });

  it('should emit turn events', async () => {
    const state = new AgentState(new IterationBudget({ maxTurns: 5 }));
    const events = new EventBus();
    const beforeHandler = vi.fn();
    const afterHandler = vi.fn();

    events.on('turn:before', beforeHandler);
    events.on('turn:after', afterHandler);

    const mocks = createMockProviders();
    const loop = new AgentLoop(createMockModel(), events, mocks.toolProvider, mocks.memoryProvider, mocks.compressor);
    await loop.executeTurn({
      input: { content: 'test' },
      turnNumber: 1,
      conversation: [],
      systemPrompt: '',
      availableTools: {},
      provider: 'mock',
      providerConfig: { apiKey: 'key', model: 'model' },
    }, state);

    expect(beforeHandler).toHaveBeenCalled();
    expect(afterHandler).toHaveBeenCalled();
  });

  it('should execute tools and continue when toolCalls present', async () => {
    registerProvider('mock-tools', {
      generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
      stream: async function* () {
        yield { type: 'tool-call', toolCallId: 'tc1', toolName: 'echo', input: { msg: 'hi' } };
        yield { type: 'usage', inputTokens: 5, outputTokens: 5, totalTokens: 10 };
      },
    });

    const mocks = createMockProviders();
    mocks.toolProvider.execute.mockResolvedValue([
      { toolCallId: 'tc1', toolName: 'echo', output: 'result' },
    ]);

    const state = new AgentState(new IterationBudget({ maxTurns: 5 }));
    const events = new EventBus();
    const loop = new AgentLoop(createMockModel(), events, mocks.toolProvider, mocks.memoryProvider, mocks.compressor);

    const result = await loop.executeTurn({
      input: { content: 'Hi' },
      turnNumber: 1,
      conversation: [],
      systemPrompt: 'You are test',
      availableTools: {},
      provider: 'mock-tools',
      providerConfig: { apiKey: 'key', model: 'model' },
    }, state);

    expect(mocks.toolProvider.execute).toHaveBeenCalledWith([
      { toolCallId: 'tc1', toolName: 'echo', input: { msg: 'hi' } },
    ]);
    expect(result.completed).toBe(false);
    expect(result.shouldContinue).toBe(true);
    expect(state.conversation.some(m => (m as any).role === 'tool')).toBe(true);
  });

  it('should use memoryProvider to build context', async () => {
    const mocks = createMockProviders();
    mocks.memoryProvider.buildContext.mockResolvedValue({
      systemPrompt: 'Custom system prompt',
      messages: [{ role: 'user', content: 'previous' }],
    });

    const state = new AgentState(new IterationBudget({ maxTurns: 5 }));
    const events = new EventBus();
    const loop = new AgentLoop(createMockModel(), events, mocks.toolProvider, mocks.memoryProvider, mocks.compressor);

    await loop.executeTurn({
      input: { content: 'Hi' },
      turnNumber: 1,
      conversation: [],
      systemPrompt: 'ignored',
      availableTools: {},
      provider: 'mock',
      providerConfig: { apiKey: 'key', model: 'model' },
    }, state);

    expect(mocks.memoryProvider.buildContext).toHaveBeenCalledWith(state);
  });

  it('should call compressor when shouldCompress returns true', async () => {
    const mocks = createMockProviders();
    mocks.compressor.shouldCompress.mockReturnValue(true);
    mocks.compressor.compress.mockResolvedValue([
      { role: 'user', content: 'compressed' },
    ]);

    const state = new AgentState(new IterationBudget({ maxTurns: 5 }));
    const events = new EventBus();
    const loop = new AgentLoop(createMockModel(), events, mocks.toolProvider, mocks.memoryProvider, mocks.compressor);

    await loop.executeTurn({
      input: { content: 'Hi' },
      turnNumber: 1,
      conversation: [],
      systemPrompt: '',
      availableTools: {},
      provider: 'mock',
      providerConfig: { apiKey: 'key', model: 'model' },
    }, state);

    expect(mocks.compressor.shouldCompress).toHaveBeenCalledWith(state);
    expect(mocks.compressor.compress).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试（应失败）**

```bash
cd /Users/guoshencheng/Documents/work/rem && npx vitest run packages/core/tests/loop.test.ts
```

Expected: FAIL — `TurnContext` 缺少 `provider`/`providerConfig`

- [ ] **Step 3: 改造 loop.ts**

Replace `packages/core/src/loop.ts`:

```typescript
import type { ModelMessage, ToolSet, LanguageModelUsage, LanguageModel } from 'ai';
import type { AgentState } from './state.js';
import type { EventBus } from './events.js';
import type { AgentOutput } from './types.js';
import type { ToolProvider, ToolCall } from './sdk/tool-provider.js';
import type { MemoryProvider } from './sdk/memory-provider.js';
import type { ContextCompressor } from './sdk/compressor.js';
import { InferenceEngine } from './llm/engine.js';

export interface TurnContext {
  input: { content: string };
  turnNumber: number;
  conversation: ModelMessage[];
  systemPrompt: string;
  availableTools: ToolSet;
  provider: string;
  providerConfig: {
    apiKey: string;
    baseURL?: string;
    model: string;
  };
}

export interface TurnResult {
  output: AgentOutput;
  toolCalls: { toolCallId: string; toolName: string; input: unknown }[];
  completed: boolean;
  shouldContinue: boolean;
  usage: LanguageModelUsage;
}

export class AgentLoop {
  private inferenceEngine = new InferenceEngine();

  constructor(
    private model: LanguageModel,
    private events: EventBus,
    private toolProvider: ToolProvider,
    private memoryProvider: MemoryProvider,
    private compressor: ContextCompressor,
  ) {}

  async executeTurn(ctx: TurnContext, state: AgentState): Promise<TurnResult> {
    await this.events.emit('turn:before', { agent: this as any, state });

    state.currentTurn = ctx.turnNumber;

    // === 1. PREPARE: 消息组装 ===
    await this.events.emit('phase:prepare', { agent: this as any, state });

    const { systemPrompt, messages: contextMessages } = await this.memoryProvider.buildContext(state);

    let messages: ModelMessage[] = [
      ...contextMessages,
      { role: 'user', content: ctx.input.content },
    ];

    if (this.compressor.shouldCompress(state)) {
      messages = await this.compressor.compress(messages);
    }

    // === 2. REASON: 调用 InferenceEngine ===
    await this.events.emit('phase:reason:before', { agent: this as any, state });

    const tools = this.toolProvider.getToolSet();
    const { text, toolCalls, usage } = await this.inferenceEngine.infer({
      provider: ctx.provider,
      providerConfig: ctx.providerConfig,
      system: systemPrompt,
      messages,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      onChunk: async (chunk) => {
        await this.events.emit('stream:chunk', { agent: this as any, state, chunk });
      },
    });

    await this.events.emit('phase:reason:after', { agent: this as any, state });

    // === 3. EXECUTE: 工具执行 ===
    const toolCallRecords: ToolCall[] = toolCalls.map(tc => ({
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      input: tc.input,
    }));

    if (toolCallRecords.length > 0) {
      await this.events.emit('phase:execute:before', { agent: this as any, state });

      const results = await this.toolProvider.execute(toolCallRecords);

      for (const result of results) {
        state.addMessage({
          role: 'tool',
          toolCallId: result.toolCallId,
          toolName: result.toolName,
          content: result.error ?? result.output,
        } as ModelMessage);
      }

      await this.events.emit('phase:execute:after', { agent: this as any, state });
    }

    // === 4. OBSERVE: 更新状态 ===
    state.addMessage({
      role: 'assistant',
      content: toolCallRecords.length > 0
        ? toolCallRecords.map(tc => ({ type: 'tool-call' as const, ...tc }))
        : text,
    });

    await this.events.emit('turn:after', { agent: this as any, state });

    const completed = toolCallRecords.length === 0;

    return {
      output: {
        content: text,
        completed,
      },
      toolCalls: toolCallRecords,
      completed,
      shouldContinue: !completed,
      usage,
    };
  }
}
```

- [ ] **Step 4: 运行测试（应通过）**

```bash
cd /Users/guoshencheng/Documents/work/rem && npx vitest run packages/core/tests/loop.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/loop.ts packages/core/tests/loop.test.ts
git commit -m "feat(loop): replace generateText with InferenceEngine

- TurnContext now includes provider and providerConfig
- AgentLoop uses InferenceEngine for all LLM calls
- Stream events emitted via stream:chunk event

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: 改造 core-agent.ts

**Files:**
- Modify: `packages/core/src/core-agent.ts`
- Modify: `packages/core/tests/core-agent.test.ts`

- [ ] **Step 1: 更新测试**

Append to `packages/core/tests/core-agent.test.ts` (after existing tests):

```typescript
  it('should require provider config', async () => {
    vi.mocked(ai.generateText).mockClear();

    registerProvider('mock-agent', {
      generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
      stream: async function* () {
        yield { type: 'text', text: 'Done!' };
        yield { type: 'usage', inputTokens: 1, outputTokens: 1, totalTokens: 2 };
      },
    });

    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
      budget: new IterationBudget({ maxTurns: 5 }),
      provider: 'mock-agent',
      providerConfig: { apiKey: 'key', model: 'model' },
    });

    await agent.initialize();
    const result = await agent.run({ content: 'Hello' });

    expect(result.content).toBe('Done!');
  });
```

Add import at top:
```typescript
import { registerProvider } from '../src/llm/api-registry.js';
```

- [ ] **Step 2: 改造 core-agent.ts**

Modify `packages/core/src/core-agent.ts`:

1. Add `provider` and `providerConfig` to `CoreAgentConfig`:

```typescript
export interface CoreAgentConfig {
  name: string;
  model: LanguageModel;
  budget?: IterationBudget;
  toolProvider?: ToolProvider;
  memoryProvider?: MemoryProvider;
  errorHandler?: ErrorHandler;
  budgetPolicy?: BudgetPolicy;
  compressor?: ContextCompressor;
  provider?: string;
  providerConfig?: {
    apiKey: string;
    baseURL?: string;
    model: string;
  };
}
```

2. In `run()`, pass provider config to `executeTurn`:

```typescript
const result = await this._getLoop().executeTurn({
  input,
  turnNumber,
  conversation: this.state.conversation,
  systemPrompt: `You are ${this.config.name}.`,
  availableTools: {},
  provider: this.config.provider ?? 'openai',
  providerConfig: this.config.providerConfig ?? {
    apiKey: '',
    model: 'gpt-4o',
  },
}, this.state);
```

3. Register built-in providers in constructor or initialize:

```typescript
import { registerBuiltInProviders } from './llm/providers/index.js';

export class CoreAgent {
  constructor(config: CoreAgentConfig) {
    this.config = config;
    this.events = new EventBus();
    this.state = new AgentState(config.budget);
    registerBuiltInProviders(); // 确保内置 provider 已注册
  }
  // ...
}
```

- [ ] **Step 3: 运行测试（应通过）**

```bash
cd /Users/guoshencheng/Documents/work/rem && npx vitest run packages/core/tests/core-agent.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/core-agent.ts packages/core/tests/core-agent.test.ts
git commit -m "feat(harness): add provider and providerConfig to CoreAgent

- CoreAgentConfig accepts provider and providerConfig
- Defaults to openai provider if not specified
- registerBuiltInProviders called on construction

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: 更新 index.ts 导出

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 更新导出**

Replace `packages/core/src/index.ts`:

```typescript
export * from './types.js';
export * from './budget.js';
export * from './state.js';
export * from './events.js';
export * from './loop.js';
export * from './core-agent.js';
export * from './sdk/index.js';
export * from './defaults/index.js';
export * from './llm/types.js';
export * from './llm/api-registry.js';
export * from './llm/engine.js';
export * from './llm/providers/index.js';
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "chore(exports): expose llm module in public API

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: 端到端验证

- [ ] **Step 1: 运行全部测试**

```bash
cd /Users/guoshencheng/Documents/work/rem && npx vitest run packages/core/tests/
```

Expected: 全部通过（约 15+ 测试文件，60+ 测试用例）

- [ ] **Step 2: 检查 package.json 依赖**

确认 `packages/core/package.json` 包含：

```json
{
  "dependencies": {
    "ai": "6.0.199",
    "openai": "^4.x",
    "@anthropic-ai/sdk": "^0.x"
  }
}
```

- [ ] **Step 3: Commit 验证结果**

```bash
git add -A
git commit -m "test: verify full LLM provider layer integration

All tests passing with new InferenceEngine-based provider architecture.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

### Spec Coverage

| 设计文档章节 | 实现任务 |
|-------------|---------|
| 4. 核心类型 | Task 1 |
| 5. ApiRegistry | Task 2 |
| 6. OpenAI Provider | Task 3 |
| 7. Anthropic Provider | Task 4 |
| 8. Provider 注册 | Task 5 |
| 9. InferenceEngine | Task 6 |
| 10. loop.ts 集成 | Task 7 |
| 11. core-agent.ts 集成 | Task 8 |
| 12. 内置 Provider 注册 | Task 5 |

### Placeholder Scan

- 无 TBD/TODO ✅
- 所有步骤包含完整代码 ✅
- 所有步骤包含命令和预期输出 ✅

### Type Consistency

- `GenerateOptions` 在 types.ts 定义，在 OpenAI/Anthropic/Engine 中一致使用 ✅
- `StreamChunk` 类型在所有 provider 中一致 ✅
- `TurnContext` 新增字段与 loop/core-agent 一致 ✅

---

*计划完成日期：2026-06-11*
*基于设计文档：`docs/superpowers/specs/2026-06-11-llm-provider-layer-design.md`*
