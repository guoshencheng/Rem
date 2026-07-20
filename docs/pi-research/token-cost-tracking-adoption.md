# REM Token 成本与缓存统计升级调研报告

## 1. 执行摘要：结论与推荐方案

通过对比 REM 当前 `token-usage.ts` / `types.ts` 与 PI `pi-ai` 的 `Usage`、`ModelCost`、`calculateCost` 实现，建议 REM 在不破坏现有数据结构的前提下，为 `LanguageModelUsage` 增加**可选的 `cost` 字段**，并在 provider 层/运行时将 token 数与**模型单价元数据**结合，计算出 `input/output/cacheRead/cacheWrite/total` 成本。

**核心推荐：**

- `LanguageModelUsage` 演进为“token 明细 + 成本明细”的统一结构，`cost` 字段可选，确保旧会话数据可反序列化。
- 成本数据由 REM 自己计算：token 数量来自 OpenAI/Anthropic 等上游响应，单价来自 REM 维护的**模型成本元数据表**（可覆盖）。
- 在 `budget.ts` / `budget-policy.ts` 中增加 `maxCost` 预算维度，实现“按金额熔断”。
- 在 Web UI `token-stats.tsx` 中显示 `cost.total`，并提供 cache read/write 比例。
- 先在 `openai-adapter.ts`、`anthropic-adapter.ts` 两个 provider 落地，其他 provider 可后续复用同一套 `calculateCost`。

## 2. REM 当前 usage 统计能力边界

### 2.1 类型定义

`packages/core/src/types.ts` 中的 `LanguageModelUsage`：

```ts
export interface LanguageModelUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputTokenDetails?: {
    noCacheTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  outputTokenDetails?: {
    textTokens?: number;
    reasoningTokens?: number;
  };
}
```

`packages/core/src/llm/types.ts` 中的 `GenerateResult.usage` 与 `StreamChunk` 的 `usage` 事件完全复用同样结构。

### 2.2 当前能做到什么

- 记录每次/每轮/累计的 `inputTokens`、`outputTokens`、`totalTokens`。
- 在 `inputTokenDetails` 中区分 `noCacheTokens`、`cacheReadTokens`、`cacheWriteTokens`。
- 在 `outputTokenDetails` 中区分 `textTokens`、`reasoningTokens`。
- `token-usage.ts` 提供了 `addUsage`、`computeCacheStats`、`computeCacheRatio`、`formatUsage` 等工具函数。
- `run-agent.ts` 将每轮 usage 汇总到 `liveState.tokenUsage`，并写入 `session.metadata.tokenUsageHistory` / `messageTokenUsage`。
- Web UI `token-stats.tsx` 展示总 token 数与 cache 比例。

### 2.3 当前缺失什么

- **没有 cost 字段**：任何 layer 都无法知道本次调用花了多少钱。
- **没有模型单价来源**：`AgentModelConfig` / `ResolvedModelConfig` 只包含 `provider/model/apiKey/baseURL`。
- **预算只关心 turn/error/timeout**：`IterationBudget` 与 `BudgetPolicy` 没有任何成本维度。
- **cache 信息分散在 details 中**：虽然 PI 也分 details，但 REM 缺少“顶层”的 `cacheRead` / `cacheWrite` 直接字段，不利于成本计算。
- **Provider 返回结果未经过成本计算**：`parseOpenAIResponse`、`parseOpenAIChunk`、`parseAnthropicResponse`、`parseAnthropicStreamEvent` 只填充 token 数。

## 3. PI 的 usage/cost 模型可借鉴点

### 3.1 PI 的 `Usage` 类型

`packages/ai/src/types.ts`：

```ts
export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h?: number; // Anthropic 1h 缓存写入
  reasoning?: number;    // 推理/思考 token 子集
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}
```

特点：

- **顶层就区分 cacheRead / cacheWrite**，而不是嵌套在 details 里。
- `cost` 是**必填**（默认 0），消费侧可以直接访问 `usage.cost.total`。
- `reasoning` 与 `output` 分开记录，但 `output` 已包含 reasoning。
- 对 Anthropic 的 1h cache write 做了额外字段 `cacheWrite1h`，用于更高精度的成本计算。

### 3.2 PI 的模型单价模型

```ts
export interface ModelCostRates {
  input: number;       // $/million tokens
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelCostTier extends ModelCostRates {
  inputTokensAbove: number;
}

export interface ModelCost extends ModelCostRates {
  tiers?: ModelCostTier[];
}

export interface Model<TApi extends Api> {
  id: string;
  // ...
  cost: ModelCost;
}
```

PI 的 `cost` 是模型元数据的一部分，每个模型出厂就带价格。

### 3.3 PI 的成本计算

`packages/ai/src/models.ts` 中的 `calculateCost`：

```ts
export function calculateCost<TApi extends Api>(model: Model<TApi>, usage: Usage): Usage["cost"] {
  const inputTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  let rates: ModelCostRates = model.cost;
  let matchedThreshold = -1;
  for (const tier of model.cost.tiers ?? []) {
    if (inputTokens > tier.inputTokensAbove && tier.inputTokensAbove > matchedThreshold) {
      rates = tier;
      matchedThreshold = tier.inputTokensAbove;
    }
  }

  const longWrite = usage.cacheWrite1h ?? 0;
  const shortWrite = usage.cacheWrite - longWrite;
  usage.cost.input = (rates.input / 1_000_000) * usage.input;
  usage.cost.output = (rates.output / 1_000_000) * usage.output;
  usage.cost.cacheRead = (rates.cacheRead / 1_000_000) * usage.cacheRead;
  usage.cost.cacheWrite = (rates.cacheWrite * shortWrite + rates.input * 2 * longWrite) / 1_000_000;
  usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
  return usage.cost;
}
```

可借鉴点：

1. **价格按“每百万 token”存储**，计算时除 1e6，避免浮点误差过大。
2. **支持 tier 定价**：某些模型在输入超过阈值后单价变化。
3. **cache write 分层计费**：Anthropic 1h cache write 按 2x input 价格计算。
4. **在 API 解析层就调用 calculateCost**：`openai-completions.ts` 的 `parseChunkUsage(...)`、`anthropic-messages.ts` 的 `message_start`/`message_delta` 都会立刻调用。

### 3.4 PI 在 OpenAI 与 Anthropic 中的解析示例

**OpenAI（`packages/ai/src/api/openai-completions.ts`）：**

```ts
function parseChunkUsage(rawUsage, model) {
  const promptTokens = rawUsage.prompt_tokens || 0;
  const cacheReadTokens = rawUsage.prompt_tokens_details?.cached_tokens ?? rawUsage.prompt_cache_hit_tokens ?? 0;
  const cacheWriteTokens = rawUsage.prompt_tokens_details?.cache_write_tokens || 0;
  const input = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);
  const outputTokens = rawUsage.completion_tokens || 0;
  const usage = {
    input, output, cacheRead, cacheWrite,
    reasoning: rawUsage.completion_tokens_details?.reasoning_tokens || 0,
    totalTokens: input + outputTokens + cacheReadTokens + cacheWriteTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  calculateCost(model, usage);
  return usage;
}
```

**Anthropic（`packages/ai/src/api/anthropic-messages.ts`）：**

```ts
output.usage.input = event.message.usage.input_tokens || 0;
output.usage.output = event.message.usage.output_tokens || 0;
output.usage.cacheRead = event.message.usage.cache_read_input_tokens || 0;
output.usage.cacheWrite = event.message.usage.cache_creation_input_tokens || 0;
output.usage.cacheWrite1h = event.message.usage.cache_creation?.ephemeral_1h_input_tokens || 0;
output.usage.totalTokens =
  output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
calculateCost(model, output.usage);
```

REM 可以借鉴这种“解析完 usage 立即计算 cost”的模式。

## 4. 推荐的新设计

### 4.1 `LanguageModelUsage` 演进方案

在 `packages/core/src/types.ts` 中：

```ts
export interface LanguageModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface LanguageModelUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputTokenDetails?: {
    noCacheTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  outputTokenDetails?: {
    textTokens?: number;
    reasoningTokens?: number;
  };
  cost?: LanguageModelCost; // 新增，可选
}
```

同步修改 `packages/core/src/llm/types.ts` 中的 `GenerateResult.usage` 与 `StreamChunk` 的 `usage` 事件。

### 4.2 模型单价元数据

新增 `packages/core/src/llm/model-costs.ts`：

```ts
export interface ModelCostRates {
  input: number;      // USD per 1M tokens
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ResolvedModelCost extends ModelCostRates {
  tiers?: Array<ModelCostRates & { inputTokensAbove: number }>;
}

const DEFAULT_MODEL_COSTS = new Map<string, ResolvedModelCost>([
  ['openai:gpt-4o', { input: 2.50, output: 10.00, cacheRead: 1.25, cacheWrite: 2.50 }],
  ['anthropic:claude-sonnet-4', { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 }],
  // ...
]);

export function resolveModelCost(provider: string, model: string, overrides?: ResolvedModelCost): ResolvedModelCost | undefined {
  const key = `${provider.toLowerCase()}:${model.toLowerCase()}`;
  const builtIn = DEFAULT_MODEL_COSTS.get(key);
  return overrides ? { ...builtIn, ...overrides } : builtIn;
}
```

同时允许用户配置：

```ts
// AgentModelConfig
export interface AgentModelConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  cost?: ModelCostRates; // 用户自定义单价
}

export interface ResolvedModelConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseURL?: string;
  cost?: ResolvedModelCost; // 解析后的单价
}
```

`DefaultConfigProvider.resolveModelConfig` 调用 `resolveModelCost` 把 `cost` 注入到 `ResolvedModelConfig`。

### 4.3 运行时成本计算

新增 `packages/core/src/token-usage.ts` 中的 helper：

```ts
export function calculateCost(usage: LanguageModelUsage, rates: ResolvedModelCost): LanguageModelCost {
  const details = detailOrZero(usage.inputTokenDetails);
  const cacheRead = details.cacheReadTokens;
  const cacheWrite = details.cacheWriteTokens;
  const noCache = details.noCacheTokens;

  const rate = pickTier(rates, noCache + cacheRead + cacheWrite);
  const inputCost = (rate.input / 1_000_000) * noCache;
  const outputCost = (rate.output / 1_000_000) * usage.outputTokens;
  const cacheReadCost = (rate.cacheRead / 1_000_000) * cacheRead;
  const cacheWriteCost = (rate.cacheWrite / 1_000_000) * cacheWrite;
  const total = inputCost + outputCost + cacheReadCost + cacheWriteCost;

  return { input: inputCost, output: outputCost, cacheRead: cacheReadCost, cacheWrite: cacheWriteCost, total };
}

export function addCost(a: LanguageModelCost | undefined, b: LanguageModelCost | undefined): LanguageModelCost {
  const a0 = a ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  const b0 = b ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  return {
    input: a0.input + b0.input,
    output: a0.output + b0.output,
    cacheRead: a0.cacheRead + b0.cacheRead,
    cacheWrite: a0.cacheWrite + b0.cacheWrite,
    total: a0.total + b0.total,
  };
}
```

在 `GenerateResult` 构造后填充 cost：

- `packages/core/src/llm/providers/openai-adapter.ts`：`parseOpenAIResponse` / `parseOpenAIChunk` 的 `usage` 块生成后，传入 `ResolvedModelCost` 并调用 `calculateCost`。
- `packages/core/src/llm/providers/anthropic-adapter.ts`：同理。

`GenerateOptions` 增加 `cost?: ResolvedModelCost`：

```ts
export interface GenerateOptions extends ProviderConfig {
  // ...
  cost?: ResolvedModelCost;
}
```

`openaiProvider.generate/stream` 与 `anthropicProvider.generate/stream` 将 `options.cost` 传给 adapter。

### 4.4 在 Budget 中使用 cost

`packages/core/src/budget.ts`：

```ts
export interface BudgetConfig {
  maxTurns: number;
  maxConsecutiveErrors: number;
  maxSameToolFailures: number;
  maxCost?: number; // 新增：允许总成本预算
}

export class IterationBudget {
  // ...
  totalCost = 0;

  addCost(cost: number): void {
    this.totalCost += cost;
  }

  hasBudget(): boolean {
    // ... 原有逻辑
    if (this.config.maxCost !== undefined && this.totalCost >= this.config.maxCost) return false;
    return true;
  }

  getStatus(): BudgetStatus {
    // ... 返回 cost 信息
  }
}
```

`run-agent.ts` 中：

```ts
liveState.addTokenUsage(result.usage);
if (result.usage.cost) {
  liveState.budget.addCost(result.usage.cost.total);
}
```

（若 `BudgetPolicy` 采用 `liveState.budget` 实例，则 `FixedBudgetPolicy` 天然会读取 `hasBudget()` 的成本结果。）

### 4.5 Session Metadata 与 Web UI

`run-agent.ts` 写入 `session.metadata.tokenUsageHistory` 与 `messageTokenUsage` 的数据结构不变（因为 `LanguageModelUsage` 已包含 `cost`），持久化即保存成本。

`token-stats.tsx` 展示：

```tsx
export function TokenStatsBadge({ usage, maxTokens }: TokenStatsBadgeProps) {
  const ratio = computeWindowRatio(usage, maxTokens);
  const cacheRatio = computeCacheRatio(usage);
  const cost = usage.cost?.total;

  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span>{formatUsage(usage)}</span>
      <span className="rounded-full bg-secondary px-2 py-0.5">cache {(cacheRatio * 100).toFixed(1)}%</span>
      <span className="rounded-full bg-secondary px-2 py-0.5">{(ratio * 100).toFixed(1)}% of context</span>
      {cost !== undefined && (
        <span className="rounded-full bg-secondary px-2 py-0.5">${cost.toFixed(4)}</span>
      )}
    </div>
  );
}
```

## 5. 变更清单

### 类型与接口

| 文件 | 变更 |
|------|------|
| `packages/core/src/types.ts` | `LanguageModelUsage` 增加 `cost?: LanguageModelCost`；`AgentStreamChunk` 的 `usage` 事件同步增加。 |
| `packages/core/src/llm/types.ts` | `GenerateResult.usage` 与 `StreamChunk` 的 `usage` 事件同步增加 `cost`。 |
| `packages/core/src/sdk/config-provider.ts` | `AgentModelConfig` / `ResolvedModelConfig` 增加 `cost` 字段。 |
| `packages/core/src/sdk/budget-policy.ts` | `BudgetStatus` 可扩展 `totalCost` / `costRemaining`（可选）。 |
| `packages/core/src/budget.ts` | `BudgetConfig` 增加 `maxCost?: number`；`IterationBudget` 增加 `totalCost` 与 `addCost`。 |

### 新增文件

| 文件 | 作用 |
|------|------|
| `packages/core/src/llm/model-costs.ts` | 维护 provider:model → 单价的内置表；支持覆盖。 |
| `packages/core/src/llm/cost.ts`（可选） | 如果 `token-usage.ts` 不宜过大，可独立 `calculateCost`/`addCost`。 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `packages/core/src/token-usage.ts` | `emptyUsage` 增加 `cost` 零值；`addUsage` 增加 cost 累加；新增 `calculateCost`、`addCost`、`formatCost` 等 helper。 |
| `packages/core/src/llm/providers/openai-adapter.ts` | `parseOpenAIResponse` / `parseOpenAIChunk` 在生成 usage 后计算并填充 `cost`。 |
| `packages/core/src/llm/providers/anthropic-adapter.ts` | `parseAnthropicResponse` / `parseAnthropicStreamEvent` 同理。 |
| `packages/core/src/llm/providers/openai.ts` | 将 `options.cost` 传入 adapter。 |
| `packages/core/src/llm/providers/anthropic.ts` | 同上。 |
| `packages/core/src/llm/stream-collector.ts` | 收集 `usage` 时保留 `cost`。 |
| `packages/core/src/reason/reason.ts` | 非流式/流式结果中保留 `cost`；流式 `onChunk` 转发时保留 `cost`。 |
| `packages/core/src/sdk/loop-strategy.ts` | 无需改动（类型已兼容）。 |
| `packages/core/src/run-agent.ts` | 在 `liveState.addTokenUsage` 后，把 cost 累加到 budget；持久化到 session metadata。 |
| `packages/core/src/state.ts` | `addTokenUsage` 已复用 `addUsage`，自动累计 cost。 |
| `packages/core/src/plugins/config/default/index.ts` | `resolveModelConfig` 解析 `cost` 并调用 `resolveModelCost`。 |
| `packages/core/src/plugins/budget/fixed/index.ts` | 若需要，在 `getStatus` 中返回成本信息。 |
| `packages/web/src/components/chat/token-stats.tsx` | 显示 `cost.total`。 |

### 测试

- `packages/core/tests/` 中新增/补充：
  - `token-usage.test.ts`：验证 `addUsage` cost 累加、`calculateCost` 计算精度。
  - `openai-adapter.test.ts` / `anthropic-adapter.test.ts`：验证 usage 解析后带 cost。
  - `budget.test.ts`：验证 `maxCost` 触发熔断。

## 6. 迁移步骤

### Step 1：类型扩展（向后兼容）

在所有 `LanguageModelUsage` 出现的位置增加 `cost?: LanguageModelCost`。因为 `cost` 是可选字段，旧代码不感知即可编译通过。

### Step 2：单价元数据与配置

1. 新增 `packages/core/src/llm/model-costs.ts`，内置常见模型价格。
2. 在 `config-provider.ts` 与 `DefaultConfigProvider` 中支持 `cost` 配置项。
3. 运行 `pnpm typecheck` 确认无破坏。

### Step 3：更新 `token-usage.ts`

- `emptyUsage` 返回 `{ ..., cost: { input:0, output:0, cacheRead:0, cacheWrite:0, total:0 } }`。
- `addUsage` 增加 cost 累加：

```ts
export function addUsage(a, b) {
  return {
    // ... token 字段
    cost: addCost(a.cost, b.cost),
  };
}
```

- 新增 `calculateCost` / `addCost` / `formatCost`。

### Step 4：Provider 接入

1. 在 `GenerateOptions` 中增加 `cost?: ResolvedModelCost`。
2. 在 `openai.ts` / `anthropic.ts` 的 `generate`/`stream` 中把 `options.cost` 传给 adapter。
3. 在 `openai-adapter.ts` / `anthropic-adapter.ts` 的 usage 解析函数中，拿到 `costRates` 后调用 `calculateCost` 并写入 `usage.cost`。
4. 运行现有测试，确保 token 数不变，只有 cost 新增。

### Step 5：Budget 接入

1. `BudgetConfig` 增加 `maxCost?: number`。
2. `IterationBudget` 增加 `totalCost` 与 `addCost` 方法，`hasBudget()` 中检查 `maxCost`。
3. `run-agent.ts` 中每轮结束后把 `result.usage.cost.total` 加到 budget。

### Step 6：UI 接入

`token-stats.tsx` 增加 `cost` 显示（未定义时隐藏）。

### Step 7：回归验证

- `pnpm typecheck`
- `pnpm test`
- 检查旧 session metadata（不含 `cost`）能正常加载且显示为“—”。

## 7. 数据来源策略

| 数据 | 来源 | 说明 |
|------|------|------|
| Token 数量 | Provider 响应（OpenAI/Anthropic SDK） | 与现状一致，`inputTokens`、`outputTokens`、cache details 等来自上游。 |
| 单价（$/M tokens） | **REM 内置模型表 + 用户配置** | 推荐方式。OpenAI/Anthropic 等上游不返回价格，REM 必须自己维护。内置表覆盖常见模型；用户可通过 `rem.json` 或环境变量覆盖。 |
| 成本 | **运行时计算** | 在 provider adapter 或 `reason.ts` 中，用 token 数 × 单价得到 cost。 |
| Tier 定价 | 内置表支持 | 若模型有阶梯价，可在 `ResolvedModelCost.tiers` 中声明。 |

**为什么不依赖 provider 返回 cost？**

- OpenAI、Anthropic、OpenRouter 等 API 均不返回金额。
- 自托管/兼容端点更不可能返回成本。
- 只有 REM 自己知道实际使用的模型与对应价格，因此必须自己算。

**为什么不把单价硬编码在 adapter 里？**

- 价格会变动、不同区域/账号折扣不同。
- 硬编码在 adapter 中难以覆盖和测试。
- 集中放在 `model-costs.ts` 并允许配置覆盖，更灵活。

## 8. 风险与注意事项

### 8.1 精度与浮点

- 成本使用 USD 浮点数，累加可能产生微小误差。建议保留 6 位小数存储，UI 展示 4 位。
- 不要对 `cost` 做等值判断，预算熔断用 `>= maxCost`。

### 8.2 旧数据兼容

- `cost` 必须设为可选。`addUsage` 与 `emptyUsage` 对缺失的 cost 默认按 0 处理。
- 反序列化旧 session metadata 时，`cost` 为 `undefined`，UI 显示“—”或隐藏。

### 8.3 缓存定义差异

- OpenAI 的 `prompt_tokens_details.cached_tokens` 是 cache read，`cache_write_tokens` 是 cache write。
- Anthropic 的 `cache_read_input_tokens` / `cache_creation_input_tokens` 语义类似，但 `input_tokens` 的包含关系需与 REM 的 `inputTokenDetails` 对齐。
- 计算 cost 时，建议从 `inputTokenDetails.cacheReadTokens` / `cacheWriteTokens` 取值，避免直接依赖 provider 原始字段。

### 8.4 多 Provider 与自定义模型

- 自定义模型或未在内置表中覆盖的模型，默认 cost 为 0，UI 显示“—”。
- 用户可在配置中显式提供 `cost`，避免“花了 token 但看不到钱”的困惑。

### 8.5 Budget 成本熔断

- `maxCost` 是“累计”阈值，不是“单次”阈值。需要在每轮结束后检查。
- 如果某次调用返回的 cost 为 0（未配置单价），则不会触发熔断，应提示用户配置价格。

### 8.6 与 Agent 角色切换的兼容性

- `run-agent.ts` 中使用 `agentRole.model ?? modelConfig`。如果不同 agent 使用不同模型，建议把 `cost` 作为 `ResolvedModelConfig` 的一部分，在 `effectiveModel` 上直接获取。

### 8.7 不要破坏现有模块分离约定

- `token-usage.ts` 超过一定行数后，可将 cost 计算拆分到 `packages/core/src/llm/cost.ts` 或 `packages/core/src/token-cost.ts`，保持文件精简。
- 后续新 provider 只需在 adapter 中调用 `calculateCost` 即可，不要重复实现价格逻辑。

---

**结论**：REM 通过给 `LanguageModelUsage` 增加可选 `cost`、引入模型单价表、在 provider 解析层统一计算，即可低侵入地获得 PI 级别的 token 成本与缓存统计能力，同时为 future 的预算熔断、成本告警、会话成本分析打下基础。
