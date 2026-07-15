# 借鉴 PI `fauxProvider` 改进 REM 测试策略调研报告

> 调研范围：REM `packages/core` / `packages/bridge` 测试结构，PI `packages/ai` 的 `fauxProvider` 实现与使用示例。
>
> 输出日期：2026-07-15

---

## 1. 执行摘要：结论与推荐方案

**结论**：REM 当前缺少统一的 LLM 测试替身（test double）。Core 测试依赖手工编写的 `registerProvider('mock', ...)` 或 `vi.mock('openai'/'@anthropic-ai/sdk')`，Bridge 测试则维护了一套独立的 `registerMockProvider` 辅助函数。这些方式重复、脆弱，且难以表达“多轮对话脚本”“token pacing”“tool-call streaming”等测试场景。

PI 的 `fauxProvider` 提供了一个优秀的参考模型：基于响应队列、可 pacing 的流式分块、可模拟 prompt cache、支持多 model 与工具调用。但 PI 的 faux provider 绑定在 PI 自有的 `Models` / `Context` / `AssistantMessage` 抽象上，与 REM 的 `LLMProvider` 接口（`generate` / `stream`）和 `StreamChunk` 类型不直接兼容。

**推荐方案**：不引入 `@earendil-works/pi-ai` 作为依赖，而是**在 REM 内部自研一个轻量的 `fauxProvider`**，直接实现 `LLMProvider` 接口。这样：

- 零额外依赖，不违背 Core“不依赖 Vercel AI SDK、自建 Provider 层”的架构红线；
- 与 REM 的 `GenerateOptions` / `StreamChunk` / `GenerateResult` 类型天然对齐；
- 可被 `reason()`、`generate()`、`InferenceEngine`、Bridge `AgentService` 直接复用，无需数据转换层；
- 保留 PI 的核心能力：响应队列、stream pacing、多 model、缓存模拟、tool-call streaming。

下一步：先在 `packages/core/src/llm/providers/faux.ts` 实现最小 faux provider，随后迁移 `engine.test.ts`、`reason.test.ts` 和 `bridge/tests/agent-service/shared.ts` 到 faux provider，逐步淘汰手工 mock provider。

---

## 2. REM 当前测试对 LLM 依赖的处理方式

### 2.1 Core 单元测试：手工 mock provider 或 SDK mock

- `packages/core/tests/llm/engine.test.ts`：每用例通过 `registerProvider('mock', { generate, stream })` 注册一次性 provider，用内联 async generator 返回 `StreamChunk`。
- `packages/core/tests/llm/providers/openai.test.ts` / `anthropic.test.ts`：使用 `vi.mock('openai')` / `vi.mock('@anthropic-ai/sdk')` mock SDK 返回值，验证 provider 对 SDK 响应的解析与转换。
- `packages/core/tests/reason/reason.test.ts`：用 `vi.spyOn(apiRegistry, 'resolveProvider').mockReturnValue(mockProvider)` 直接替换 `reason()` 内部解析的 provider。
- `packages/core/tests/llm/api-registry.test.ts`：仅测试注册表本身，使用最简单的 `LLMProvider` 占位对象。

共同点：没有共享的 LLM 测试替身；每次测试都要重复构造 `generate`/`stream` 函数，且无法表达“按顺序出队多轮响应”。

### 2.2 Bridge 服务测试：本地辅助函数 `registerMockProvider`

`packages/bridge/tests/agent-service/shared.ts` 中定义了：

```typescript
export interface MockProviderConfig {
  name: string;
  stream?: () => AsyncGenerator<StreamChunk>;
  generate?: () => Promise<GenerateResult>;
}

export function registerMockProvider(config: MockProviderConfig): void { ... }
```

每个 Bridge 测试用例传入 `provider: { name: 'mock-run-immediate', stream: simpleTextStream }`，由 `createTestService` 注册并用于 `AgentService`。这已经是“provider 级”mock，但仍是手写 async generator，没有队列、pacing、cache、多 model 等能力。

### 2.3 真实 API 调用

在现有测试代码中未发现直接调用 OpenAI / Anthropic 真实 API 的测试。所有 LLM 交互均通过 mock 或内联 generator 拦截。

---

## 3. PI `fauxProvider` 的能力分析

### 3.1 核心文件

- `packages/ai/src/providers/faux.ts`：`fauxProvider()`、`createFauxCore()`、内容块辅助函数。
- `packages/ai/src/compat.ts`：`registerFauxProvider()` 将 faux API 注册到 PI 的 API registry（旧版全局入口）。
- `packages/ai/README.md` “Faux Provider for Tests” 章节：使用示例。
- `packages/ai/test/faux-provider.test.ts`：最完整的使用示例。
- `packages/ai/test/providers.test.ts`：与 `createModels()` 集成的示例。
- `packages/ai/test/retry.test.ts`：使用 `fauxAssistantMessage` 作为结构化错误消息构造器。

### 3.2 能力清单

| 能力 | 实现要点 | 对 REM 的启示 |
|---|---|---|
| **脚本化响应队列** | `pendingResponses` 数组，`setResponses()` / `appendResponses()` 入队，请求开始时 `shift()` 消费。 | 非常适合 REM 的多轮 ReAct 循环测试：可预先写好 assistant → tool → assistant 的脚本。 |
| **token pacing** | `tokensPerSecond` 选项，将文本按 `tokenSize` 随机切分后，用 `setTimeout` 模拟真实流速。 | 可测试 abort 中流、UI 渲染顺序、背压等。 |
| **多 model** | `models: FauxModelDefinition[]` 可定义多个 faux model，`getModel(id)` 返回指定 model。 | 便于测试模型切换、reasoning 开关、context window 边界。 |
| **cache 模拟** | 以 `sessionId` 为 key 缓存序列化 prompt；按 `cacheRetention` 计算 `cacheRead` / `cacheWrite` token。 | 对 REM 的 token-usage 测试、预算测试有直接帮助。 |
| **tool-call streaming** | 工具参数 JSON 同样被分块，发出 `toolcall_start` / `toolcall_delta` / `toolcall_end` 事件。 | REM 当前 `StreamChunk` 没有 `tool-call-delta` 类型，但可用完整 `tool-call` 块模拟；若需要渐进式参数，可扩展类型。 |
| **错误/中断模拟** | `stopReason: 'error'` / `'aborted'` 时发出 terminal error；`AbortSignal` 会在 pacing 间隙检查。 | 可覆盖 REM 的 error handler 与 retry 路径。 |
| **调用计数** | `state.callCount` 统计被调用次数。 | 便于断言循环次数、去重逻辑。 |

---

## 4. 推荐：自研 REM 风格的 `fauxProvider`

### 4.1 不复用 `pi-ai` 的原因

1. **类型体系不匹配**：PI 使用 `Context` / `AssistantMessage` / `Model<Api>` / `AssistantMessageEventStream`；REM 使用 `GenerateOptions` / `GenerateResult` / `StreamChunk` / `LLMProvider`。复用 PI 需要额外封装层，反而增加复杂度。
2. **依赖过重**：`@earendil-works/pi-ai` 依赖 OpenAI、Anthropic、Google、AWS Bedrock 等 SDK，与 REM Core“不依赖 Vercel AI SDK，直接调用 provider SDK”的设计目标冲突，也会显著增加测试/构建体积。
3. **抽象层级不同**：PI 的 `fauxProvider` 面向 `Models` 集合；REM 的注册表是 `LLMProvider` 名称→对象映射。自研实现可直接挂在 REM 注册表上。
4. **可控性**：自研可按 REM 需求裁剪，只保留必要能力，避免引入 PI 的 sideEffects 与全局注册行为。

### 4.2 最小 faux provider 接口设计

建议新增 `packages/core/src/llm/providers/faux.ts`：

```typescript
import type { LLMProvider } from '../api-registry.js';
import type { GenerateOptions, GenerateResult, StreamChunk, ToolSet } from '../types.js';

export interface FauxModelDefinition {
  id: string;
  reasoning?: boolean;
}

export interface FauxToolCall {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface FauxText     { type: 'text'; text: string }
export interface FauxReasoning  { type: 'reasoning'; text: string }

export type FauxContentBlock = FauxText | FauxReasoning | FauxToolCall;

export interface FauxAssistantMessageOptions {
  finishReason?: string;
  errorMessage?: string;
}

export function fauxText(text: string): FauxText;
export function fauxReasoning(text: string): FauxReasoning;
export function fauxToolCall(toolName: string, input: unknown, opts?: { toolCallId?: string }): FauxToolCall;
export function fauxAssistantMessage(
  content: string | FauxContentBlock | FauxContentBlock[],
  opts?: FauxAssistantMessageOptions,
): GenerateResult;

export type FauxResponseFactory = (
  options: GenerateOptions,
  state: { callCount: number },
) => GenerateResult | Promise<GenerateResult>;

export type FauxResponseStep = GenerateResult | FauxResponseFactory;

export interface FauxProviderOptions {
  providerId?: string;
  model?: string;
  models?: FauxModelDefinition[];
  tokensPerSecond?: number;     // 0 或不传表示立即输出（queueMicrotask）
  tokenSize?: { min?: number; max?: number };
}

export interface FauxProviderHandle {
  provider: LLMProvider;
  getModel(): string;
  getModel(id: string): string | undefined;
  state: { callCount: number };
  setResponses(steps: FauxResponseStep[]): void;
  appendResponses(steps: FauxResponseStep[]): void;
  getPendingResponseCount(): number;
}

export function fauxProvider(options?: FauxProviderOptions): FauxProviderHandle;
```

### 4.3 实现要点

1. **队列消费**：
   - `generate()` 与 `stream()` 共用 `pendingResponses` 队列。
   - 如果队列为空，返回 `GenerateResult`：`text: ''`，`toolCalls: []`，`finishReason: 'error'`，`errorMessage: 'No more faux responses queued'`。
   - 支持响应工厂函数，可基于 `options.messages`、`state.callCount` 动态生成。

2. **流式分块**：
   - 文本与 reasoning 字符串按 `tokenSize` 切分（默认每块 3–5 个“token”，1 token ≈ 4 字符），每个 chunk 通过 `queueMicrotask` 或 `setTimeout` 发出。
   - 工具调用参数 JSON 可同样切分后发出；REM 当前 `StreamChunk` 的 `tool-call` 类型为完整对象，因此最小实现可在全部参数就绪后发出一次 `tool-call` chunk。
   - 流结束后发出 `usage` 和 `finish` chunk。

3. **token / cache 估算**：
   - 简单估算：`tokenCount = Math.ceil(charLength / 4)`。
   - 将 `system` + `messages` 序列化后计算 prompt tokens；输出按文本+reasoning+工具参数 JSON 计算。
   - 若 `GenerateOptions` 增加 `sessionId?: string` 和 `cacheRetention?: 'none' | 'short' | 'long'`，则按 `sessionId` 缓存上一次 prompt，计算 `cacheReadTokens` / `cacheWriteTokens`。这可直接用于 REM 的 token-usage 与 budget 测试。

4. **多 model**：
   - `options.model` 匹配 `models` 中的定义；不匹配时回退到默认 `faux-1`。
   - 可让 `reasoning` 字段影响是否将 `<think>` 块当作 `reasoning` 类型发出（REM 的 `InferenceEngine` 会自动处理）。

5. **错误与中断**：
   - 若 `AbortSignal` 已触发，在第一个 chunk 前直接抛出 / 发出 `error` chunk。
   - 在 pacing 的每个间隙检查 `signal.aborted`，模拟真实中断。

### 4.4 在 `LLMProvider` 注册表或 `reason()` 中接入

由于 `reason()` 和 `generate()` 内部都调用 `resolveProvider(params.provider)`，faux provider 只需注册到注册表即可，无需改动 `reason()` 逻辑：

```typescript
import { registerProvider, clearProviders } from 'rem-agent-core';
import { fauxProvider, fauxText, fauxToolCall, fauxAssistantMessage } from 'rem-agent-core/llm/providers/faux';

beforeEach(() => {
  clearProviders();
  const faux = fauxProvider({ providerId: 'faux', model: 'faux-1' });
  registerProvider('faux', faux.provider);
  // 用例中设置响应队列
});

afterEach(() => clearProviders());
```

在 `AgentService` 测试中，创建服务时传入 `provider: 'faux'` 和 `model: 'faux-1'`：

```typescript
const service = new AgentService(
  { name: 'Test', provider: 'faux', model: 'faux-1', apiKey: 'fake', ... },
  workspaceRepo,
);
```

`buildAgentContext()` 中的 `registerBuiltInProviders()` 使用 `registerIfMissing`，因此只要测试先注册 `faux`，就不会被覆盖。

---

## 5. 变更清单

### 5.1 新增文件

| 文件 | 说明 |
|---|---|
| `packages/core/src/llm/providers/faux.ts` | REM 风格 faux provider 实现。 |
| `packages/core/tests/llm/providers/faux.test.ts` | 自身单元测试：队列、 pacing、cache、多 model、tool call、abort。 |
| `packages/core/tests/llm/faux-reason-integration.test.ts` | 用 faux provider 覆盖 `reason()` 的 usage 转发、text、tool call 路径。 |
| `packages/bridge/tests/llm/faux-provider.ts` | Bridge 层共享的 `createFauxBridgeProvider()` 辅助函数。 |
| `docs/pi-research/faux-provider-testing-adoption.md` | 本文档。 |

### 5.2 修改文件

| 文件 | 修改内容 |
|---|---|
| `packages/core/src/llm/types.ts` | 可选：在 `GenerateOptions` 上增加 `sessionId?: string` 和 `cacheRetention?: 'none' | 'short' | 'long'`，供 cache 模拟使用。 |
| `packages/core/src/llm/providers/index.ts` | **不**自动注册 faux provider（避免进入生产），但可 export 供测试使用。 |
| `packages/core/src/llm/providers/anthropic.ts` / `openai.ts` | 若增加了 `sessionId`/`cacheRetention`，需忽略或透传（建议忽略）。 |
| `packages/bridge/tests/agent-service/shared.ts` | 将 `registerMockProvider` 替换为基于 `fauxProvider` 的封装，保留原有 `MockProviderConfig` 接口以最小化测试改动。 |
| `packages/bridge/tests/agent-service/run.test.ts` | 把 `simpleTextStream` 等常量迁移到 faux provider 的响应队列写法。 |
| `packages/core/tests/llm/engine.test.ts` | 可逐步把 inline `registerProvider('mock', ...)` 替换为 `fauxProvider`，降低重复样板。 |

---

## 6. 迁移步骤

### 步骤 1：实现 Core 层 faux provider

1. 创建 `packages/core/src/llm/providers/faux.ts`。
2. 先实现无 pacing、无 cache 的最小版本：队列 + `generate`/`stream` + 完整 `tool-call` 块。
3. 跑通 `packages/core/tests/llm/providers/faux.test.ts`。

### 步骤 2：迁移 Core 测试

优先迁移以下测试，因为它们最依赖“构造 provider”：

- `packages/core/tests/llm/engine.test.ts`：用 faux 替代手工 mock provider，验证 `InferenceEngine` 对 text/reasoning/usage 的处理。
- `packages/core/tests/reason/reason.test.ts`：用 faux 替代 `vi.spyOn(resolveProvider)`，断言 `reason()` 的 `emit` 映射。
- `packages/core/tests/run-agent.test.ts`：可保留对 loopStrategy 的 mock，或进一步用 faux provider 做端到端单轮测试。

### 步骤 3：迁移 Bridge 测试

1. 在 `packages/bridge/tests/llm/faux-provider.ts` 中封装 `createBridgeFauxProvider(config)`，让 Bridge 测试继续用 `{ name, stream, generate }` 风格配置，但内部使用 faux。
2. 替换 `packages/bridge/tests/agent-service/shared.ts` 中的 `registerMockProvider`。
3. 跑通 `run.test.ts`、`stream.test.ts`、`session.test.ts` 等。

### 步骤 4：可选增强

- 在 `GenerateOptions` 增加 `sessionId`/`cacheRetention`，实现 cache 模拟。
- 若需要测试“部分 tool-call 参数”，扩展 `StreamChunk` 增加 `tool-call-delta` 类型，并同步修改 `StreamCollector`。

### 示例 1：Core `reason()` 测试用例

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { clearProviders, registerProvider } from '../../src/llm/api-registry.js';
import { fauxProvider, fauxText, fauxToolCall, fauxAssistantMessage } from '../../src/llm/providers/faux.js';
import { reason } from '../../src/reason/reason.js';

describe('reason with faux provider', () => {
  let faux: ReturnType<typeof fauxProvider>;

  beforeEach(() => {
    clearProviders();
    faux = fauxProvider({ providerId: 'faux', model: 'faux-1' });
    registerProvider('faux', faux.provider);
  });

  afterEach(() => clearProviders());

  it('returns scripted text and tool call', async () => {
    faux.setResponses([
      fauxAssistantMessage(
        [fauxText('I will call echo'), fauxToolCall('echo', { text: 'hi' })],
        { finishReason: 'tool_calls' },
      ),
    ]);

    const emitted: any[] = [];
    const result = await reason(
      { provider: 'faux', model: 'faux-1', apiKey: 'fake', system: 'sys', messages: [] },
      (chunk) => emitted.push(chunk),
    );

    expect(result.text).toBe('I will call echo');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].toolName).toBe('echo');
    expect(result.finishReason).toBe('tool_calls');
    expect(emitted.some((c) => c.type === 'tool-call')).toBe(true);
    expect(result.usage.totalTokens).toBeGreaterThan(0);
  });
});
```

### 示例 2：Bridge `AgentService` 测试用例

```typescript
import { describe, it, expect } from 'vitest';
import { createTestService, DEFAULT_WORKSPACE } from './agent-service/shared.js';
import { fauxProvider, fauxText, fauxAssistantMessage } from 'rem-agent-core/llm/providers/faux';
import { registerProvider } from 'rem-agent-core';

describe('AgentService.run with faux provider', { timeout: 20000 }, () => {
  it('streams a scripted assistant reply', async () => {
    const faux = fauxProvider();
    faux.setResponses([fauxAssistantMessage([fauxText('Hello from faux')])]);
    registerProvider('faux-bridge', faux.provider);

    const { service, cleanup } = await createTestService({
      provider: { name: 'faux-bridge' },
      agentOptions: { provider: 'faux-bridge', model: 'faux-1', apiKey: 'fake' },
    });

    try {
      const summary = await service.createSession(DEFAULT_WORKSPACE);
      await service.run(DEFAULT_WORKSPACE, summary.sessionId, 'hi');
      // 通过 bus 或 getMessages 断言输出包含 'Hello from faux'
    } finally {
      await cleanup();
    }
  });
});
```

---

## 7. 风险与注意事项

| 风险 | 说明 | 缓解措施 |
|---|---|---|
| **异步 pacing 导致测试不稳定** | 开启 `tokensPerSecond` 后，流式输出依赖 `setTimeout`，可能因 CI 负载导致超时或 flake。 | 默认关闭 pacing（`tokensPerSecond` 未设置时使用 `queueMicrotask`），需要测试 pacing 的场景再显式开启。 |
| **全局注册表状态泄漏** | `registerProvider` 是全局 `Map`，若测试未 `clearProviders()`，会影响后续测试。 | 所有使用 faux provider 的测试文件在 `beforeEach`/`afterEach` 中调用 `clearProviders()`；Bridge 的 `shared.ts` 已包含 `afterEach(clearProviders)`。 |
| **错误地进入生产代码** | 若 faux provider 被 `registerBuiltInProviders()` 自动注册，会导致生产环境使用假 LLM。 | 不将 faux provider 加入 `registerBuiltInProviders()`；只通过 `export` 暴露给测试和 demo。 |
| **与 SDK mock 测试的职责冲突** | `openai.test.ts` / `anthropic.test.ts` 测试的是 provider 对 SDK 响应的解析，不应被 faux provider 替代。 | faux provider 用于 Core/Bridge 上层逻辑测试；provider-specific 解析测试继续保留 SDK mock。 |
| **`GenerateOptions` 类型扩展的连锁影响** | 若增加 `sessionId`/`cacheRetention`，所有 `LLMProvider` 实现都需忽略或透传。 | 先用可选字段加 `// @ts-ignore` 内部读取，待验证后再正式化；或第一期不实现 cache 模拟。 |
| **工具调用流与 REM `StreamChunk` 不完全对齐** | REM 当前 `StreamChunk` 没有 `tool-call-delta` 类型，无法直接复刻 PI 的部分参数流。 | 最小版本按完整 `tool-call` 块发出；如需渐进式参数，再扩展 `StreamChunk` 和 `StreamCollector`。 |
| **`buildAgentContext` 的 provider 回退** | 当 `provider` 选项未指定时，`DefaultConfigProvider` 可能默认 `openai`；测试中需显式设置 `provider: 'faux'`。 | 在 `createTestService` 和 core 测试 setup 中明确传入 faux provider 配置。 |

---

## 8. 结论

PI 的 `fauxProvider` 为 REM 提供了优秀的测试基础设施蓝本，但直接复用会带来抽象与依赖成本。推荐在 REM 内部实现一个**与 `LLMProvider` 接口直接兼容的轻量 faux provider**，优先在 Core 的 `engine` / `reason` / `run-agent` 测试和 Bridge 的 `AgentService` 测试中落地，逐步统一测试替身，同时保留 SDK mock 测试用于 provider 解析层。
