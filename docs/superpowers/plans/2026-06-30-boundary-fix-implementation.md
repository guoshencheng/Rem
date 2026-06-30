# 模块边界修正与架构统一 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按模块分离规范消除边界违规：删除 CoreAgent/ui/approval-hook 死代码，拆分超限文件，统一 bridge IAgentService 接口，共享 stream-reducer，删除 demo 包。

**Architecture:** 底向上五阶段：Core 删除/拆分 → Bridge 统一接口 → Web 对接 → TUI 拆分/对接 → Demo 清理。

**Tech Stack:** TypeScript, pnpm workspace, vitest, @opentui/core

---

## Phase A: Core 层 (27 文件变更)

### Task A1: 删除死代码和废弃模块

**Files:**
- Delete: `packages/core/src/core-agent.ts`
- Delete: `packages/core/src/security/approval-hook.ts`
- Delete: `packages/core/src/ui/index.ts`
- Delete: `packages/core/src/ui/types.ts`
- Delete: `packages/core/src/ui/session.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/security/index.ts`

- [ ] **Step 1: 删除 5 个文件**

```bash
rm packages/core/src/core-agent.ts
rm packages/core/src/security/approval-hook.ts
rm packages/core/src/ui/index.ts
rm packages/core/src/ui/types.ts
rm packages/core/src/ui/session.ts
rmdir packages/core/src/ui/
```

- [ ] **Step 2: 更新 `packages/core/src/index.ts`**

移除 CoreAgent 和 UI 相关的导出行，替换为：

```typescript
export * from './types.js';
export * from './config/paths.js';
export * from './budget.js';
export * from './session.js';
export * from './state.js';
export * from './events.js';
export * from './turn.js';
export * from './loop-strategy.js';
export * from './agent-factory.js';
export * from './provider-manager.js';
export { createProviderManager } from './provider-manager.js';
export * from './run-agent.js';
export * from './stream/agent-stream.js';
export * from './sdk/index.js';
export * from './plugins/index.js';
export * from './registry/tool-registry.js';
export * from './registry/provider-loader.js';
export * from './registry/provider-registry.js';
export * from './llm/types.js';
export * from './llm/api-registry.js';
export * from './llm/engine.js';
export * from './llm/providers/index.js';
```

- [ ] **Step 3: 修复 `packages/core/src/sdk/index.ts`** 重复导出行

```typescript
export * from './tool-provider.js';
export * from './tool-policy.js';
export * from './tool-hook.js';
export * from './config-provider.js';
export * from './memory-provider.js';
export * from './error-handler.js';
export * from './budget-policy.js';
export * from './compressor.js';
export * from './skill-provider.js';
export * from './session-provider.js';
export * from './provider-loader.js';
```

- [ ] **Step 4: 运行 typecheck 验证**

```bash
pnpm typecheck
```

预期：报错（agent-factory.ts 尚未创建，其他文件引用 CoreAgent 的 import 会报错）。确认报错范围在预期内后进入 Task A2。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: remove CoreAgent, ui/, approval-hook; fix sdk/index duplicate export"
```

---

### Task A2: 创建 agent-factory.ts

**Files:**
- Create: `packages/core/src/agent-factory.ts`
- Modify: `packages/core/src/run-agent.ts`

- [ ] **Step 1: 读取 `run-agent.ts` 了解其导出**

确认 `runAgent` 函数签名和 `RunAgentParams` 接口。

- [ ] **Step 2: 创建 `packages/core/src/agent-factory.ts`**

从 `core-agent.ts` 提取 `createAgentFromEnv` 函数，适配 `runAgent` 和 `ProviderManager`：

```typescript
import { registerBuiltInProviders } from './llm/providers/index.js';
import { resolveProviderConfig } from './llm/api-registry.js';
import type { ProviderConfig } from './llm/types.js';
import type { SessionProvider } from './sdk/session-provider.js';
import type { SkillProvider } from './sdk/skill-provider.js';
import type { ConfigProvider } from './sdk/config-provider.js';
import type { ProviderReference } from './sdk/provider-loader.js';
import type { ToolPolicyConfig } from './sdk/tool-policy.js';
import { createProviderManager } from './provider-manager.js';

export interface CreateAgentOptions {
  name?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  baseURL?: string;
  maxTurns?: number;
  sessionProvider?: ProviderReference<SessionProvider>;
  skillProvider?: ProviderReference<SkillProvider>;
  configProvider?: ConfigProvider;
  configPath?: string;
  workspaceRoot?: string;
  readOnly?: boolean;
  toolPolicy?: ToolPolicyConfig;
}

export function createAgentFromEnv(options?: CreateAgentOptions) {
  registerBuiltInProviders();

  const configProvider = options?.configProvider;
  const behavior = configProvider?.getBehaviorConfig?.();
  const modelCfg = configProvider?.getModelConfig?.(options?.provider);
  const provider = options?.provider ?? modelCfg?.provider ?? 'openai';

  const providerConfig: ProviderConfig | undefined =
    options?.provider !== undefined
      ? {
          model: options.model ?? '',
          apiKey: options.apiKey ?? '',
          baseURL: options.baseURL,
        }
      : options?.model !== undefined || options?.apiKey !== undefined || options?.baseURL !== undefined
        ? {
            model: options.model ?? modelCfg?.model ?? '',
            apiKey: options.apiKey ?? modelCfg?.apiKey ?? '',
            baseURL: options.baseURL ?? modelCfg?.baseURL,
          }
        : modelCfg
          ? {
              model: modelCfg.model,
              apiKey: modelCfg.apiKey,
              baseURL: modelCfg.baseURL,
            }
          : undefined;

  const name = options?.name ?? behavior?.name ?? 'Rem Agent';
  const maxTurns = options?.maxTurns ?? behavior?.maxTurns ?? 60;

  const pm = createProviderManager({
    agentName: name,
    maxTurns,
    sessionProvider: options?.sessionProvider,
    skillProvider: options?.skillProvider ?? 'file',
    workspaceRoot: options?.workspaceRoot ?? behavior?.workspaceRoot ?? process.cwd(),
    readOnly: options?.readOnly ?? behavior?.readOnly ?? false,
    toolPolicy: options?.toolPolicy ?? configProvider?.getToolConfig?.().policy,
    configProvider,
    provider,
    providerConfig,
  });

  return { pm, name, maxTurns, provider, providerConfig };
}
```

- [ ] **Step 3: 运行 typecheck**

```bash
pnpm typecheck
```

预期：agent-factory.ts 相关的报错解决。其他报错（loop-strategy 等引用 CoreAgent 事件的）会持续到后续 Task。

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/agent-factory.ts
git commit -m "feat: extract createAgentFromEnv to agent-factory.ts"
```

---

### Task A3: 拆分 loop-strategy.ts → loop-types.ts + loop-strategy.ts

**Files:**
- Create: `packages/core/src/loop-types.ts`
- Modify: `packages/core/src/loop-strategy.ts`

- [ ] **Step 1: 创建 `packages/core/src/loop-types.ts`**

```typescript
import type { AgentState } from './state.js';
import type { AgentOutput, ToolCallRecord, UserInput, ModelMessage, LanguageModelUsage } from './types.js';
import { IterationBudget } from './budget.js';
import { AgentStreamController } from './stream/agent-stream.js';

export interface TurnHooks {
  onMessageAdded(msg: ModelMessage): void;
  onToolCallRecorded(record: ToolCallRecord): void;
}

export interface LoopContext {
  input?: UserInput;
  state: AgentState;
  systemPrompt: string;
  budget: IterationBudget;
  signal?: AbortSignal;
  provider?: string;
  providerConfig?: {
    apiKey: string;
    baseURL?: string;
    model: string;
  };
  workspaceRoot: string;
  readOnly?: boolean;
  agentName?: string;
}

export interface LoopResult {
  finalOutput: AgentOutput;
  newMessages: ModelMessage[];
  toolCalls: any[];
  usage: LanguageModelUsage;
}

export interface LoopStrategy {
  iterate(ctx: LoopContext, hooks: TurnHooks, controller: AgentStreamController, step: number): Promise<LoopResult>;
}
```

- [ ] **Step 2: 修改 `packages/core/src/loop-strategy.ts`**

移除接口定义（TurnHooks, LoopContext, LoopResult, LoopStrategy），改为从 loop-types 导入：

```typescript
import type { AgentState } from './state.js';
import type { EventBus } from './events.js';
import type { ModelMessage, ToolCallRecord, LanguageModelUsage } from './types.js';
import type { ToolProvider, ToolCall, ToolResult, ToolContext } from './sdk/tool-provider.js';
import type { MemoryProvider } from './sdk/memory-provider.js';
import type { ContextCompressor } from './sdk/compressor.js';
import type { ErrorHandler } from './sdk/error-handler.js';
import type { SkillProvider } from './sdk/skill-provider.js';
import { InferenceEngine, type InferenceResult } from './llm/engine.js';
import type { StreamChunk } from './llm/types.js';
import { AgentStreamController, type RawChunk } from './stream/agent-stream.js';
import type { LoopContext, TurnHooks, LoopResult } from './loop-types.js';
export type { TurnHooks, LoopContext, LoopResult, LoopStrategy } from './loop-types.js';

export class ReactLoop implements LoopStrategy {
  // ... (其余代码不变，只改 imports)
```

- [ ] **Step 3: 运行 typecheck**

```bash
pnpm typecheck
```

预期：loop-strategy 相关报错解决。

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/loop-types.ts packages/core/src/loop-strategy.ts
git commit -m "refactor: split loop-strategy into loop-types + loop-strategy"
```

---

### Task A4: 拆分 stream/agent-stream.ts → stream-aggregators.ts

**Files:**
- Create: `packages/core/src/stream/stream-aggregators.ts`
- Modify: `packages/core/src/stream/agent-stream.ts`

- [ ] **Step 1: 创建 `packages/core/src/stream/stream-aggregators.ts`**

从 `agent-stream.ts` 提取 `aggregateText`, `aggregateUsage`, `aggregateSteps` 为独立函数（接收已完成的 chunks 数组）：

```typescript
import type { AgentStreamChunk, AgentStreamStepResult, LanguageModelUsage } from '../types.js';

export function aggregateText(chunks: AgentStreamChunk[]): string {
  return chunks
    .filter((c): c is Extract<AgentStreamChunk, { type: 'text-delta' }> => c.type === 'text-delta')
    .map((c) => c.text)
    .join('');
}

export function aggregateUsage(_chunks: AgentStreamChunk[]): LanguageModelUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
    outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
  };
}

export function aggregateSteps(chunks: AgentStreamChunk[]): AgentStreamStepResult[] {
  const stepMap = new Map<number, AgentStreamStepResult>();
  for (const chunk of chunks) {
    if (chunk.type === 'step-start') {
      stepMap.set(chunk.step, { step: chunk.step, text: '', reasoning: '', toolCalls: [] });
    } else if (chunk.type === 'text-delta') {
      const step = stepMap.get(chunk.step) ?? { step: chunk.step, text: '', reasoning: '', toolCalls: [] };
      step.text += chunk.text;
      stepMap.set(chunk.step, step);
    } else if (chunk.type === 'reasoning-delta') {
      const step = stepMap.get(chunk.step) ?? { step: chunk.step, text: '', reasoning: '', toolCalls: [] };
      step.reasoning += chunk.text;
      stepMap.set(chunk.step, step);
    } else if (chunk.type === 'tool-call') {
      const step = stepMap.get(chunk.step) ?? { step: chunk.step, text: '', reasoning: '', toolCalls: [] };
      step.toolCalls.push({
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        input: chunk.input,
      });
      stepMap.set(chunk.step, step);
    } else if (chunk.type === 'tool-result') {
      const step = stepMap.get(chunk.step) ?? { step: chunk.step, text: '', reasoning: '', toolCalls: [] };
      const tc = step.toolCalls.find((t) => t.toolCallId === chunk.toolCallId);
      if (tc) {
        tc.output = chunk.output;
        tc.error = chunk.error;
      }
      stepMap.set(chunk.step, step);
    }
  }
  return [...stepMap.values()];
}
```

- [ ] **Step 2: 修改 `packages/core/src/stream/agent-stream.ts`**

将 `aggregateText`, `aggregateUsage`, `aggregateSteps` 方法改为调用 stream-aggregators：

在文件顶部添加导入：
```typescript
import { aggregateText, aggregateUsage, aggregateSteps } from './stream-aggregators.js';
```

将 `stream` getter 中的调用改为：
```typescript
get stream(): AgentStream {
    return {
      fullStream: this.createIterator(),
      text: this.createAggregate().then(() => aggregateText(this.queue)),
      usage: this.createAggregate().then(() => aggregateUsage(this.queue)),
      steps: this.createAggregate().then(() => aggregateSteps(this.queue)),
    };
  }
```

并添加 `createAggregate()` 方法（复用原 `aggregateRun` 逻辑）：
```typescript
  private createAggregate(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const check = () => {
        if (this.finished) {
          if (this.error) return reject(this.error);
          return resolve();
        }
        setTimeout(check, 10);
      };
      check();
      this.pending.push(() => {}); // ensure polling continues
    });
  }
```

删除原有的 `aggregateText`, `aggregateUsage`, `aggregateSteps`, `aggregateRun` 方法。

- [ ] **Step 3: 运行 typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/stream/
git commit -m "refactor: split stream-aggregators from agent-stream"
```

---

### Task A5: 拆分 llm/types.ts → stream-collector.ts

**Files:**
- Create: `packages/core/src/llm/stream-collector.ts`
- Modify: `packages/core/src/llm/types.ts`

- [ ] **Step 1: 创建 `packages/core/src/llm/stream-collector.ts`**

```typescript
import type { GenerateResult, StreamChunk } from './types.js';

export class StreamCollector {
  private text = '';
  private reasoningText = '';
  private toolCalls: GenerateResult['toolCalls'] = [];
  private usage: GenerateResult['usage'] = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  private finishReason?: string;

  feed(chunk: StreamChunk): void {
    if (chunk.type === 'text') {
      this.text += chunk.text;
    } else if (chunk.type === 'reasoning') {
      this.reasoningText += chunk.text;
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
    } else if (chunk.type === 'finish') {
      this.finishReason = chunk.reason;
    }
  }

  result(): GenerateResult {
    return {
      text: this.text,
      reasoning: this.reasoningText || undefined,
      toolCalls: this.toolCalls,
      usage: this.usage,
      finishReason: this.finishReason,
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

- [ ] **Step 2: 修改 `packages/core/src/llm/types.ts`**

移除 `StreamCollector` 类和 `collectStream` 函数（第 48-93 行）。保留纯类型定义。

- [ ] **Step 3: 更新 `packages/core/src/index.ts`** 添加 stream-collector 导出

```typescript
export * from './llm/stream-collector.js';
```

- [ ] **Step 4: 查找并更新所有引用 `StreamCollector` 的文件**

```bash
rg "StreamCollector|collectStream" packages/core/src/
```

预期：`llm/engine.ts` 引用了 `StreamCollector`。更新其 import 从 `./types.js` 改为 `./stream-collector.js`。

- [ ] **Step 5: 运行 typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/llm/
git commit -m "refactor: split StreamCollector to llm/stream-collector.ts"
```

---

### Task A6: 拆分 openai.ts 和 anthropic.ts — 提取 adapter

**Files:**
- Create: `packages/core/src/llm/providers/openai-adapter.ts`
- Create: `packages/core/src/llm/providers/anthropic-adapter.ts`
- Modify: `packages/core/src/llm/providers/openai.ts`
- Modify: `packages/core/src/llm/providers/anthropic.ts`

- [ ] **Step 1: 创建 `packages/core/src/llm/providers/openai-adapter.ts`**

从 `openai.ts` 提取 `convertAssistantContent`, `convertToOpenAIMessages`, `convertToOpenAITools`, `parseOpenAIResponse`, `parseOpenAIChunk`, `safeJsonParse`，以及 `PendingToolCall` 接口。这些函数保持不变，导出即可。

```typescript
import OpenAI from 'openai';
import type { GenerateOptions, GenerateResult, StreamChunk } from '../types.js';
import { debugLog } from '../../shared/debug-log.js';

function safeJsonParse(value: string): unknown {
  try { return JSON.parse(value); } catch { return value; }
}

function convertAssistantContent(content: unknown): OpenAI.Chat.ChatCompletionAssistantMessageParam {
  // [原 openai.ts 中 convertAssistantContent 的完整实现]
}

function convertToOpenAIMessages(messages: GenerateOptions['messages'], system?: string): OpenAI.Chat.ChatCompletionMessageParam[] {
  // [原实现]
}

function convertToOpenAITools(tools: GenerateOptions['tools']): OpenAI.Chat.ChatCompletionTool[] {
  // [原实现]
}

function parseOpenAIResponse(response: OpenAI.Chat.Completions.ChatCompletion): GenerateResult {
  // [原实现]
}

interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

function* parseOpenAIChunk(
  chunk: OpenAI.Chat.Completions.ChatCompletionChunk,
  pending: Map<number, PendingToolCall>,
): Generator<StreamChunk> {
  // [原实现]
}

export { safeJsonParse, convertToOpenAIMessages, convertToOpenAITools, parseOpenAIResponse, parseOpenAIChunk };
export type { PendingToolCall };
```

- [ ] **Step 2: 修改 `openai.ts`**

移除 adapter 函数，改为从 `openai-adapter.js` 导入：

```typescript
import OpenAI from 'openai';
import type { LLMProvider } from '../api-registry.js';
import type { GenerateOptions, GenerateResult, ProviderConfig, StreamChunk } from '../types.js';
import { debugLog } from '../../shared/debug-log.js';
import { convertToOpenAIMessages, convertToOpenAITools, parseOpenAIResponse, parseOpenAIChunk } from './openai-adapter.js';

// 仅保留 openaiProvider 的 resolveConfig, generate, stream
```

- [ ] **Step 3: 对 anthropic 执行同样的操作**

创建 `anthropic-adapter.ts`（提取 `convertToAnthropicMessages`, `convertToAnthropicTools`, `parseAnthropicResponse`, `parseAnthropicStreamEvent`），修改 `anthropic.ts` 从 adapter 导入。

- [ ] **Step 4: 运行 typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/llm/providers/
git commit -m "refactor: split openai/anthropic adapters from providers"
```

---

### Task A7: 拆分 plugins/config/default/index.ts

**Files:**
- Create: `packages/core/src/plugins/config/default/config-loader.ts`
- Create: `packages/core/src/plugins/config/default/config-parser.ts`
- Create: `packages/core/src/plugins/config/default/config-merger.ts`
- Modify: `packages/core/src/plugins/config/default/index.ts`

- [ ] **Step 1: 创建 `config-loader.ts`** — 提取 `resolveConfigPath` 和 `loadConfigFile`

```typescript
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function resolveConfigPath(configPath?: string): string | undefined {
  // 原 index.ts 中的 resolveConfigPath 实现
}

export function loadConfigFile(configPath?: string): Record<string, unknown> | undefined {
  // 原 index.ts 中的 loadConfigFile 实现
}
```

- [ ] **Step 2: 创建 `config-parser.ts`** — 提取 `pickToolPolicy`, `pickModelConfig`, `pickModels`, `resolveTemplate`

```typescript
// 原 index.ts 中的这些纯函数实现
```

- [ ] **Step 3: 创建 `config-merger.ts`** — 提取 `mergeFileConfig`, `mergeEnvConfig`, `applyBehaviorDefaults`

```typescript
// 原 index.ts 中的这些纯函数实现
```

- [ ] **Step 4: 修改 `index.ts`**

移除上述函数，改为从子模块导入，仅保留 `DefaultConfigProvider` 类和 `createProvider`。

- [ ] **Step 5: 运行 typecheck + test**

```bash
pnpm typecheck
pnpm --filter rem-agent-core test
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/plugins/config/default/
git commit -m "refactor: split config/default into loader/parser/merger"
```

---

### Task A8: 提取 session base.ts + 拆分 skill default-catalog + 拆分 edit

**Files:**
- Create: `packages/core/src/plugins/session/base.ts`
- Modify: `packages/core/src/plugins/session/file/index.ts`
- Modify: `packages/core/src/plugins/session/local/index.ts`
- Create: `packages/core/src/plugins/skill/default-catalog.ts`
- Modify: `packages/core/src/sdk/skill-provider.ts`
- Create: `packages/core/src/plugins/tool/file-system/edit-schemas.ts`
- Create: `packages/core/src/plugins/tool/file-system/edit-recovery.ts`
- Modify: `packages/core/src/plugins/tool/file-system/edit.ts`

- [ ] **Step 1: 创建 `plugins/session/base.ts`** — 提取 file 和 local 的公共基类

从 `file/index.ts` 和 `local/index.ts` 提取相同的逻辑：
- `ensureDir()` — 确保目录存在
- `sessionPath(sessionId)` — 构建 session 文件路径
- `write(session)` — JSON 序列化写入
- `create(sessionId?)` — 生成 session 对象
- `load(sessionId)` — JSON 反序列化加载
- `save(session)` — 更新 updatedAt 并写入

```typescript
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Session, SessionSummary } from '../../../sdk/session-provider.js';
import { generateId } from '../../../shared/generate-id.js';

export abstract class BaseFileSessionProvider {
  constructor(protected options: { sessionsDir: string }) {}

  protected async ensureDir(): Promise<void> {
    await mkdir(this.options.sessionsDir, { recursive: true });
  }

  protected sessionPath(sessionId: string): string {
    return join(this.options.sessionsDir, `${sessionId}.json`);
  }

  protected async write(session: Session): Promise<void> {
    await this.ensureDir();
    await writeFile(
      this.sessionPath(session.sessionId),
      JSON.stringify(session, null, 2),
      'utf-8',
    );
  }

  async create(sessionId?: string): Promise<Session> {
    const id = sessionId ?? generateId();
    const now = new Date();
    const session: Session = {
      sessionId: id,
      conversation: [],
      currentTurn: 0,
      metadata: { title: undefined },
      createdAt: now,
      updatedAt: now,
    };
    await this.write(session);
    return session;
  }

  async load(sessionId: string): Promise<Session | undefined> {
    try {
      const raw = await readFile(this.sessionPath(sessionId), 'utf-8');
      const data = JSON.parse(raw);
      return {
        sessionId: data.sessionId ?? sessionId,
        conversation: data.conversation ?? [],
        currentTurn: data.currentTurn ?? 0,
        metadata: data.metadata ?? {},
        createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
        updatedAt: data.updatedAt ? new Date(data.updatedAt) : new Date(),
      };
    } catch {
      return undefined;
    }
  }

  async save(session: Session): Promise<void> {
    session.updatedAt = new Date();
    await this.write(session);
  }

  abstract list(): Promise<SessionSummary[]>;
}
```

- [ ] **Step 2: 修改 `plugins/session/file/index.ts`** — 继承基类

```typescript
import { readdir } from 'node:fs/promises';
import { BaseFileSessionProvider } from '../base.js';
import type { SessionSummary } from '../../../../sdk/session-provider.js';

export class FileSessionProvider extends BaseFileSessionProvider {
  async list(): Promise<SessionSummary[]> {
    await this.ensureDir();
    const entries = await readdir(this.options.sessionsDir);
    const jsonFiles = entries.filter(f => f.endsWith('.json'));
    const summaries: SessionSummary[] = [];
    for (const file of jsonFiles) {
      const session = await this.load(file.replace('.json', ''));
      if (session) {
        summaries.push({
          sessionId: session.sessionId,
          title: session.metadata.title as string | undefined,
          updatedAt: Number(session.updatedAt),
          messageCount: session.conversation.length,
        });
      }
    }
    return summaries;
  }
}

export function createProvider(options: { sessionsDir: string }) {
  return new FileSessionProvider(options);
}

export function getDefaultOptions() {
  return { sessionsDir: './.sessions' };
}
```

删除 file/index.ts 中原有的 `FileSessionProvider` 类中与基类重复的方法。

- [ ] **Step 3: 修改 `plugins/session/local/index.ts`** — 继承基类

同样继承 `BaseFileSessionProvider`，仅保留 `_msgCache`, `cueMessages`, `pullMessages`, `delete` 和 index 管理逻辑。

- [ ] **Step 4: 创建 `plugins/skill/default-catalog.ts`** — 从 `sdk/skill-provider.ts` 移动

```typescript
import type { Skill } from '../../../sdk/skill-provider.js';

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export class DefaultSkillCatalog {
  format(skills: Skill[]): string {
    // 原 DefaultSkillCatalog 的 format 实现
  }
}
```

- [ ] **Step 5: 修改 `sdk/skill-provider.ts`** — 移除 `DefaultSkillCatalog` 类

删除 `DefaultSkillCatalog` 类和 `escapeXml` 函数。保留纯接口定义。

- [ ] **Step 6: 修改 `plugins/skill/file/index.ts`** — 更新 DefaultSkillCatalog 引用

```typescript
import { DefaultSkillCatalog } from '../default-catalog.js';
```

- [ ] **Step 7: 创建 `edit-schemas.ts`** 和 `edit-recovery.ts`**

从 `edit.ts` 提取 schema 定义（`replaceEditSchema`, `editSchema`）和恢复逻辑（`didEditLikelyApply`, `removeExactOccurrences`, `appendMismatchHint`）。修改 `edit.ts` 从这两个新文件导入。

- [ ] **Step 8: 运行 typecheck + test**

```bash
pnpm typecheck
pnpm --filter rem-agent-core test
```

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/plugins/ packages/core/src/sdk/skill-provider.ts
git commit -m "refactor: extract session base, skill catalog, edit schemas/recovery"
```

---

### Task A9: 修复 alsoAllow Bug

**Files:**
- Modify: `packages/core/src/security/tool-policy-pipeline.ts`

- [ ] **Step 1: 修改 `applyLayer` 函数**

```typescript
function applyLayer(
  tools: ToolDefinition[],
  layer: { allow?: string[]; alsoAllow?: string[]; deny?: string[] },
): ToolDefinition[] {
  const hasAllow = layer.allow !== undefined;
  const hasAlsoAllow = layer.alsoAllow !== undefined;

  if (!hasAllow && !hasAlsoAllow) {
    // 无 allow/alsoAllow 策略，不过滤
  } else {
    const allowSet = new Set(expandToolGroups(layer.allow ?? []));
    const alsoAllowSet = new Set(expandToolGroups(layer.alsoAllow ?? []));
    const combined = new Set([...allowSet, ...alsoAllowSet]);

    if (combined.size > 0) {
      tools = tools.filter(t => combined.has(normalizeToolName(t.name)));
    }
  }

  if (layer.deny && layer.deny.length > 0) {
    const denySet = new Set(expandToolGroups(layer.deny));
    tools = tools.filter(t => !denySet.has(normalizeToolName(t.name)));
  }

  return tools;
}
```

- [ ] **Step 2: 运行 typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/security/tool-policy-pipeline.ts
git commit -m "fix: alsoAllow ignored when allow is empty array"
```

---

### Task A10: Phase A 最终验证

- [ ] **Step 1: 运行全仓 typecheck**

```bash
pnpm typecheck
```

预期：Core 层所有报错解决。Bridge/Web/TUI 层可能仍有报错（因为 Core 删除了 CoreAgent 的导出），这是预期的，将在 Phase B/C/D 中修复。

- [ ] **Step 2: 运行 Core 测试**

```bash
pnpm --filter rem-agent-core test
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: Phase A complete - core boundary fixes and splits"
```

---

## Phase B: Bridge 层 (12 文件变更)

(由于篇幅限制，Phase B-E 将在后续补充完整。当前 Phase A 的 10 个 Task 覆盖了 Core 层全部 27 个文件变更。)

### Task B1: 创建 IAgentService 接口

### Task B2: 重写 client.ts → agent-remote-service.ts

### Task B3: 重命名 agent.ts → agent-service.ts + 拆分

### Task B4: 创建 stream-reducer.ts

### Task B5: 更新 bridge index.ts 和其他引用的文件

### Task B6: Phase B 验证

---

## Phase C: Web 层 (7 文件变更)

### Task C1: 删除 agent-client.ts + stream-parser.ts

### Task C2: 修改 container.ts, session-store.ts, use-sse.ts, types.ts, route.ts

### Task C3: Phase C 验证

---

## Phase D: TUI 层 (4 文件变更)

### Task D1: 拆分 app.ts → ui-layout.ts + session-picker.ts + commands.ts

### Task D2: TUIApp 构造函数改为接收 IAgentService

### Task D3: Phase D 验证

---

## Phase E: Demo 删除 + 清理

### Task E1: 删除 demo 包

### Task E2: 清理 workspace 和文档引用

### Task E3: 全仓最终验证

---

*Plan: Phase A 完成，Phase B-E 待补充*
