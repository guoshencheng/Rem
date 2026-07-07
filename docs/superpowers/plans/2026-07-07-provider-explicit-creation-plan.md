# Provider 显式化创建 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 去掉 Provider 动态加载机制，改为显式创建；需要 Config 的 Provider 通过构造函数注入 ConfigProvider。

**Architecture:** 删除 `ProviderLoader`、`ProviderRegistry`、`ProviderManager` 三层抽象。`createAgentFromEnv` 成为唯一组装入口，内部显式 `new` 所有 Provider。`run-agent.ts` 通过 `AgentContext` 结构体接收所有 Provider 实例。

**Tech Stack:** TypeScript, `rem-agent-core` / `rem-agent-bridge`

## Global Constraints

- Provider 配置由 Core 拥有（CLAUDE.md 红线 1）
- 模块拆分遵循 module-separation-convention（CLAUDE.md 红线 2）
- Core 不依赖 Vercel AI SDK（CLAUDE.md 红线 3）
- 所有修改在 `packages/core` 和 `packages/bridge` 和 `packages/web` 范围内

---

### Task 1: 更新 Provider 构造函数 — 注入 ConfigProvider

**Files:**
- Modify: `packages/core/src/plugins/memory/simple/index.ts`
- Modify: `packages/core/src/plugins/tool/file-system/index.ts`
- Modify: `packages/core/src/plugins/skill/file/index.ts`
- Modify: `packages/core/src/plugins/budget/fixed/index.ts`
- Modify: `packages/core/src/plugins/title/llm/index.ts`
- Modify: `packages/core/src/sdk/title-provider.ts`

**Interfaces:**
- Consumes: `ConfigProvider` from `sdk/config-provider.js`
- Produces: Updated constructors that accept `ConfigProvider`, old `createProvider`/`getDefaultOptions` temporarily kept

- [ ] **Step 1: 更新 `SimpleContextProvider` 构造函数**

编辑 `packages/core/src/plugins/memory/simple/index.ts`，将构造函数改为接收 `ConfigProvider`：

```typescript
import type { ContextProvider } from '../../../sdk/context-provider.js';
import type { MemoryProvider, MemoryContext } from '../../../sdk/memory-provider.js';
import type { ModelMessage } from '../../../types.js';
import type { Session } from '../../../session.js';
import type { ConfigProvider } from '../../../sdk/config-provider.js';

export class SimpleContextProvider implements ContextProvider, MemoryProvider {
  private agentName: string;

  constructor(configProvider: ConfigProvider) {
    this.agentName = configProvider.getBehaviorConfig().name;
  }

  async build(session: Session, _agentName: string): Promise<{ system: string; messages: ModelMessage[] }> {
    const ctx = await this.buildContext(session, _agentName);
    return { system: ctx.systemPrompt, messages: ctx.messages };
  }

  async buildContext(session: Session, agentName: string): Promise<MemoryContext> {
    return {
      systemPrompt: `You are ${this.agentName}.`,
      messages: session.conversation,
    };
  }
}

export { SimpleContextProvider as SimpleMemoryProvider };
```

- [ ] **Step 2: 更新 `FileSystemTools` — 改为接收 `ConfigProvider`**

编辑 `packages/core/src/plugins/tool/file-system/index.ts`，修改 `createFileSystemTools` 函数签名：

```typescript
import { AgentToolRegistry } from '../../../registry/tool-registry.js';
import type { ToolPolicyLike } from '../../../sdk/tool-policy.js';
import type { ConfigProvider } from '../../../sdk/config-provider.js';
import { createReadToolDefinition, createReadToolExecutor } from './read.js';
import { createWriteToolDefinition, createWriteToolExecutor } from './write.js';
import { createEditToolDefinition, createEditToolExecutor } from './edit.js';
import { createLsToolDefinition, createLsToolExecutor } from './ls.js';
import { createExecToolDefinition, createExecToolExecutor } from './exec.js';

export function createFileSystemTools(configProvider: ConfigProvider): AgentToolRegistry {
  const behavior = configProvider.getBehaviorConfig();
  const toolCfg = configProvider.getToolConfig();
  const registry = new AgentToolRegistry({
    workspaceRoot: behavior.workspaceRoot,
    readOnly: behavior.readOnly,
    policy: toolCfg.policy,
  });

  registry.register(createReadToolDefinition(), createReadToolExecutor());
  registry.register(createLsToolDefinition(), createLsToolExecutor());
  registry.register(createExecToolDefinition(), createExecToolExecutor());

  if (!behavior.readOnly) {
    registry.register(createWriteToolDefinition(), createWriteToolExecutor());
    registry.register(createEditToolDefinition(), createEditToolExecutor());
  }

  return registry;
}
```

删除 `FileSystemToolsOptions` 接口、`createProvider` 和 `getDefaultOptions` 导出。

- [ ] **Step 3: 更新 `FileSkillProvider` 构造函数**

编辑 `packages/core/src/plugins/skill/file/index.ts`，构造函数改为接收 `ConfigProvider`：

```typescript
import { readdir, readFile, stat } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import type { Skill, SkillProvider } from '../../../sdk/skill-provider.js';
import type { ConfigProvider } from '../../../sdk/config-provider.js';
import { DefaultSkillCatalog } from '../default-catalog.js';
import { parseSkillMarkdown } from '../../../utils/skill-parser.js';

const AGENT_DIR_NAME = '.agents';
const SKILLS_DIR_NAME = 'skills';

export class FileSkillProvider implements SkillProvider {
  private homeSkillsDir: string;
  private workspaceSkillsDir: string;
  private catalog = new DefaultSkillCatalog();

  constructor(configProvider: ConfigProvider) {
    const workspaceRoot = configProvider.getBehaviorConfig().workspaceRoot;
    this.homeSkillsDir = resolveHomeSkillsDir();
    this.workspaceSkillsDir = resolveWorkspaceSkillsDir(workspaceRoot);
  }

  // ... 其余方法保持不变 ...
}

function resolveHomeSkillsDir(): string {
  return join(homedir(), AGENT_DIR_NAME, SKILLS_DIR_NAME);
}

function resolveWorkspaceSkillsDir(workspaceRoot: string): string {
  return join(workspaceRoot, AGENT_DIR_NAME, SKILLS_DIR_NAME);
}
```

删除 `FileSkillProviderOptions` 接口、`createProvider` 和 `getDefaultOptions` 导出。

- [ ] **Step 4: 更新 `FixedBudgetPolicy` 构造函数**

编辑 `packages/core/src/plugins/budget/fixed/index.ts`：

```typescript
import type { BudgetPolicy, BudgetStatus } from '../../../sdk/budget-policy.js';
import type { AgentLiveState } from '../../../state.js';
import type { ConfigProvider } from '../../../sdk/config-provider.js';

export class FixedBudgetPolicy implements BudgetPolicy {
  private maxTurns: number;
  private timeoutMs: number;

  constructor(configProvider: ConfigProvider) {
    const behavior = configProvider.getBehaviorConfig();
    this.maxTurns = behavior.maxTurns;
    this.timeoutMs = 300_000;
  }

  // ... checkTurn/checkTimeout/shouldCircuitBreak/getStatus 保持不变 ...
}
```

删除 `FixedBudgetConfig` 接口、`createProvider` 和 `getDefaultOptions` 导出。

- [ ] **Step 5: 更新 `LLMTitleProvider` + `TitleProvider` 接口**

编辑 `packages/core/src/sdk/title-provider.ts`，简化接口（config 由 Provider 内部管理）：

```typescript
import type { ModelMessage } from '../types.js';

export interface TitleProvider {
  generateTitle(conversation: ModelMessage[]): Promise<string | undefined>;
}
```

编辑 `packages/core/src/plugins/title/llm/index.ts`：

```typescript
import type { TitleProvider } from '../../../sdk/title-provider.js';
import type { ConfigProvider } from '../../../sdk/config-provider.js';
import type { ModelMessage } from '../../../types.js';
import { InferenceEngine } from '../../../llm/engine.js';
import { resolveProvider } from '../../../llm/api-registry.js';

export class LLMTitleProvider implements TitleProvider {
  private configProvider: ConfigProvider;

  constructor(configProvider: ConfigProvider) {
    this.configProvider = configProvider;
  }

  async generateTitle(conversation: ModelMessage[]): Promise<string | undefined> {
    const userMessages = conversation.filter(m => m.role === 'user');
    if (userMessages.length === 0) return undefined;

    const modelConfig = this.configProvider.getModelConfig();

    const messages = userMessages.map(m => ({
      role: m.role,
      content: [{ type: 'text', text: m.content.filter(p => p.type === 'text').map(p => p.text).join(' ') || JSON.stringify(m.content) }],
    })) as ModelMessage[];

    const provider = resolveProvider(modelConfig.provider);
    const rawStream = provider.stream({
      model: modelConfig.model,
      apiKey: modelConfig.apiKey,
      baseURL: modelConfig.baseURL,
      system: TITLE_SYSTEM_PROMPT,
      messages,
      maxTokens: 50,
      temperature: 0.3,
    });

    const engine = new InferenceEngine();
    try {
      const result = await engine.infer({ messages, stream: rawStream });
      const title = result.text.trim().slice(0, 50);
      return title || undefined;
    } catch {
      return undefined;
    }
  }
}
```

删除 `createProvider` 导出。保留 `TITLE_SYSTEM_PROMPT` 常量。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/plugins/memory/simple/index.ts \
        packages/core/src/plugins/tool/file-system/index.ts \
        packages/core/src/plugins/skill/file/index.ts \
        packages/core/src/plugins/budget/fixed/index.ts \
        packages/core/src/plugins/title/llm/index.ts \
        packages/core/src/sdk/title-provider.ts
git commit -m "refactor(core): inject ConfigProvider into Provider constructors

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 添加 `AgentContext` 类型并重写 `createAgentFromEnv`

**Files:**
- Create: `packages/core/src/agent-context.ts`
- Modify: `packages/core/src/agent-factory.ts`

**Interfaces:**
- Consumes: All updated Provider constructors from Task 1
- Produces: `AgentContext` type, new `createAgentFromEnv` that returns `AgentContext`

- [ ] **Step 1: 创建 `AgentContext` 类型**

创建 `packages/core/src/agent-context.ts`：

```typescript
import type { ConfigProvider } from './sdk/config-provider.js';
import type { SessionProvider } from './sdk/session-provider.js';
import type { AgentLiveProvider } from './sdk/agent-state-provider.js';
import type { ToolProvider } from './sdk/tool-provider.js';
import type { ContextProvider } from './sdk/context-provider.js';
import type { SkillProvider } from './sdk/skill-provider.js';
import type { BudgetPolicy } from './sdk/budget-policy.js';
import type { ContextCompressor } from './sdk/compressor.js';
import type { ErrorHandler } from './sdk/error-handler.js';
import type { TitleProvider } from './sdk/title-provider.js';
import type { LoopStrategy } from './sdk/loop-strategy.js';
import type { McpConnectionManager } from './mcp/connection-manager.js';

export interface AgentContext {
  configProvider: ConfigProvider;
  sessionProvider: SessionProvider;
  agentLiveProvider: AgentLiveProvider;
  toolProvider: ToolProvider;
  contextProvider: ContextProvider;
  skillProvider: SkillProvider;
  budgetPolicy: BudgetPolicy;
  compressor: ContextCompressor;
  errorHandler: ErrorHandler;
  titleProvider: TitleProvider;
  loopStrategy: LoopStrategy;
  mcpManager: McpConnectionManager;
}
```

- [ ] **Step 2: 重写 `createAgentFromEnv`**

重写 `packages/core/src/agent-factory.ts`：

```typescript
import { registerBuiltInProviders } from './llm/providers/index.js';
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
import { CompositeToolProvider } from './mcp/composite-tool-provider.js';
import {
  createReadSkillToolDefinition,
  createReadSkillToolExecutor,
} from './plugins/tool/builtin/skill-read.js';
import type { AgentContext } from './agent-context.js';

export interface CreateAgentOptions {
  name?: string;
  configPath?: string;
  maxTurns?: number;
  workspaceRoot?: string;
  readOnly?: boolean;
  autoApproveDangerous?: boolean;
}

export async function createAgentFromEnv(options?: CreateAgentOptions): Promise<AgentContext> {
  registerBuiltInProviders();

  // 1. ConfigProvider
  const configProvider = new DefaultConfigProvider({
    configPath: options?.configPath,
    overrides: {
      name: options?.name,
      maxTurns: options?.maxTurns,
      workspaceRoot: options?.workspaceRoot,
      readOnly: options?.readOnly,
      autoApproveDangerous: options?.autoApproveDangerous,
    },
  });
  await configProvider.init();

  // 2. 显式创建所有 Provider
  const sessionProvider = new InMemorySessionProvider();
  const agentLiveProvider = new InMemoryAgentLiveProvider();
  const toolProvider = createFileSystemTools(configProvider);
  const contextProvider = new SimpleContextProvider(configProvider);
  const skillProvider = new FileSkillProvider(configProvider);
  const budgetPolicy = new FixedBudgetPolicy(configProvider);
  const compressor = new NoOpCompressor();
  const errorHandler = new SimpleErrorHandler();
  const titleProvider = new LLMTitleProvider(configProvider);
  const loopStrategy = new ReactLoop();

  // 3. MCP
  const mcpConfig = configProvider.getMcpConfig();
  const mcpManager = new McpConnectionManager();
  const mcpProviders = await mcpManager.connectAll(mcpConfig);
  const effectiveToolProvider = mcpProviders.length > 0
    ? new CompositeToolProvider(toolProvider, mcpProviders)
    : toolProvider;

  // 4. read_skill
  effectiveToolProvider.register(
    createReadSkillToolDefinition(),
    createReadSkillToolExecutor(() => skillProvider),
  );

  return {
    configProvider,
    sessionProvider,
    agentLiveProvider,
    toolProvider: effectiveToolProvider,
    contextProvider,
    skillProvider,
    budgetPolicy,
    compressor,
    errorHandler,
    titleProvider,
    loopStrategy,
    mcpManager,
  };
}
```

- [ ] **Step 3: 提交**

```bash
git add packages/core/src/agent-context.ts packages/core/src/agent-factory.ts
git commit -m "feat(core): add AgentContext type and rewrite createAgentFromEnv

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 更新 `run-agent.ts` — 从 `pm` 迁移到 `AgentContext`

**Files:**
- Modify: `packages/core/src/run-agent.ts`

**Interfaces:**
- Consumes: `AgentContext` from Task 2
- Produces: Updated `RunAgentParams` using `ctx: AgentContext`

- [ ] **Step 1: 重写 `run-agent.ts` 的类型和实现**

编辑 `packages/core/src/run-agent.ts`，将所有 `pm.require<T>(kind)` / `pm.get<T>(kind)` 替换为从 `ctx` 直接访问：

关键变更：
- 导入 `AgentContext` 替代 `ProviderManager`
- `RunAgentParams.pm` → `RunAgentParams.ctx`
- 所有 `pm.require<XxxProvider>('xxx')` → `ctx.xxxProvider`
- 所有 `pm.get<XxxProvider>('xxx')` → `ctx.xxxProvider`
- `pm.getBehaviorConfig()` → `ctx.configProvider.getBehaviorConfig()`
- `pm.getModelConfig()` → `ctx.configProvider.getModelConfig()`
- `forkTitleGeneration` 不再需要传递 modelConfig，`LLMTitleProvider` 内部获取

```typescript
import type { UserInput, AgentOutput, AgentStream, ModelMessage } from './types.js';
import { AgentLiveState } from './state.js';
import { EventBus } from './events.js';
import type { Session } from './session.js';
import type { LoopStrategy, LoopContext } from './sdk/loop-strategy.js';
import type { SessionProvider } from './sdk/session-provider.js';
import type { ContextProvider } from './sdk/context-provider.js';
import type { ContextCompressor } from './sdk/compressor.js';
import type { BudgetPolicy } from './sdk/budget-policy.js';
import type { TitleProvider } from './sdk/title-provider.js';
import type { ToolProvider, ToolCall, ToolResult } from './sdk/tool-provider.js';
import type { SkillProvider } from './sdk/skill-provider.js';
import type { ErrorHandler } from './sdk/error-handler.js';
import { AgentStreamController } from './stream/agent-stream.js';
import type { AgentContext } from './agent-context.js';
import { generateId } from './shared/generate-id.js';
import { reason } from './reason/reason.js';
import { executeTools } from './execute/execute-tools.js';
import type { ApprovalRegistry } from './execute/approval-registry.js';
import type { AgentLiveProvider } from './sdk/agent-state-provider.js';

export interface RunAgentParams {
  input: UserInput;
  sessionId: string;
  signal?: AbortSignal;
  ctx: AgentContext;
  approvalRegistry?: ApprovalRegistry;
}

export interface RunAgentResult {
  stream: AgentStream;
  output: Promise<AgentOutput>;
}

export function runAgent(params: RunAgentParams): RunAgentResult {
  const controller = new AgentStreamController();
  const stream = controller.stream;

  const outputPromise = (async (): Promise<AgentOutput> => {
    const ctx = params.ctx;
    const behavior = ctx.configProvider.getBehaviorConfig();
    const modelConfig = ctx.configProvider.getModelConfig();

    const sessionProvider = ctx.sessionProvider;
    let session = await sessionProvider.load(params.sessionId);
    if (!session) {
      session = {
        sessionId: params.sessionId, conversation: [], currentTurn: 0, metadata: {},
        createdAt: new Date(), updatedAt: new Date(),
      };
      await sessionProvider.save(session);
    }

    const events = new EventBus();
    const liveState = new AgentLiveState(undefined, events);
    liveState.start();

    if (!ctx.budgetPolicy.checkTurn(liveState) || !ctx.budgetPolicy.checkTimeout(Date.now())) {
      liveState.finish();
      const output: AgentOutput = { content: 'Budget exceeded.', completed: true };
      controller.finish(output);
      return output;
    }

    session.conversation.push({
      id: generateId(), role: 'user',
      content: [{ type: 'text', text: params.input.content }],
    } as ModelMessage);
    await sessionProvider.save(session);

    forkTitleGeneration(session, ctx.titleProvider, controller, sessionProvider);

    try {
      const contextProvider = ctx.contextProvider;
      const compressor = ctx.compressor;
      const loopStrategy = ctx.loopStrategy;
      const toolProvider = ctx.toolProvider;
      const skillProvider = ctx.skillProvider;
      const errorHandler = ctx.errorHandler;
      const addMessage = (role: 'assistant' | 'tool') => sessionProvider.addMessage(session, role);
      const appendContent = (msg: ModelMessage, part: any) => sessionProvider.appendContent(session, msg, part);

      const { system, messages } = await contextProvider.build(session, behavior.name);

      let msgs = compressor.shouldCompress(session) ? await compressor.compress(messages) : messages;

      let systemWithSkills = system;
      try {
        const skills = await skillProvider.loadSkills();
        const catalog = skillProvider.formatCatalog(skills);
        if (catalog) systemWithSkills = `${system}\n\n${catalog}`;
      } catch { /* best-effort */ }

      const loopCtx: LoopContext = {
        liveState,
        messages: msgs,
        addMessage,
        appendContent,
        system: systemWithSkills,
        reason: () => reason(
          {
            provider: modelConfig.provider, model: modelConfig.model, apiKey: modelConfig.apiKey,
            baseURL: modelConfig.baseURL, system: systemWithSkills, messages: msgs,
            tools: toolProvider.getToolSet(), signal: params.signal, errorHandler,
          },
          (chunk) => controller.emit(chunk),
        ),
        execute: (calls: ToolCall[]): Promise<ToolResult[]> => executeTools({
          toolCalls: calls, toolProvider, addMessage, appendContent,
          liveProvider: ctx.agentLiveProvider,
          registry: params.approvalRegistry,
          workspaceRoot: behavior.workspaceRoot, agentName: behavior.name,
          readOnly: behavior.readOnly, sessionId: params.sessionId, signal: params.signal,
          emit: (chunk) => controller.emit(chunk),
        }),
        emit: (chunk) => controller.emit(chunk),
        signal: params.signal, maxSteps: behavior.maxTurns,
        workspaceRoot: behavior.workspaceRoot, readOnly: behavior.readOnly,
        agentName: behavior.name, sessionId: params.sessionId,
      };

      const result = await loopStrategy.run(loopCtx);

      session.currentTurn++;
      liveState.finish();
      await sessionProvider.save(session);

      const output: AgentOutput = { content: result.content, completed: true };
      controller.finish(output);
      return output;
    } catch (error) {
      liveState.fail(error);
      const message = error instanceof Error ? error.message : String(error);
      const output: AgentOutput = { content: `Error: ${message}`, completed: true };
      controller.finish(output);
      await sessionProvider.save(session);
      return output;
    }
  })();

  return { stream, output: outputPromise };
}

function forkTitleGeneration(
  session: Session,
  titleProvider: TitleProvider,
  controller: AgentStreamController,
  sessionProvider: SessionProvider,
): void {
  if (session.metadata.title) return;
  (async () => {
    try {
      const title = await titleProvider.generateTitle(session.conversation);
      if (title) { session.metadata.title = title; controller.pushTitle(title); await sessionProvider.save(session); }
    } catch { /* best-effort */ }
  })();
}
```

- [ ] **Step 2: 提交**

```bash
git add packages/core/src/run-agent.ts
git commit -m "refactor(core): migrate runAgent from ProviderManager to AgentContext

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 更新 bridge `AgentService`

**Files:**
- Modify: `packages/bridge/src/agent.ts`

**Interfaces:**
- Consumes: `AgentContext` from Task 2, `runAgent` new signature from Task 3
- Produces: `AgentService` that accepts individual providers instead of `ProviderManager`

- [ ] **Step 1: 重写 `AgentService` 构造函数**

编辑 `packages/bridge/src/agent.ts`：

```typescript
import type { AgentStreamChunk, SessionProvider, ApprovalDecision, ApprovalRequest, AgentLiveProvider, AgentContext } from 'rem-agent-core';
import { runAgent as coreRunAgent, ApprovalRegistry } from 'rem-agent-core';
import { ServiceError } from './errors.js';
import { bus } from './broadcast-bus.js';
import { runRegistry } from './run-registry.js';
import type { BusEvent, SessionActivity, SessionSummary, SessionUpdate, UIMessage } from './types.js';
import type { IAgentService } from './agent-service.interface.js';
import { AgentSessionManager } from './agent-session.js';
import { SessionActivityTracker } from './session-activity-tracker.js';
import { streamingSnapshots } from './streaming-snapshots.js';
import { reduceStreamChunk } from './stream-reducer.js';

export class AgentService implements IAgentService {
  private sessionProvider: SessionProvider;
  private agentLiveProvider: AgentLiveProvider;
  private ctx: AgentContext;
  private workspace: string;
  private sessionManager: AgentSessionManager;
  private activityTracker: SessionActivityTracker;
  private approvalRegistry = new ApprovalRegistry();

  constructor(ctx: AgentContext, workspace = 'default') {
    this.ctx = ctx;
    this.sessionProvider = ctx.sessionProvider;
    this.agentLiveProvider = ctx.agentLiveProvider;
    this.workspace = workspace;
    this.sessionManager = new AgentSessionManager(this.sessionProvider);
    this.activityTracker = new SessionActivityTracker((sessionId, activity) => {
      bus.publish({
        workspace: this.workspace,
        sessionId,
        type: 'activity-change',
        activity,
      });
    });
  }

  async run(sessionId: string, input: string): Promise<void> {
    // ... 其余逻辑不变，只改 runAgent 调用处从 pm 改为 ctx
    const result = coreRunAgent({
      input: { content: input, timestamp: new Date() },
      sessionId,
      signal: abortController.signal,
      ctx: this.ctx,
      approvalRegistry: this.approvalRegistry,
    });
    // ...
  }

  async listPendingApprovals(sessionId: string): Promise<ApprovalRequest[]> {
    const liveState = await this.agentLiveProvider.get(sessionId);
    return liveState?.pendingApprovals ?? [];
  }

  // ... 其余方法不变
}
```

- [ ] **Step 2: 提交**

```bash
git add packages/bridge/src/agent.ts
git commit -m "refactor(bridge): adapt AgentService to use AgentContext

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 更新 web `container.ts`

**Files:**
- Modify: `packages/web/src/lib/container.ts`

**Interfaces:**
- Consumes: new `createAgentFromEnv` return type, new `AgentService` constructor
- Produces: Updated DI container configuration

- [ ] **Step 1: 适配新的创建方式**

编辑 `packages/web/src/lib/container.ts`：

```typescript
import { createContainer, asFunction, Lifetime, type AwilixContainer } from 'awilix';
import { AgentService, BridgeAgentStateProvider } from 'rem-agent-bridge';
import { createAgentFromEnv } from 'rem-agent-core';

const GLOBAL_CONTAINER_KEY = '__REM_AGENT_CONTAINER__';

async function configureContainer(): Promise<AwilixContainer> {
  const container = createContainer();

  const ctx = await createAgentFromEnv({
    workspaceRoot: process.cwd(),
  });
  console.log('[Container] LLM config:', {
    model: ctx.configProvider.getModelConfig().model,
    provider: ctx.configProvider.getModelConfig().provider,
    hasApiKey: !!ctx.configProvider.getModelConfig().apiKey,
    baseURL: ctx.configProvider.getModelConfig().baseURL,
  });

  container.register({
    agentService: asFunction(() => new AgentService(ctx), {
      lifetime: Lifetime.SINGLETON,
    }),
  });

  return container;
}

// ... 其余不变
```

- [ ] **Step 2: 提交**

```bash
git add packages/web/src/lib/container.ts
git commit -m "refactor(web): adapt container to new createAgentFromEnv

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 删除旧的基础设施

**Files:**
- Delete: `packages/core/src/sdk/provider-loader.ts`
- Delete: `packages/core/src/registry/provider-loader.ts`
- Delete: `packages/core/src/registry/provider-registry.ts`
- Delete: `packages/core/src/provider-manager.ts`
- Modify: `packages/core/src/plugins/index.ts`
- Modify: `packages/core/src/sdk/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 删除 4 个文件**

```bash
rm packages/core/src/sdk/provider-loader.ts
rm packages/core/src/registry/provider-loader.ts
rm packages/core/src/registry/provider-registry.ts
rm packages/core/src/provider-manager.ts
```

- [ ] **Step 2: 更新 `plugins/index.ts` — 删除 `builtinLoaders` 和 `resolveBuiltinLoader`**

编辑 `packages/core/src/plugins/index.ts`，移除动态加载部分，只保留静态导出：

```typescript
export { FixedBudgetPolicy } from './budget/fixed/index.js';
export { NoOpCompressor } from './compressor/no-op/index.js';
export { DefaultConfigProvider } from './config/default/index.js';
export { SimpleErrorHandler } from './error/simple/index.js';
export { SimpleMemoryProvider } from './memory/simple/index.js';
export { InMemorySessionProvider } from './session/in-memory/index.js';
export { FileSessionProvider } from './session/file/index.js';
export { LocalSessionProvider } from './session/local/index.js';
export { FileSkillProvider } from './skill/file/index.js';
export { createFileSystemTools } from './tool/file-system/index.js';
export { InMemoryToolProvider } from './tool/in-memory/index.js';
```

- [ ] **Step 3: 更新 `sdk/index.ts` — 移除 `provider-loader` 重导出**

编辑 `packages/core/src/sdk/index.ts`，删除 `export * from './provider-loader.js';` 行。

- [ ] **Step 4: 更新 `core/index.ts` — 移除已删除模块的重导出**

编辑 `packages/core/src/index.ts`，删除：
- `export * from './provider-manager.js';`
- `export { createProviderManager } from './provider-manager.js';`
- `export * from './registry/provider-loader.js';`
- `export * from './registry/provider-registry.js';`

添加：
- `export type { AgentContext } from './agent-context.js';`

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/sdk/provider-loader.ts \
        packages/core/src/registry/provider-loader.ts \
        packages/core/src/registry/provider-registry.ts \
        packages/core/src/provider-manager.ts \
        packages/core/src/plugins/index.ts \
        packages/core/src/sdk/index.ts \
        packages/core/src/index.ts
git commit -m "refactor(core): remove ProviderLoader, ProviderRegistry, and ProviderManager

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: 更新插件文件 — 移除旧的工厂函数残留

**Files:**
- Modify: `packages/core/src/plugins/memory/simple/index.ts`
- Modify: `packages/core/src/plugins/tool/file-system/index.ts`
- Modify: `packages/core/src/plugins/skill/file/index.ts`
- Modify: `packages/core/src/plugins/budget/fixed/index.ts`
- Modify: `packages/core/src/plugins/title/llm/index.ts`
- Modify: `packages/core/src/plugins/session/file/index.ts`
- Modify: `packages/core/src/plugins/session/local/index.ts`
- Modify: `packages/core/src/plugins/loop/react/index.ts`
- Modify: `packages/core/src/plugins/config/default/index.ts`
- Modify: `packages/core/src/plugins/error/simple/index.ts`
- Modify: `packages/core/src/plugins/compressor/no-op/index.ts`
- Modify: `packages/core/src/plugins/tool/in-memory/index.ts`

- [ ] **Step 1: 从各插件文件中删除 `createProvider` 和 `getDefaultOptions` 导出**

对以下文件，删除 `createProvider` 和 `getDefaultOptions` 函数导出：

- `packages/core/src/plugins/memory/simple/index.ts` — 已经在 Task 1 Step 1 中处理
- `packages/core/src/plugins/tool/file-system/index.ts` — 已经在 Task 1 Step 2 中处理
- `packages/core/src/plugins/skill/file/index.ts` — 已经在 Task 1 Step 3 中处理
- `packages/core/src/plugins/budget/fixed/index.ts` — 已经在 Task 1 Step 4 中处理
- `packages/core/src/plugins/title/llm/index.ts` — 已经在 Task 1 Step 5 中处理
- `packages/core/src/plugins/session/file/index.ts` — 删除 `createProvider` 和 `getDefaultOptions`
- `packages/core/src/plugins/session/local/index.ts` — 删除 `createProvider` 和 `getDefaultOptions`
- `packages/core/src/plugins/loop/react/index.ts` — 删除 `createProvider`
- `packages/core/src/plugins/config/default/index.ts` — 删除 `createProvider`

对不需要 Config 的插件（error/simple, compressor/no-op, tool/in-memory），直接删除 `createProvider` 和 `getDefaultOptions`。

如果这些文件导入了 `ProviderLoaderContext`，也一并删除该 import。

- [ ] **Step 2: 提交**

```bash
git add packages/core/src/plugins/
git commit -m "refactor(core): remove createProvider/getDefaultOptions from all plugins

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: 更新测试

**Files:**
- Modify: `packages/core/tests/run-agent.test.ts`
- Delete: `packages/core/tests/provider-manager.test.ts`
- Delete: `packages/core/tests/provider-loader.test.ts`
- Delete: `packages/core/tests/sdk/provider-loader.test.ts`
- Delete: `packages/core/tests/fixtures/custom-memory-provider.ts`

- [ ] **Step 1: 更新 `run-agent.test.ts`**

将 mock `ProviderManager` 替换为 mock `AgentContext`：

```typescript
import { describe, it, expect } from 'vitest';
import type { AgentContext } from '../src/agent-context.js';

describe('runAgent', () => {
  it('returns a stream and output promise', async () => {
    const mockCtx = {
      configProvider: {
        getBehaviorConfig: () => ({ name: 'test', maxTurns: 1, workspaceRoot: '/tmp', readOnly: false, sessionsDir: '/tmp/.sessions', autoApproveDangerous: false }),
        getModelConfig: () => ({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test', baseURL: undefined }),
        getToolConfig: () => ({}),
        getMcpConfig: () => ({}),
      },
      sessionProvider: { load: async () => null, save: async () => {}, addMessage: () => ({} as any), appendContent: () => {} },
      agentLiveProvider: { get: () => null, getOrCreate: () => ({} as any), set: () => {} },
      toolProvider: { getToolSet: () => ({}), register: () => {} },
      contextProvider: { build: async () => ({ system: 'You are test.', messages: [] }) },
      skillProvider: { loadSkills: async () => [], formatCatalog: () => '' },
      budgetPolicy: { checkTurn: () => true, checkTimeout: () => true, shouldCircuitBreak: () => false, getStatus: () => ({ turnsRemaining: 1, consecutiveErrors: 0, atRisk: false }) },
      compressor: { shouldCompress: () => false, compress: async (msgs: unknown[]) => msgs },
      errorHandler: { classify: () => 'unknown', isRetryable: () => false },
      titleProvider: { generateTitle: async () => undefined },
      loopStrategy: {
        run: async () => ({
          content: 'hello back',
          newMessages: [],
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        }),
      },
      mcpManager: { connectAll: async () => [], closeAll: async () => {} },
    } as unknown as AgentContext;

    const { runAgent } = await import('../src/run-agent.js');
    const result = runAgent({
      input: { content: 'hello', timestamp: new Date() },
      sessionId: 'test-session',
      ctx: mockCtx,
    });
    expect(result.stream).toBeDefined();
    expect(result.output).toBeInstanceOf(Promise);

    for await (const _chunk of result.stream.fullStream) {
      // drain
    }

    const output = await result.output;
    expect(output.completed).toBe(true);
  });
});
```

- [ ] **Step 2: 删除旧的测试文件**

```bash
rm packages/core/tests/provider-manager.test.ts
rm packages/core/tests/provider-loader.test.ts
rm packages/core/tests/sdk/provider-loader.test.ts
rm packages/core/tests/fixtures/custom-memory-provider.ts
```

- [ ] **Step 3: 提交**

```bash
git add packages/core/tests/
git commit -m "test(core): update tests for AgentContext, remove obsolete tests

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: 类型检查与测试验证

**Files:** 无新建/修改

- [ ] **Step 1: 运行类型检查**

```bash
pnpm typecheck
```

预期：可能有少量类型错误（bridge 或 web 层对其他已删除类型的引用），逐个修复。

- [ ] **Step 2: 运行测试**

```bash
pnpm test
```

预期：所有保留的测试通过。

- [ ] **Step 3: 修复所有剩余的类型错误**

运行 `pnpm typecheck` 查看错误列表，逐一修复。

常见需要修复的地方：
- `bridge/src/agent.ts` 中可能的其他 `providerManager` 引用
- 任何还在导入 `ProviderManager` 或 `provider-loader` 的文件

- [ ] **Step 4: 最终提交（如有修复）**

```bash
git add -A
git commit -m "fix: resolve type errors from Provider refactor

Co-Authored-By: Claude <noreply@anthropic.com>"
```
