# REM 项目是否采用 `@earendil-works/pi-ai` 作为 LLM Provider 层调研报告

> 撰写日期：2026-07-15  
> 调研范围：REM `packages/core` 的 LLM/Reason 层 + `@earendil-works/pi-ai` 核心实现与 README  
> 结论：**推荐切换，但必须分阶段落地**。pi-ai 在 provider 覆盖、流式工具调用、cost 追踪、auth、模型元数据、跨 provider handoff 等方面显著优于 REM 当前自研实现，且与 REM 两条核心红线不冲突。唯一风险是它不是“drop-in”替换，需要一层薄的 adapter 与 message 格式 reconcile。

---

## 1. 执行摘要

### 1.1 结论

**推荐在 REM Core 中引入 `@earendil-works/pi-ai`（以下简称 pi-ai），并作为后续 LLM 层的默认实现。** 当前自研的 OpenAI/Anthropic adapter 只覆盖两家基础 Chat/Completions 能力，缺少：

- 20+ 家 provider 的一站式支持；
- 工具调用 argument 的**流式增量解析**；
- 内置 **cost 计算**（$/million tokens）与缓存读写拆分；
- 统一的 **OAuth / stored credential / 环境变量** auth 体系；
- 跨 provider 的 conversation handoff（thinking 块、tool call、tool result 自动转换）；
- 模型元数据（contextWindow、maxTokens、reasoning、vision、cost tiers）。

pi-ai 自身是一个**不依赖 Vercel AI SDK** 的独立 LLM 抽象层，与 REM 的“Core 不依赖 Vercel AI SDK”红线兼容。它也不是“由客户端读取 API Key”的封装，REM 可以继续在 Core 内部解析配置后，把 `apiKey`/`baseURL` 显式传给 pi-ai，从而保留“Provider 配置由 Core 拥有”的红线。

### 1.2 推荐策略

- **短期（MVP）**：在 Core 内部新建 `packages/core/src/llm/pi/` 模块，封装一个 `PiLlmProvider` 实现现有 `LLMProvider` 接口。先只接 `openai`、`anthropic` 两家，保持现有 `StreamChunk` / `GenerateResult` 协议不变。
- **中期**：用 pi-ai 的模型元数据替换 `context-window.ts`；把 `reason.ts` 的 retry 逻辑与 pi-ai 的 `maxRetries` 对齐；暴露 `cost` 到 `LanguageModelUsage`。
- **长期**：评估是否将 REM 内部消息格式从 `ModelMessage` 迁移到 pi-ai 的 `Message`，以彻底启用跨 provider handoff 与 reasoning-signature 连续性。

---

## 2. REM 当前 LLM 层现状与能力边界

### 2.1 核心文件与职责

| 文件 | 职责 |
|------|------|
| `packages/core/src/llm/types.ts` | 定义 `ToolSchema`、`ProviderConfig`、`GenerateOptions`、`GenerateResult`、`StreamChunk` |
| `packages/core/src/llm/api-registry.ts` | provider 注册表，提供 `registerProvider` / `resolveProvider` / `resolveProviderConfig` |
| `packages/core/src/llm/engine.ts` | `InferenceEngine.infer()` 把流式 `StreamChunk` 聚合成 `GenerateResult` |
| `packages/core/src/llm/stream-collector.ts` | 按 chunk 类型聚合 text/reasoning/tool-call/usage/finish |
| `packages/core/src/llm/partition-stream.ts` | 基于 `<thinking>` 标签把 text 分区为 reasoning/text |
| `packages/core/src/llm/providers/openai.ts` | OpenAI Chat Completions 非流/流实现 |
| `packages/core/src/llm/providers/anthropic.ts` | Anthropic Messages 非流/流实现 |
| `packages/core/src/llm/providers/openai-adapter.ts` | OpenAI message/tool/usage 转换与流式解析 |
| `packages/core/src/llm/providers/anthropic-adapter.ts` | Anthropic message/tool/usage 转换与流式解析 |
| `packages/core/src/reason/reason.ts` | 对 registry 取 provider，调用 `generate`/`stream`， retry 3 次 |
| `packages/core/src/run-agent.ts` | 组装 system/messages/tools，调用 `reason()`，处理 usage/事件 |
| `packages/core/src/config/paths.ts` | 路径配置，不涉及 provider/model |
| `packages/core/src/llm/context-window.ts` | 手写 contextWindow 常量表（OpenAI/Anthropic 各几个模型） |

### 2.2 当前能力边界

1. **Provider 数量**：仅 `openai`、`anthropic`。
2. **API 形态**：OpenAI 走 **Chat Completions**（非 Responses API），Anthropic 走 Messages。
3. **流式协议**：REM 自定义 `StreamChunk` 类型，包括 `text`、`reasoning`、`tool-call`、`usage`、`finish`。没有“tool-call 开始/结束”事件，也不支持 argument 的增量解析。
4. **工具调用**：OpenAI 在 `finish_reason === 'tool_calls'` 时才一次性吐出完整 tool call；Anthropic 在 `content_block_start` 就给出完整 input（input 不大的场景）。不支持流式 JSON 累加。
5. **Cost 跟踪**：没有 cost 字段，只有 input/output token 数及缓存拆分。
6. **Auth 解析**：由 `DefaultConfigProvider.resolveApiKey()` 读取 `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`，或由 config 显式指定。无 OAuth、无 credential store、无多环境变量合并。
7. **跨 provider handoff**：无。REM 内部消息格式是 `ModelMessage`，历史消息在跨 provider 时需要手写转换。
8. **错误处理**：`reason.ts` 在 Core 层做 3 次 retry；底层 provider 直接抛出 SDK 错误。
9. **模型元数据**：`context-window.ts` 手写静态表，只有 `maxTokens`；没有 reasoning、vision、cost 信息。

---

## 3. pi-ai 相比 REM 当前实现的核心能力差距

下面按“能力维度”而非“provider 数量”逐项对比。

### 3.1 流式事件体系

- **REM**：`StreamChunk` 只有 5 种事件；没有 `start/end` 边界，UI 层需要自己根据相邻 chunk 推断 text/tool 块的开始和结束。
- **pi-ai**：`AssistantMessageEvent` 有 `start` / `text_start` / `text_delta` / `text_end` / `thinking_start` / `thinking_delta` / `thinking_end` / `toolcall_start` / `toolcall_delta` / `toolcall_end` / `done` / `error`，并带 `contentIndex` 和 `partial` 状态。UI 可以精确知道每个 content block 的生命周期。

**迁移意义**：即使 REM 保持现有 `StreamChunk` 协议，adapter 也可以利用 `text_start/end` 更准确地生成 text/reasoning/tool-call chunk；未来升级 AgentStream 事件协议时可直接复用 pi-ai 语义。

### 3.2 流式工具调用解析

- **REM**：OpenAI 必须等到 `finish_reason === 'tool_calls'` 才把 pending tool call 一次性 yield；Anthropic 在 `content_block_start` 给出完整 input。两者都不支持 argument 的增量解析。
- **pi-ai**：OpenAI 与 Anthropic 均支持 `toolcall_delta`，在 `partial.content[contentIndex].arguments` 中提供**已经 partial-parse 的 JSON 对象**。README 明确说明 Google 不支持 function call streaming，会一次性返回完整 arguments。

**迁移意义**：未来如果需要“文件路径一出现就高亮”或“参数未写完时禁用执行按钮”，pi-ai 可以直接提供这种能力；REM 当前实现需要重写 parser。

### 3.3 Cost 跟踪

- **REM**：`LanguageModelUsage` 只有 `inputTokens`/`outputTokens`/`totalTokens` 和缓存拆分。
- **pi-ai**：`Usage` 自带 `cost: { input, output, cacheRead, cacheWrite, total }`，单位 USD。`calculateCost(model, usage)` 还会处理 cost tiers（输入量超过阈值后切换价格档位）和 Anthropic 1h cache write 的 2x 计费。

**迁移意义**：可以在 budget 模块中直接按金额而非 token 数做预算控制；也能把 `cost` 字段透传给 UI/事件总线。

### 3.4 Auth 解析

- **REM**：`DefaultConfigProvider.resolveApiKey()` 只处理单一环境变量或 config 中显式 key；`openai.ts` 的 `resolveConfig` 也仅读 `OPENAI_API_KEY`/`OPENAI_BASE_URL`/`OPENAI_MODEL`。
- **pi-ai**：每个 provider 自带 `ProviderAuth`；`envApiKeyAuth()` 支持多环境变量、stored credential 优先；`CredentialStore` 接口支持持久化；`OAuthAuth` 支持 Anthropic / OpenAI Codex / GitHub Copilot 的 OAuth 登录与自动刷新（带锁，避免并发重复刷新）。`getAuth(model)` 可返回配置来源标签（如 `"ANTHROPIC_API_KEY"`、`"OAuth"`）。

**迁移意义**：REM 可以统一接入多 key 来源、OAuth 模型、Azure OpenAI、Vertex ADC、Bedrock 环境凭证等，无需在 Core 手写每家的 auth 逻辑。

> 注意：为遵守“Provider 配置由 Core 拥有”，REM 仍应在 Core 侧决定使用哪家 provider/model/key，再显式传给 pi-ai；pi-ai 的 auth 机制可作为兜底或扩展（OAuth / credential store）。

### 3.5 跨 Provider Handoff

- **REM**：无跨 provider 支持。历史消息是 `ModelMessage`，跨 provider 时没有自动转换；如果未来需要切换模型，需要自己处理 thinking 块、tool call ID、图片等差异。
- **pi-ai**：`transformMessages()` 自动处理：
  - 同 provider / 同 API 的 assistant message 原样保留；
  - 跨 provider 的 thinking 块根据 `isSameModel` 决定保留或降级为 `text`；
  - 工具调用 ID 按目标 provider 规范归一化（Anthropic 限 64 字符，OpenAI 限 40 字符等）；
  - 不支持的图片自动降级为占位文本；
  - 为 orphan tool call 合成 tool result。

**迁移意义**：这是 pi-ai 的杀手级能力。如果 REM 想要“先用轻量模型快速思考，再切到强模型执行”，pi-ai 提供现成基础设施。但前提是 REM 的历史消息格式需要能被 pi-ai 消费；详见第 7 章风险。

### 3.6 错误处理与 Abort

- **REM**：底层 SDK 抛异常，Core 层 `reason.ts` retry 3 次。Abort 通过 `signal` 传递给 SDK，异常会被 catch 并抛出。
- **pi-ai**：所有错误都编码进流，以 `error` 事件终止，最终 `AssistantMessage.stopReason` 为 `"error"` 或 `"aborted"`。`errorMessage` 包含格式化后的 provider 错误。`signal` 触发后返回 `stopReason: "aborted"`，并保留 partial content。支持 `onPayload` / `onResponse` 调试回调。

**迁移意义**：adapter 需要在 final `AssistantMessage` 上判断 `stopReason`，把 `"error"`/`"aborted"` 重新抛出为 Error，才能让 REM 现有 error handler 与 retry 逻辑继续工作。

### 3.7 模型元数据

- **REM**：`context-window.ts` 手写 `provider:model -> maxTokens` 映射；无 cost、reasoning、vision 信息。
- **pi-ai**：每个 `Model` 包含 `contextWindow`、`maxTokens`、`reasoning`、`thinkingLevelMap`、`input`（text/image）、`cost`（含 tiers）、`compat`（provider-specific 兼容性覆盖）。`Models.getModels()` 返回完整列表，可动态刷新。

**迁移意义**：可以删除 `context-window.ts`，改为 `models.getModel(provider, modelId).contextWindow`；模型选择/压缩阈值可基于真实元数据。

### 3.8 其他能力

| 能力 | REM | pi-ai |
|------|-----|-------|
| 图片输入 | 当前未实现（adapter 只取 text） | 原生支持，自动降级给非 vision 模型 |
| 图片生成 | 无 | `ImagesModels` + `generateImages` |
| reasoning 控制 | 靠 `<thinking>` 标签分区 | 统一 `reasoning: 'minimal'...'max'`，provider-specific 映射 |
| 缓存控制 | 靠 SDK 默认 | `cacheRetention: 'none'/'short'/'long'`， Anthropic/ OpenAI 缓存语义统一 |
| 假 provider 测试 | 无 | `fauxProvider()` 支持 scripted 响应、可控速度、排队 |
| 结构化输出（JSON Schema） | 通过 `responseFormat` 直接透传给 OpenAI Chat Completions | OpenAI Responses API 有 `text.format` 但当前 pi-ai `openai-responses` 未暴露 `responseFormat` 字段；需要走 `openai-completions` 自定义 provider 或自行扩展 |
| 工具 schema 验证 | 无（REM 只要求 JSON Schema） | `validateToolCall()` 基于 TypeBox |

---

## 4. 切换为 pi-ai 的直接收益

1. **维护成本下降**：删除 `openai-adapter.ts`、`anthropic-adapter.ts` 中大量手动 chunk 解析与 thinking 标签分区逻辑。
2. **新 provider 接入成本从“周”降到“小时”**：只要 pi-ai 支持该 provider，REM 只需在 config 里新增 provider/model；无需写 adapter。
3. **功能增强**：
   - 实时流式 tool argument 解析；
   - cost/预算控制；
   - 图片输入与 tool result 图片；
   - 跨 provider handoff；
   - OAuth 登录模型（Copilot、Anthropic Pro/Max 等）。
4. **测试基础设施**：`fauxProvider()` 让 Core 测试可以不依赖真实 API Key 就能验证流式工具调用、reasoning、abort 路径。
5. **模型元数据统一**：压缩、上下文窗口、模型选择可基于 pi-ai 的 catalog，而不是手写常量。

---

## 5. 切换所需变更清单（按模块分组）

### 5.1 包管理

| 文件 | 变更 |
|------|------|
| `packages/core/package.json` | `dependencies` 新增 `@earendil-works/pi-ai`；注意处理依赖冲突（见第 8 章） |
| `pnpm-workspace.yaml` | 无需改动（pi-ai 是外部 npm 包） |

### 5.2 新增模块（推荐放在 `packages/core/src/llm/pi/`）

| 新增文件 | 职责 |
|----------|------|
| `packages/core/src/llm/pi/index.ts` | 公开 `createPiLlmProvider()` / `createPiModels()` |
| `packages/core/src/llm/pi/pi-llm-provider.ts` | 实现 `LLMProvider` 接口，内部持有 `Models` 集合 |
| `packages/core/src/llm/pi/convert-rem-to-pi.ts` | 把 `ModelMessage[]`、`ToolSet`、`GenerateOptions` 转成 pi-ai `Context` / `Tool[]` / `Model` |
| `packages/core/src/llm/pi/convert-pi-to-rem.ts` | 把 pi-ai `AssistantMessage` / `AssistantMessageEvent` 转成 `GenerateResult` / `StreamChunk` |
| `packages/core/src/llm/pi/model-resolver.ts` | 基于 pi-ai catalog 解析 `provider:model`，支持 baseURL 覆盖、上下文窗口查询 |

### 5.3 修改现有模块

| 文件 | 修改内容 |
|------|----------|
| `packages/core/src/llm/providers/index.ts` | 在 `registerBuiltInProviders()` 中新增 pi-ai 版 openai/anthropic 注册；保留旧实现作为 fallback（可用 env flag 切换） |
| `packages/core/src/llm/providers/openai.ts` | 可选：改为 `pi-llm-provider` 的 openai 实例；或保留旧文件，仅在新 provider id（如 `pi-openai`）下注册 |
| `packages/core/src/llm/providers/anthropic.ts` | 同上 |
| `packages/core/src/llm/context-window.ts` | 逐步替换：新增 `resolveContextWindowFromPiModel()`，最终删除旧静态表 |
| `packages/core/src/reason/reason.ts` | 保持调用 `resolveProvider` 与 `InferenceEngine` 不变；确保 `generate()` 的 `responseFormat` 在 adapter 中正确处理 |
| `packages/core/src/run-agent.ts` | 无需直接改动，但需验证 pi-ai 生成的 `usage` 与 `LanguageModelUsage` 兼容；若需要暴露 `cost` 则扩展 `LanguageModelUsage` 与 `ProviderChunk` |
| `packages/core/src/token-usage.ts` | 可选：在 `addUsage` 中增加 `cost` 字段累计 |
| `packages/core/src/types.ts` | 可选：在 `LanguageModelUsage` 增加 `cost?: {...}` |

### 5.4 测试

| 新增/修改 | 内容 |
|-----------|------|
| `packages/core/tests/llm/pi-llm-provider.test.ts` | 使用 `fauxProvider()` 或 mock 环境变量，测试 text/reasoning/tool-call/usage/error 转换 |
| `packages/core/tests/llm/pi-message-converter.test.ts` | 测试 `ModelMessage` -> pi-ai `Message` -> `ModelMessage` 的 round-trip |
| 现有 provider 测试 | 保留旧适配器测试，直到 pi-ai 路径稳定后删除 |

---

## 6. 推荐的迁移步骤（含 MVP 方案）

### 6.1 第一步：建立依赖与隔离层

1. 在 `packages/core/package.json` 增加：

   ```json
   "dependencies": {
     "@earendil-works/pi-ai": "^0.80.7"
   }
   ```

2. 在根目录 `package.json` 增加 `pnpm.overrides` 解决依赖冲突：

   ```json
   "pnpm": {
     "overrides": {
       "openai": "^6.42.0",
       "@anthropic-ai/sdk": "^0.104.1"
     }
   }
   ```

   > 这条需要验证 pi-ai 在更新后的 SDK 上行为不变；若测试失败，回滚到 pi-ai 自带版本或等待上游升级。

3. `pnpm install`。

### 6.2 第二步：实现最小可验证改动（MVP）

MVP 目标：**在 REM 现有 `LLMProvider` 接口下，用 pi-ai 驱动一次 OpenAI/Anthropic 的流式对话，并输出与现有实现一致的 `StreamChunk`。**

新增文件示例 `packages/core/src/llm/pi/pi-llm-provider.ts`：

```typescript
import { createModels, type Models, type Model, type Context, type Tool, type AssistantMessageEvent } from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import type { LLMProvider } from '../api-registry.js';
import type { GenerateOptions, GenerateResult, StreamChunk, ProviderConfig } from '../types.js';
import { convertRemMessagesToPi, convertRemToolsToPi, findPiModel } from './convert-rem-to-pi.js';
import { piEventToStreamChunks, piMessageToGenerateResult } from './convert-pi-to-rem.js';

export class PiLlmProvider implements LLMProvider {
  private models: Models;

  constructor() {
    this.models = createModels();
    this.models.setProvider(openaiProvider());
    this.models.setProvider(anthropicProvider());
  }

  resolveConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
    // 仍由 Core 读取环境变量，保留红线
    return {
      apiKey: env.OPENAI_API_KEY ?? '',
      baseURL: env.OPENAI_BASE_URL,
      model: env.OPENAI_MODEL ?? 'gpt-4o',
    };
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const { model, context } = this.buildPiRequest(options);
    const result = await this.models.complete(model, context, {
      apiKey: options.apiKey,
      signal: options.signal,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    });
    if (result.stopReason === 'error' || result.stopReason === 'aborted') {
      throw new Error(result.errorMessage ?? `LLM stopped: ${result.stopReason}`);
    }
    return piMessageToGenerateResult(result);
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const { model, context } = this.buildPiRequest(options);
    const s = this.models.stream(model, context, {
      apiKey: options.apiKey,
      signal: options.signal,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    });

    for await (const event of s) {
      yield* piEventToStreamChunks(event);
    }

    const final = await s.result();
    if (final.stopReason === 'error' || final.stopReason === 'aborted') {
      throw new Error(final.errorMessage ?? `LLM stopped: ${final.stopReason}`);
    }
    yield { type: 'finish', reason: final.stopReason ?? 'stop' };
  }

  private buildPiRequest(options: GenerateOptions): { model: Model; context: Context } {
    const model = findPiModel(this.models, options.provider ?? 'openai', options.model);
    const context: Context = {
      systemPrompt: options.system,
      messages: convertRemMessagesToPi(options.messages),
      tools: options.tools ? convertRemToolsToPi(options.tools) : undefined,
    };
    return { model, context };
  }
}
```

> 说明：上面的代码是示意，真实实现需要处理 `baseURL` 覆盖、`responseFormat`、reasoning 选项、model 找不到等边界。

4. 在 `packages/core/src/llm/providers/index.ts` 中新增：

   ```typescript
   import { PiLlmProvider } from '../pi/pi-llm-provider.js';

   export function registerBuiltInProviders(): void {
     if (process.env.REM_USE_PI_LLM === '1') {
       registerIfMissing('openai', new PiLlmProvider());
       registerIfMissing('anthropic', new PiLlmProvider());
     } else {
       registerIfMissing('openai', openaiProvider);
       registerIfMissing('anthropic', anthropicProvider);
     }
   }
   ```

5. 新增测试 `packages/core/tests/llm/pi-llm-provider.test.ts`，使用 `fauxProvider()` 或真实环境变量（如果 CI 有 key），断言：
   - text delta 能被 `InferenceEngine` 正常聚合；
   - tool call 在 `toolcall_end` 时转换为 `{type:'tool-call'}`；
   - `usage` 与 `LanguageModelUsage` 字段一致；
   - abort signal 能正确中断并抛错。

6. 运行：

   ```bash
   pnpm install
   REM_USE_PI_LLM=1 pnpm --filter rem-agent-core typecheck
   REM_USE_PI_LLM=1 pnpm --filter rem-agent-core test
   ```

### 6.3 第三步：迁移 Anthropic path

Anthropic 的 pi-ai API 与 REM 当前 Anthropic adapter 最为接近（都是 Messages API）。优先把 `anthropic` provider 切到 pi-ai，OpenAI 保持旧实现或同样切到 pi-ai。理由是 Anthropic 的 thinking 块、usage、tool call 在 pi-ai 中已完整支持，迁移风险最低。

### 6.4 第四步：功能扩展

1. 在 `convert-pi-to-rem.ts` 中把 `Usage.cost` 透传到 `LanguageModelUsage`（如果上层决定暴露）。
2. 用 `models.getModel(provider, model).contextWindow` 替换 `resolveContextWindow()`。
3. 在 `reason.ts` 中把 `errorHandler` 的 retry 与 pi-ai 的 `maxRetries` 统一：建议 REM 保持自己的 retry 逻辑，pi-ai 内部 `maxRetries` 设为 0，避免两层 retry 叠加。
4. 逐步把 `StreamChunk` 协议升级为 pi-ai 事件语义，使前端能利用 `contentIndex` 做多 content block 的 UI 渲染。

### 6.5 第五步：长期决策

评估是否将 REM 的 `ModelMessage` 内部格式替换为 pi-ai 的 `Message`。如果替换，则：

- 跨 provider handoff 自动生效；
- 需要重写 session provider 的序列化/反序列化；
- 需要把 `AgentStreamChunk` 与 pi-ai 事件对齐。

如果不替换，则需要每次调用 pi-ai 前做 `ModelMessage -> pi Message` 的转换，并损失部分 reasoning signature / redacted thinking 的连续性。

---

## 7. 与 REM 现有红线的兼容性分析

### 7.1 “Provider 配置由 Core 拥有”

- **不冲突**。pi-ai 的 `Models` 支持两种使用方式：
  1. 让 provider 自己解析环境变量 / credential store（`models.complete(model, context)` 不传 key）。
  2. 调用方显式传入 `apiKey`、`baseURL`、`env` 等（`options.apiKey` 优先级最高）。
- REM 的封装方式应采用**第 2 种**：`DefaultConfigProvider` 继续读取 `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` 或 config 文件中的 key，然后在 `PiLlmProvider` 中显式传给 pi-ai。
- 对于 OAuth 或 credential store 场景，Core 可以提供新的 `AuthProvider` 抽象，把 pi-ai 的 `CredentialStore` 包进来，但读取/写入入口仍由 Core 控制。

### 7.2 “Core 不依赖 Vercel AI SDK”

- **不冲突**。pi-ai 内部直接依赖 `openai`、`@anthropic-ai/sdk`、`@google/genai` 等 SDK，没有依赖 `ai` 包。REM 引入 pi-ai 不会违反这条红线。
- 需要注意：pi-ai 的 `typebox` 与 REM 使用的 `@sinclair/typebox` 是同名但不同 npm 包。如果 REM 未来想用 pi-ai 的 `validateToolCall`，需要把 tool schema 转成 pi-ai 的 TypeBox 格式；这一步可以在 adapter 中完成，不引入 `ai` 包。

---

## 8. 风险与注意事项

### 8.1 依赖版本冲突

pi-ai 的 `package.json` 固定了：

- `openai`: `6.26.0`
- `@anthropic-ai/sdk`: `0.91.1`
- `typebox`: `1.1.38`

REM 当前使用：

- `openai`: `^6.42.0`
- `@anthropic-ai/sdk`: `^0.104.1`
- `@sinclair/typebox`: `^0.27.0`

**风险**：pnpm 会同时安装两个版本的 `openai`/`@anthropic-ai/sdk`，导致类型/行为不一致。建议在根 `package.json` 加 `pnpm.overrides` 统一版本（见 6.1），然后跑完整测试。如果 pi-ai 在新 SDK 上有 break（尤其是 Anthropic 0.91 -> 0.104 类型差异较大），需要：

- 方案 A：回滚 overrides，让 pi-ai 使用自己的 pinned 版本，REM 在代码里隔离两套 SDK 的使用；
- 方案 B：给 pi-ai 提 issue/PR，或在 REM 本地 patch。

`typebox` 与 `@sinclair/typebox` 不会冲突，因为包名不同，但工具 schema 转换代码需要注意字段名一致性（`properties`/`required`）。

### 8.2 Node 版本

- pi-ai `engines.node` 要求 `>=22.19.0`。
- REM 使用 `@types/node ^20.0.0`、target ES2022。

**建议**：把 REM 的 Node 运行时也升级到 22.x（与 pi-ai 一致），否则可能在运行时遇到 `ReadableStream` 全局变量、fetch 行为、SDK 新版本等兼容问题。如果短期不能升级 Node，需要在一个隔离环境中先验证 pi-ai 在 Node 20 下是否正常运行。

### 8.3 类型系统

- pi-ai 广泛使用 `Model<TApi>`、 branded string (`Api | (string & {})`) 以及条件类型。REM 需要把 pi-ai 的 `Model` 当作运行时查询结果，避免在 Core 类型层面直接依赖具体 `TApi`。
- pi-ai 的 `Context.messages` 类型与 REM 的 `ModelMessage` 不同。adapter 层需要一次完整的类型转换，不能简单 `as`。
- `AssistantMessage.usage` 中 `input` 不包含 cache read/write，但 `totalTokens` 包含；REM 的 `LanguageModelUsage.inputTokens` 当前语义也是“非缓存输入”。映射时可直接对应：`input -> inputTokens`，`output -> outputTokens`，`cacheRead -> cacheReadTokens`，`cacheWrite -> cacheWriteTokens`，`totalTokens -> totalTokens`。

### 8.4 测试

- 现有测试依赖 mock provider 或环境变量。引入 pi-ai 后，建议用 `fauxProvider()` 重写流式测试，避免真实网络调用。
- 需要新增测试覆盖：
  - 不同 provider 的模型查找失败；
  - baseURL 覆盖；
  - thinking 块转换；
  - tool call argument 增量（即使当前不暴露，也要保证 adapter 不崩溃）；
  - abort 与 error 事件到 REM 异常的映射。

### 8.5 包管理器差异

- pi-ai 使用 `npm` 发布，自身构建脚本用 `tsgo`。REM 使用 pnpm workspace。直接引入不会破坏 workspace，但注意：
  - pi-ai 的 `sideEffects` 包括 `compat.js`、`images.js`，导入这些入口会触发副作用；REM 应避免使用 `compat` 入口，只用 `@earendil-works/pi-ai` 核心与 `providers/*` 子路径。
  - 如果启用 bundle，需遵循 pi-ai 的 tree-shaking 规则，只注册需要的 provider，避免把全部 SDK 打包进来。

### 8.6 结构化输出（responseFormat）

- REM 的 `GenerateOptions.responseFormat` 直接透传给 OpenAI Chat Completions。
- pi-ai 默认的 `openaiProvider()` 使用 **OpenAI Responses API**。当前 pi-ai 的 `OpenAIResponsesOptions` 没有暴露 `responseFormat` / `text.format` 字段，因此不能直接用默认 provider 实现 JSON Schema 输出。
- **应对措施**：
  - 方案 A：为 OpenAI 创建一个自定义 provider，使用 `openai-completions` API（与 REM 当前 Chat Completions 一致），直接透传 `responseFormat`；
  - 方案 B：修改 adapter，在需要结构化输出时fallback到旧 OpenAI Chat Completions 实现；
  - 方案 C：在 pi-ai 的 `OpenAIResponsesOptions` 中扩展 `text.format`（需要 fork 或 PR）。

这是 MVP 中必须验证的阻塞点之一。

### 8.7 OpenAI 默认 API 差异

- REM 当前用 OpenAI Chat Completions；pi-ai 默认用 OpenAI Responses API。两者在 system prompt 角色（`system` vs `developer`）、tool 格式、usage 字段、max_tokens 字段（`max_completion_tokens` vs `max_tokens`）上都有差异。
- 如果 REM 不想切换 API，可以在 pi-ai 中创建 `openai-completions` 自定义 provider，baseUrl 用 `https://api.openai.com/v1`，保持与当前行为一致。

---

## 9. 建议的封装接口：隔离 PI 细节的入口

为了既不把 pi-ai 的类型泄漏到 REM 上层，又能充分利用其能力，建议封装成以下接口：

### 9.1 对外入口

```typescript
// packages/core/src/llm/pi/index.ts
export interface CreatePiLlmProviderOptions {
  /** 注册哪些 provider。默认 ['openai', 'anthropic'] */
  providers?: PiProviderId[];
  /** 可选：注入持久化 credential store（用于 OAuth） */
  credentialStore?: CredentialStore;
}

export function createPiLlmProvider(options?: CreatePiLlmProviderOptions): LLMProvider;
```

### 9.2 内部模块划分

```text
packages/core/src/llm/pi/
  index.ts                 # 对外暴露 createPiLlmProvider
  pi-llm-provider.ts       # 实现 LLMProvider，持有 Models 集合
  model-resolver.ts        # provider+model -> pi-ai Model，处理 baseURL 覆盖
  convert-rem-to-pi.ts     # ModelMessage / ToolSet / GenerateOptions -> pi-ai Context / Tool / options
  convert-pi-to-rem.ts     # pi-ai AssistantMessage / event -> GenerateResult / StreamChunk
  usage-adapter.ts         # pi-ai Usage -> LanguageModelUsage（含 cost 可选）
  error-handler.ts         # pi-ai stopReason error/aborted -> Error 抛出
```

### 9.3 关键设计原则

1. **只把 pi-ai 关在 `llm/pi/` 目录里**。上层 `reason.ts`、`run-agent.ts`、`loop-strategy.ts` 继续操作 `LLMProvider` / `StreamChunk` / `GenerateResult`。
2. **Core 继续拥有配置**。`PiLlmProvider` 的 `resolveConfig` 仍由 Core 读取环境变量 / config 文件后返回；pi-ai 只作为“发送请求”的引擎。
3. **可切换**：通过 env flag（如 `REM_USE_PI_LLM`）让新旧实现并存，便于灰度。
4. **模型元数据提供扩展点**：在 `model-resolver.ts` 暴露 `resolveModelMetadata(provider, model)`，未来可替换 `context-window.ts`。
5. **错误不吞掉**：`generate` 和 `stream` 结束时必须检查 `AssistantMessage.stopReason`，把 `error` / `aborted` 转成异常，让 REM 的 retry/budget/abort 逻辑感知。

### 9.4 示例：切换 OpenAI 到 pi-ai 的 completions provider

如果 REM 想保留 Chat Completions 以继续支持 `responseFormat`，可以这样注册：

```typescript
import { createModels, createProvider, envApiKeyAuth } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { OPENAI_MODELS } from '@earendil-works/pi-ai/providers/openai.models';

const models = createModels();
models.setProvider(createProvider({
  id: 'openai',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  auth: { apiKey: envApiKeyAuth('OpenAI API key', ['OPENAI_API_KEY']) },
  models: Object.values(OPENAI_MODELS).map(m => ({ ...m, api: 'openai-completions' })),
  api: openAICompletionsApi(),
}));
```

这样 pi-ai 走 Chat Completions，`responseFormat` 可直接透传，`maxTokens` 字段也会使用 `max_tokens` 而非 `max_completion_tokens`。

---

## 10. 总结

| 维度 | 现状 | 目标态 | 推荐动作 |
|------|------|--------|----------|
| Provider 覆盖 | 2 家 | 20+ 家 | 引入 pi-ai |
| 流式工具调用 | 完成后一次性 | 增量解析 | 用 pi-ai 事件 |
| Cost 跟踪 | 无 | 内置 | 透传 `Usage.cost` |
| Auth | 单一 env | env/credential/OAuth | Core 解析后传给 pi-ai |
| 跨 provider handoff | 无 | 自动转换 | 长期迁移消息格式 |
| 模型元数据 | 手写 | 自动生成 catalog | 替换 `context-window.ts` |
| 错误/abort | 抛异常 | 编码为流事件 | adapter 中转异常 |
| 与红线兼容性 | - | 兼容 | 保持 Core 配置入口 |
| 主要风险 | - | 依赖冲突、Node 版本、API 形态差异 | 先 MVP 验证 |

**推荐结论**：启动 MVP，在 `packages/core/src/llm/pi/` 中实现 `PiLlmProvider`，用 `REM_USE_PI_LLM=1` 灰度 Anthropic/OpenAI，跑通现有测试后再逐步扩展 provider 数量、暴露 cost、替换 context-window，最终成为默认 LLM 层。
