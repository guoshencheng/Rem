# Rem Agent — 模块级参考手册

> 状态：✅ 与代码同步（2026-06-30）
>
> 本文档记录每个包中每个文件/模块的详细职责、关键导出和依赖关系。

---

## 目录

1. [rem-agent-core](#1-rem-agent-core) — 78 个 TypeScript 文件
2. [rem-agent-bridge](#2-rem-agent-bridge) — 8 个 TypeScript 文件
3. [rem-agent-web](#3-rem-agent-web) — 22 个 TypeScript/TSX 文件
4. [rem-agent-tui](#4-rem-agent-tui) — 5 个 TypeScript 文件

---

## 1. rem-agent-core

**包名：** `rem-agent-core` | **入口：** `./dist/index.js`
**依赖：** `openai`, `@anthropic-ai/sdk`, `@sinclair/typebox`, `yaml`

### 1.1 顶层模块

#### `src/index.ts`（23 行）— 主 barrel 导出
重导出所有公开 API：类型（`ModelMessage`, `AgentStreamChunk`, ...）、类（`CoreAgent`, `ReactLoop`, ...）、函数（`createAgentFromEnv`, `runAgent`, ...）。

#### `src/types.ts`（93 行）— 核心类型定义
**关键导出：**
| 类型 | 说明 |
|------|------|
| `ModelMessage` | 模型消息（role + content） |
| `LanguageModelUsage` | Token 使用统计 |
| `UserInput` | 用户输入结构体 |
| `AgentOutput` | Agent 输出结构体 |
| `AgentStreamChunk` | 流式块联合类型（18 个变体：`text-start/delta`, `reasoning-start/delta/finish`, `tool-call-start/call/finish`, `tool-result-start/result`, `finish`, `error`, `session-title`, ...） |
| `AgentStreamStepResult` | 单个流步骤结果 |
| `AgentStream` | 流聚合接口（fullStream, text, usage, steps promises） |
| `AgentStatus` | 状态类型：`'idle' \| 'running' \| 'paused' \| 'stopping' \| 'error'` |
| `ToolCallRecord` | 工具调用记录 |
| `TurnResult` | 轮次执行结果 |

**内部依赖：** 无（叶子模块）

#### `src/core-agent.ts`（449 行）— 核心 Agent 编排器
**关键导出：**
- `CoreAgentConfig` — Agent 配置接口（name, budget, providers, ...）
- `AgentStreamResult` — 运行结果（stream + output promise）
- `CoreAgent` — **核心类**，方法：
  - `ready()` — 检查是否已初始化
  - `initialize({sessionId?})` — 初始化状态、加载会话
  - `run({content})` — 执行一次对话，返回 `AgentStreamResult`
  - `interrupt()` — 中断运行（设置 abort flag）
  - `resolveToolApproval(handleId, decision)` — 审批工具调用
  - `generateTitle(words)` — 为会话生成标题
  - `listSessions()` — 列出历史会话
  - `reset()` — 重置状态
  - `on(event, handler)` / `once(event, handler)` — 事件订阅
- `createAgentFromEnv(name, maxTurns?)` — 从环境变量创建 Agent 的工厂函数

**内部依赖：** 几乎所有其他核心模块（state, events, budget, turn, loop-strategy, llm, sdk, registry, security, stream, plugins, ...）

#### `src/run-agent.ts`（210 行）— 无状态 Agent 运行
**关键导出：**
- `RunAgentParams` — 运行参数（pm, sessionId, input, signal, ...）
- `RunAgentResult` — 运行结果（stream, output）
- `runAgent(params)` — **无状态运行函数**（被 bridge 的 AgentService 调用）

与 `CoreAgent` 的区别：`runAgent` 不管理生命周期，每次调用独立运行。包含并发标题生成逻辑。

**内部依赖：** types, state, events, budget, turn, loop-strategy, sdk, stream, provider-manager, llm

#### `src/state.ts`（59 行）— Agent 运行时状态
**关键导出：**
- `AgentState` — 持有 Session、budget、status
  - `addMessage(msg)` — 添加消息到会话
  - `canContinue()` — 检查状态和预算是否允许继续
  - `reset()` — 重置状态
  - `currentTurn`, `conversation`, `budget`, `status` — 公共属性

**内部依赖：** types, budget, session

#### `src/turn.ts`（123 行）— 轮次执行器
**关键导出：**
- `TurnContext` — 轮次上下文接口
- `TurnRunner` — 轮次执行器接口
- `ReactTurnRunner` — **标准轮次执行器**：在单轮内持有一个 ReactLoop，带 step 限制迭代
- 重新导出 `TurnHooks` 类型

**内部依赖：** types, session, state, budget, loop-strategy, stream

#### `src/events.ts`（57 行）— 事件总线
**关键导出：**
- `AgentEvent` — 事件名称联合类型（20+ 种事件）
- `EventContext` — 事件上下文（state, turnContext?, turnResult?, toolCall?）
- `EventHandler` — 事件处理器类型
- `EventBus` — **事件总线**
  - `on(event, handler, priority?)` — 订阅事件（返回取消函数）
  - `once(event, handler)` — 一次性订阅
  - `emit(event, ctx)` — 触发事件（按优先级顺序执行）

**内部依赖：** state

#### `src/budget.ts`（61 行）— 迭代预算
**关键导出：**
- `BudgetConfig` — 预算配置（maxTurns, maxConsecutiveErrors, maxSameToolFailures）
- `IterationBudget` — **预算追踪器**
  - `checkTurn()` — 消耗一轮，返回是否还有预算
  - `hasBudget()` — 检查剩余预算
  - `recordError(toolName?)` / `recordSuccess(toolName?)` — 记录错误/成功
  - `getStatus()` — 返回 `BudgetStatus`

**内部依赖：** sdk/budget-policy

#### `src/loop-strategy.ts`（290 行）— ReAct 循环
**关键导出：**
- `TurnHooks` — 轮次钩子接口
- `LoopContext` — 循环上下文接口
- `LoopResult` — 循环结果
- `LoopStrategy` — **循环策略接口**（可扩展）
- `ReactLoop` — **标准 ReAct 实现**
  - `iterate(ctx)` — 执行一次完整 ReAct 迭代：
    1. `MemoryProvider.buildContext()` — 构建系统提示 + 记忆
    2. `ContextCompressor.shouldCompress()/compress()` — 按需压缩
    3. `InferenceEngine.infer(...)` — 调用 LLM（带 onChunk 流式回调）
    4. `ToolRegistry.execute(calls)` — 执行工具调用
    5. 输出 → `AgentStreamController.enqueue()`
  - 包含重试逻辑、技能上下文注入、错误处理

**内部依赖：** state, events, types, sdk/tool-provider, sdk/memory-provider, sdk/compressor, sdk/error-handler, sdk/skill-provider, budget, llm/engine, llm/types, stream

#### `src/session.ts`（18 行）— 会话接口
**关键导出：**
- `Session` — 会话完整数据（sessionId, conversation, currentTurn, metadata, timestamps）
- `SessionSummary` — 会话摘要（sessionId, title, updatedAt, messageCount）

**内部依赖：** types（仅类型）

#### `src/provider-manager.ts`（143 行）— Provider 门面
**关键导出：**
- `ProviderManagerConfig` — 配置接口
- `ProviderManager` — **统一 Provider 管理器**
  - `init()` — 初始化所有 provider
  - `get<T>(kind)` — 按类型获取 provider（弱类型）
  - `require<T>(kind)` — 按类型获取 provider（抛出异常）
  - `getConfigProvider()` / `getModelConfig()` — 配置快捷方法
- `createProviderManager(options)` — 工厂函数

**内部依赖：** plugins, registry, llm, sdk, config/paths

---

### 1.2 LLM 层（`src/llm/`）

#### `llm/types.ts`（94 行）— LLM 类型
| 导出 | 说明 |
|------|------|
| `ToolSchema` | 工具 schema 接口 |
| `ToolSet` | 工具集合类型 |
| `ProviderConfig` | Provider 配置（id, apiKey, baseURL, model） |
| `GenerateOptions` | 生成选项（model, messages, tools, temperature, maxTokens, onChunk 回调） |
| `GenerateResult` | 生成结果（text, toolCalls, usage, model, provider） |
| `StreamChunk` | 流式块联合类型（5 变体：text, reasoning, tool-call, usage, finish） |
| `StreamCollector` | 流式块累积器类 |
| `collectStream(stream)` | 流式收集函数 |

#### `llm/api-registry.ts`（44 行）— Provider 注册表
| 导出 | 说明 |
|------|------|
| `LLMProvider` | LLM Provider 接口（generate, stream, resolveConfig?） |
| `registerProvider(id, provider)` | 注册 provider |
| `resolveProvider(id)` | 解析 provider |
| `resolveProviderConfig(id, env?)` | 解析 provider 配置（读环境变量） |
| `listProviders()` | 列出所有注册的 provider |
| `clearProviders()` | 清空注册表 |

#### `llm/engine.ts`（56 行）— 推理引擎
| 导出 | 说明 |
|------|------|
| `InferenceOptions` | 推理选项 |
| `InferenceResult` | 推理结果（= GenerateResult） |
| `InferenceEngine` | **核心推理引擎** — `infer(options)` 根据 provider 名称路由，流式调用，收集结果，剥离 thinking 标签 |

**内部依赖：** api-registry, types, partition-stream, shared/text/strip-thinking-tags

#### `llm/partition-stream.ts`（31 行）— 流分区
| 导出 | 说明 |
|------|------|
| `partitionProviderStream(stream)` | 包装 provider 流，使用 `ThinkingTagPartitioner` 分离 text 和 reasoning 块 |

**内部依赖：** types, shared/text/thinking-tag

#### `llm/providers/openai.ts`（223 行）— OpenAI 实现
**导出：** `openaiProvider`（LLMProvider 实例）

**内部函数：**
- `convertToOpenAIMessages()` — 转换内部消息格式 → OpenAI 格式
- `convertToOpenAITools()` — 转换工具定义 → OpenAI 格式
- `parseOpenAIResponse()` — 解析非流式响应
- `parseOpenAIChunk()` — 解析流式块

**依赖：** `openai` SDK, api-registry, types, shared/debug-log

#### `llm/providers/anthropic.ts`（162 行）— Anthropic 实现
**导出：** `anthropicProvider`（LLMProvider 实例）

**内部函数：**
- `convertToAnthropicMessages()` — 转换消息格式 → Anthropic 格式
- `convertToAnthropicTools()` — 转换工具定义 → Anthropic 格式
- `parseAnthropicResponse()` — 解析非流式响应
- `parseAnthropicStreamEvent()` — 解析流式事件

**依赖：** `@anthropic-ai/sdk`, api-registry, types, shared/debug-log

#### `llm/providers/index.ts`（18 行）— 内置 Provider 注册
| 导出 | 说明 |
|------|------|
| `registerBuiltInProviders()` | 注册 OpenAI 和 Anthropic 到全局注册表 |
| `openaiProvider`, `anthropicProvider` | 重新导出 |

---

### 1.3 SDK 接口（`src/sdk/`）— 11 个接口文件

| 文件 | 行数 | 导出 | 说明 |
|------|------|------|------|
| `index.ts` | 12 | barrel 重导出 | 聚合所有 SDK 接口 |
| `provider-loader.ts` | 51 | `ProviderKind`, `ProviderReference`, `ProviderLoader`, `ProviderRegistry`, ... | Provider 加载抽象：定义 10 种 provider kind、引用类型、加载器接口、注册表接口 |
| `tool-provider.ts` | 49 | `ToolContext`, `ToolDefinition<T>`, `ToolExecutor<T>`, `ToolCall`, `ToolResult`, `ToolProvider` | 工具系统核心接口 |
| `memory-provider.ts` | 11 | `MemoryContext`, `MemoryProvider` | 记忆/上下文接口 |
| `session-provider.ts` | 10 | `SessionProvider`（重新导出 `Session`, `SessionSummary`） | 会话持久化接口 |
| `skill-provider.ts` | 47 | `Skill`, `SkillCatalog`, `SkillProvider`, `DefaultSkillCatalog` | 技能系统接口 + 默认 XML 目录格式化器 |
| `config-provider.ts` | 47 | `AgentModelConfig`, `AgentToolConfig`, `AgentBehaviorConfig`, `AgentConfig`, `ConfigProvider`, ... | 配置接口（模型、工具、行为） |
| `compressor.ts` | 7 | `ContextCompressor` | 上下文压缩接口 |
| `error-handler.ts` | 15 | `ErrorCategory`（9 类别）, `ErrorHandler` | 错误分类与重试接口 |
| `budget-policy.ts` | 15 | `BudgetStatus`, `BudgetPolicy` | 预算策略接口 |
| `tool-policy.ts` | 18 | `ToolProfileId`, `ToolPolicyConfig`, `SandboxToolPolicyConfig` | 工具策略配置类型 |
| `tool-hook.ts` | 24 | `ToolHookContext`, `ToolApprovalDecision`, `ToolHookResult`, `ToolHook` | 工具钩子接口 |

---

### 1.4 注册表层（`src/registry/`）

#### `registry/tool-registry.ts`（138 行）— 工具注册表
**导出：** `AgentToolRegistryOptions`, `AgentToolRegistry`

`AgentToolRegistry` 实现 `ToolProvider`，提供：
- `register(tool)` — 注册工具定义
- `getToolSet()` — 获取所有工具 schema
- `execute(calls, ctx)` — 执行工具调用（含 TypeBox 参数校验、策略过滤、审批、钩子管道）
- `getApprovalManager()` — 获取审批管理器

**依赖：** `@sinclair/typebox`, sdk/*, security/*

#### `registry/provider-registry.ts`（101 行）— Provider 注册表
**导出：** `ProviderRegistryConfig`, `AgentProviderRegistryOptions`, `AgentProviderRegistry`

`AgentProviderRegistry` 管理 8 种 SDK provider 的加载与缓存：
- `initialize(config)` — 加载和缓存所有 provider
- `has(kind)` / `get<T>(kind)` / `require<T>(kind)` — 类型化访问

**依赖：** sdk/provider-loader

#### `registry/provider-loader.ts`（88 行）— Provider 加载器
**导出：** `DefaultProviderLoader`

`DefaultProviderLoader` 实现 `ProviderLoader`，支持：
- `load<T>(ref, ctx)` — 从 built-in 名称或文件路径动态加载 provider 模块

**依赖：** sdk/provider-loader

---

### 1.5 安全层（`src/security/`）— 8 个文件

#### `security/index.ts`（7 行）— barrel 导出

#### `security/approval-manager.ts`（91 行）— 审批管理
**导出：** `ApprovalDecision`, `ApprovalRequest`, `ApprovalRequestHandle`, `ApprovalManager`

`ApprovalManager` — 管理工具调用的审批请求：
- `create(params)` — 创建审批请求（支持超时）
- `resolve(handleId, decision)` / `cancel(handleId)` — 处理审批
- `getPending()`, `listPending()` — 查询待审批项

#### `security/approval-hook.ts`（16 行）— 审批钩子
**导出：** `ApprovalResult`, `ApprovalHook`, `defaultApprovalHook`

早期/备用审批模式。

#### `security/tool-policy-profile.ts`（14 行）— 策略配置
**导出：** `resolveProfilePolicy(profile)` — 将配置名（`minimal`, `coding`, `messaging`, `full`）映射为工具白名单。

#### `security/tool-policy-pipeline.ts`（59 行）— 策略管道
**导出：** `ToolPolicyPipelineParams`, `applyToolPolicyPipeline(params)`

多层工具策略过滤：profile → explicit allow/deny → per-provider → per-sender → sandbox。

#### `security/tool-policy-shared.ts`（27 行）— 策略共享
**导出：** `TOOL_GROUPS`（group → tool[] 映射），`normalizeToolName(name)`, `expandToolGroups(entries)`

#### `security/tool-hook-runner.ts`（84 行）— 钩子运行器
**导出：** `ToolHookRunnerOptions`, `ToolHookRunOutcome`, `ToolHookRunner`

`ToolHookRunner` — 按顺序执行工具钩子链，处理阻塞、审批请求、参数变更。

#### `security/workspace-root-guard.ts`（101 行）— 工作区守卫
**导出：** `expandPath`, `resolveToCwd`, `resolveReadPath`, `assertWithinWorkspaceRoot`, `resolveWorkspacePath`

路径安全检查：展开/解析路径、验证工作区边界、处理 macOS NFD Unicode 变体。

#### `security/tool-hooks/dangerous-tool-hook.ts`（19 行）
**导出：** `createDangerousToolHook(tools)` — 为危险工具创建审批钩子。

---

### 1.6 配置层（`src/config/`）

#### `config/paths.ts`（29 行）— 路径解析
**导出：**
- `resolveTilde(rawPath)` — 展开 `~` 路径
- `getRemAgentDir()` — `~/.rem-agent/` 或环境变量 `$REM_AGENT_HOME`
- `getDefaultSkillsDir()` — 默认技能目录
- `getDefaultSessionsDir()` — 默认会话目录

---

### 1.7 共享工具（`src/shared/`）

#### `shared/generate-id.ts`（5 行）
**导出：** `generateId()` — 生成 UUID v4

#### `shared/debug-log.ts`（39 行）
**导出：** `debugLog(tag, message)`, `isDebugEnabled()`
由 `REM_AGENT_DEBUG` / `REM_AGENT_DEBUG_FILE` 环境变量控制。

#### `shared/text/code-regions.ts`（173 行）— 代码区域检测
**导出：** `CodeRegion`, `CodeRegionState`, `findCodeRegions(text)`, `getCodeStateAt(text, index)`, `createCodeRegionScanner(initialState?)`, `isInsideCode(index, regions)`

检测 Markdown 代码块和行内代码段，使 thinking 标签扫描器跳过代码内容。

#### `shared/text/strip-thinking-tags.ts`（96 行）— 标签剥离
**导出：** `stripThinkingTags(text)` — 移除 `<thinking>` / `<think>` / `<thought>` 标签内容

#### `shared/text/thinking-tag/` — Thinking 标签分区子系统
| 文件 | 行数 | 导出 | 说明 |
|------|------|------|------|
| `index.ts` | 2 | barrel | 重导出 types + partitioner |
| `types.ts` | 11 | `ThinkingTagDelta`, `TagMatch`, `THINKING_TAG_RE` | 标签分区类型和正则 |
| `detection.ts` | 25 | `findIncompleteTagPrefix(text)` | 检测流式文本中不完整的标签前缀 |
| `partitioner.ts` | 138 | `ThinkingTagPartitioner`, `partitionThinkingTags(text)` | **状态化流解析器**：分离 thinking 内容和可见文本 |

`ThinkingTagPartitioner` 接收流式文本块，实时识别 `<think...>` / `</think...>` 标签边界，将内容分类为 `thinking` 或 `text` delta。

---

### 1.8 流控制器（`src/stream/`）

#### `stream/agent-stream.ts`（211 行）— Agent 流控制器
**导出：** `RawChunk`, `AgentStreamController`

`AgentStreamController` — 接收底层 chunk，标准化为 `AgentStreamChunk`，提供聚合 promises：
- `append(chunk)` — 推入 chunk（自动添加 start/finish 边界）
- `finish(output)` / `fail(error)` — 结束流
- `pushTitle(title)` — 推送会话标题
- `stepStart()` / `stepFinish()` — 步骤边界标记
- `stream` getter — 返回 `AgentStream`（含 fullStream, text, usage, steps）

---

### 1.9 工具（`src/utils/`）

#### `utils/skill-parser.ts`（69 行）— SKILL.md 解析
**导出：** `SkillParseResult`, `parseSkillMarkdown(raw, filePath)`

解析 SKILL.md 文件的 YAML frontmatter 和正文内容。

---

### 1.10 UI 封装（`src/ui/`）

| 文件 | 行数 | 导出 | 说明 |
|------|------|------|------|
| `index.ts` | 2 | barrel | 重导出 |
| `types.ts` | 25 | `UISessionCallbacks`, `UIAgentSession` | UI 会话回调接口（8 种回调）+ 会话接口 |
| `session.ts` | 92 | `createUIAgentSession(agent, callbacks)` | 从 CoreAgent 创建 UIAgentSession，绑定事件到 UI 回调 |

---

### 1.11 内置插件（`src/plugins/`）— 9 类实现

#### `plugins/index.ts`（32 行）— 插件 barrel
重导出所有内置插件类 + `resolveBuiltinLoader` 函数（供 `DefaultProviderLoader` 使用）。

#### Session Providers

| 目录 | 行数 | 类 | 说明 |
|------|------|-----|------|
| `session/in-memory/` | 53 | `InMemorySessionProvider` | 基于 Map 的内存会话存储 |
| `session/file/` | 131 | `FileSessionProvider` | 基于文件系统的会话存储（每会话一个 JSON 文件） |
| `session/local/` | 190 | `LocalSessionProvider` | 本地会话存储（带索引文件 + ServerMessage 缓存，供 TUI/Server 使用） |

所有 session provider 实现 `SessionProvider`，提供 `create()`, `load()`, `save()`, `list()` 等方法。`LocalSessionProvider` 额外提供 `delete()`, `cueMessages()`, `pullMessages()`。

#### Tool Providers

| 目录 | 行数 | 类 | 说明 |
|------|------|-----|------|
| `tool/in-memory/` | 85 | `InMemoryToolProvider` | 简单内存工具提供者（TypeBox 校验，无审批/策略过滤） |
| `tool/file-system/` | 48 | `createFileSystemTools(options)` | 文件系统工具工厂 — 创建含 read/write/edit/ls/exec 的 `AgentToolRegistry` |

**文件系统工具子模块（`tool/file-system/`）：**

| 文件 | 行数 | 说明 |
|------|------|------|
| `index.ts` | 48 | 工厂函数，组装所有文件系统工具 |
| `read.ts` | 98 | `read` 工具 — 读取文件，支持 offset/limit、截断、图片检测 |
| `write.ts` | 139 | `write` 工具 — 写入文件，预检查、变更队列、中断恢复 |
| `edit.ts` | 173 | `edit` 工具 — 精确文本替换，diff 输出，匹配提示 |
| `edit-diff.ts` | 114 | Diff 计算底层 — `applyEditsToNormalizedContent()`, `generateDiffString()`, `computeEditsDiff()` |
| `ls.ts` | 106 | `ls` 工具 — 目录列表，排序、截断、目录后缀 |
| `exec.ts` | 55 | `exec` 工具 — Shell 命令执行（`sh -c`），超时、输出截断 |

**共享工具：**

| 文件 | 行数 | 说明 |
|------|------|------|
| `shared/file-mutation-queue.ts` | 35 | `withFileMutationQueue<T>()` — 同一文件路径的并发变更串行化 |
| `shared/truncate.ts` | 122 | `truncateHead()`, `truncateTail()`, `truncateLine()` — 文本截断工具 |
| `shared/limits.ts` | 44 | `normalizePositiveLimit()`, `appendBoundedTextTail()` — 数值/字节限制 |

#### Memory Provider

| 目录 | 行数 | 类 | 说明 |
|------|------|-----|------|
| `memory/simple/` | 26 | `SimpleMemoryProvider` | 简单记忆提供者 — 使用 agent name 作为系统提示构建上下文 |

#### Skill Provider

| 目录 | 行数 | 类 | 说明 |
|------|------|-----|------|
| `skill/file/` | 76 | `FileSkillProvider` | 从文件系统加载技能（扫描目录中的 `SKILL.md`） |

#### Budget Policy

| 目录 | 行数 | 类 | 说明 |
|------|------|-----|------|
| `budget/fixed/` | 52 | `FixedBudgetPolicy` | 固定预算策略 — 限制最大轮次和超时 |

#### Compressor

| 目录 | 行数 | 类 | 说明 |
|------|------|-----|------|
| `compressor/no-op/` | 17 | `NoOpCompressor` | 空操作压缩器 — 永不压缩，原样传递消息 |

#### Error Handler

| 目录 | 行数 | 类 | 说明 |
|------|------|-----|------|
| `error/simple/` | 31 | `SimpleErrorHandler` | 简单错误处理器 — 将 API 类错误分类为重试 |

#### Config Provider

| 目录 | 行数 | 类 | 说明 |
|------|------|-----|------|
| `config/default/` | 253 | `DefaultConfigProvider` | **默认配置提供者** — 从 JSON/YAML 文件加载，合并环境变量和覆盖配置，解析模型/工具/行为设置 |

---

### 1.12 Storage 层

新增统一持久化基建，位于 `src/storage/`。

| 文件 | 行数 | 导出 | 说明 |
|------|------|------|------|
| `storage/types.ts` | ~45 | `StorageProvider`, `SessionStore`, `RuleStorage` | 存储层抽象接口 |
| `storage/errors.ts` | ~25 | `StorageError`, `wrapSqliteError` | 存储错误封装 |
| `storage/schema.ts` | ~80 | `SqliteSchemaManager`, `CURRENT_SCHEMA_VERSION` | SQLite schema 与版本管理 |
| `storage/sqlite/provider.ts` | ~55 | `SqliteStorageProvider` | SQLite 存储门面，管理连接与生命周期 |
| `storage/sqlite/session-store.ts` | ~160 | `SqliteSessionStore` | 基于 SQLite 的 `SessionStore` 实现 |
| `storage/sqlite/session-converter.ts` | ~70 | `toSession`, `toSessionSummary` | session 数据转换辅助 |
| `storage/sqlite/rule-store.ts` | ~70 | `SqliteRuleStore` | 基于 SQLite 的 `RuleStorage` 实现 |
| `plugins/session/sqlite/index.ts` | ~40 | `SqliteSessionProvider` | 实现 `SessionProvider` 接口，包装 `SessionStore` |

说明：

- `buildAgentContext()` 默认构造 `SqliteStorageProvider`，使用 `~/.rem-agent/rem-agent.db`。
- 可通过 `AgentContextBuildOptions.storageProvider` 传入自定义 `StorageProvider`。
- 现有 `FileSessionProvider`/`LocalSessionProvider`/`InMemorySessionProvider` 和 `RuleStore` 保留作为可选兼容实现。

---

### 1.13 Core 内部依赖图

```
types.ts (叶子)
  │
  ├──► sdk/*.ts (接口层 — 薄依赖)
  │      │
  │      ├──► session.ts (纯数据)
  │      ├──► budget.ts (使用 sdk/budget-policy)
  │      ├──► state.ts (使用 types, budget, session)
  │      ├──► events.ts (使用 state)
  │      │
  │      ├──► config/paths.ts (叶子)
  │      ├──► shared/* (工具函数，叶子)
  │      ├──► llm/types.ts + api-registry.ts
  │      │      │
  │      │      ├──► providers/openai.ts + anthropic.ts
  │      │      ├──► partition-stream.ts (使用 thinking-tag)
  │      │      └──► engine.ts (使用 api-registry, partition-stream, strip-thinking-tags)
  │      │
  │      ├──► security/* (使用 sdk 接口)
  │      ├──► registry/* (使用 sdk + security)
  │      │
  │      ├──► plugins/* (使用 sdk, registry, security, config, utils)
  │      ├──► provider-manager.ts (使用 plugins, registry, llm, sdk, config)
  │      │
  │      ├──► stream/agent-stream.ts (使用 types, shared/generate-id)
  │      ├──► loop-strategy.ts (使用 state, events, types, sdk, budget, llm, stream)
  │      ├──► turn.ts (使用 types, session, state, budget, loop-strategy, stream)
  │      ├──► core-agent.ts (编排所有)
  │      ├──► run-agent.ts (使用 types, state, events, budget, turn, loop-strategy, sdk, stream, llm)
  │      │
  │      ├──► ui/* (使用 core-agent, types)
  │      └──► index.ts (重导出所有公开 API)
```

---

## 2. rem-agent-bridge

**包名：** `rem-agent-bridge` | **入口：** `./dist/index.js` | **子路径导出：** `./sse`
**依赖：** `rem-agent-core`

### 2.1 模块清单

#### `src/index.ts`（17 行）— barrel 导出
重导出所有公开 API 和从 core 重导出的类型（`AgentStreamChunk`, `ModelMessage`, `ServerMessage`）。

#### `src/types.ts`（23 行）— API 通信类型
| 导出 | 说明 |
|------|------|
| `RunRequest` | `{ sessionId: string; content: string }` — 启动 run 的请求体 |
| `InterruptRequest` | `{ sessionId: string }` — 中断请求体 |
| `ResetRequest` | `{ sessionId: string }` — 重置请求体 |
| `SessionSummary` | `{ sessionId; title?; updatedAt; messageCount }` — 会话摘要 |
| `ServerStreamEvent` | `AgentStreamChunk` 的别名 |

**内部依赖：** 无 | **Core 依赖：** `AgentStreamChunk`（类型）

#### `src/errors.ts`（6 行）— HTTP 错误类
**导出：** `ServiceError` — 继承 `Error`，携带 `status: number`（HTTP 状态码）

#### `src/sse.ts`（60 行）— SSE 解析器（**子路径导出：`./sse`**）
| 导出 | 说明 |
|------|------|
| `SSEEvent` | `{ event?: string; data: string }` — 原始 SSE 事件 |
| `parseSSEStream(reader)` | 将 `ReadableStreamDefaultReader` 转换为 `AsyncIterable<SSEEvent>`。手动解析 SSE 协议。 |
| `parseAgentStreamEvent(event)` | 将 `SSEEvent` JSON 解析为 `AgentStreamChunk`。解析失败返回 error 块。 |

#### `src/response.ts`（30 行）— SSE 响应构建器
**导出：** `createSSEResponse(fullStream)` — 将 `AsyncIterable<AgentStreamChunk>` 转为 SSE `Response`（含正确头部）。

#### `src/client.ts`（75 行）— 浏览器端 HTTP 客户端
**导出：** `AgentClient`

| 方法 | 返回值 | 端点 |
|------|--------|------|
| `run(sessionId, input)` | `AsyncIterable<AgentStreamChunk>` | `POST /api/agent/run` |
| `interrupt(sessionId)` | `Promise<void>` | `POST /api/agent/interrupt` |
| `reset(sessionId)` | `Promise<void>` | `POST /api/agent/reset` |
| `listSessions()` | `Promise<SessionSummary[]>` | `GET /api/sessions` |

#### `src/agent.ts`（214 行）— 服务端 Agent 运行器
**导出：** `RunParams`, `RunResult`, `InterruptResult`, `ResetResult`, `AgentService`

`AgentService` — **bridge 服务端核心**：
- `run({sessionId, content})` — 调用 `core.runAgent()`，返回 `{stream, output}`，防止重复运行（409）
- `interrupt(sessionId)` — 中断运行（调用 AbortController.abort()）
- `getMessages(sessionId)` — 获取会话消息历史
- `listSessions()` — 委托给 `SessionProvider.list()`
- `createSession()` — 创建并持久化新会话
- `updateSession(sessionId, updates)` — 更新会话元数据（title/pinned）
- `deleteSession(sessionId)` — 删除会话

**内部依赖：** errors, agent-session | **Core 依赖：** `runAgent`, `AgentStreamChunk`, `ProviderManager`, `SessionProvider`, `ServerMessage`, ...

#### `src/agent-session.ts` — 会话 CRUD 管理器

`AgentSessionManager` — 封装 `SessionProvider` 的会话管理逻辑，被 `AgentService` 使用：
- `createSession()`, `listSessions()`, `getMessages(sessionId)`, `updateSession(sessionId, updates)`, `deleteSession(sessionId)`

**内部依赖：** agent-service.interface (类型), errors, run-registry

### 2.2 Bridge 内部依赖图

```
index.ts
  ├── client.ts    → types.ts, sse.ts
  ├── sse.ts       → (无内部依赖)
  ├── response.ts  → (无内部依赖)
  ├── types.ts     → (无内部依赖)
  ├── agent.ts     → errors.ts
  ├── sessions.ts  → agent.ts (仅类型)
  └── errors.ts    → (无内部依赖)
```

**外部依赖（Core）：** `runAgent`（值导入）、`AgentStreamChunk`, `AgentStream`, `AgentOutput`, `ServerMessage`, `ContentPart`, `ProviderManager`, `SessionProvider`（类型导入）

---

## 3. rem-agent-web

**包名：** `rem-agent-web` | **框架：** Next.js 15 (App Router) + React 19
**依赖：** `rem-agent-core`, `rem-agent-bridge`, `zustand`, `awilix`, `react-virtuoso`, `react-markdown`, `lucide-react`

### 3.1 App Router 路由

| 路由 | 方法 | 文件 | 说明 |
|------|------|------|------|
| `/` | GET | `app/page.tsx` (30 行) | 主页面 — `SessionSidebar` + `ChatPanel`。挂载时初始化 store，自动选择/创建会话 |
| `/` | GET | `app/layout.tsx` (15 行) | 根布局 — `html[lang="zh-CN"]`，dark 主题，全局 CSS 导入 |
| `/api/agent/run` | POST | `app/api/agent/run/route.ts` (36 行) | Agent 执行/中断。若 `interrupt: true` 则调用 `agentService.interrupt()`；否则调用 `agentService.run()` 并以 SSE 流响应 |
| `/api/sessions` | GET | `app/api/sessions/route.ts` (27 行) | 列出会话（可选 `?q=` 搜索） |
| `/api/sessions` | POST | 同上 | 创建新会话，返回 `SessionSummary` |
| `/api/sessions/[id]` | GET | `app/api/sessions/[id]/route.ts` (53 行) | 获取会话详情 + 消息 |
| `/api/sessions/[id]` | PATCH | 同上 | 更新标题/置顶状态 |
| `/api/sessions/[id]` | DELETE | 同上 | 删除会话 |

### 3.2 组件

#### 聊天组件（`components/chat/`）

| 组件 | 行数 | 说明 |
|------|------|------|
| `chat-panel.tsx` | 57 | **聊天编排器** — 观察 `pendingContent` 触发 SSE 连接，显示连接/重连/错误状态，布局 `MessageList` + `InputBox` |
| `input-box.tsx` | 80 | **输入框** — 受控 textarea，Enter 发送（Shift+Enter 换行），流式传输中显示红色中断按钮 |
| `message-item.tsx` | 124 | **消息渲染** — 用户消息（右对齐气泡）vs 助手消息（左对齐卡片）。按 `parts` 数组渲染 reasoning/tool-call/text，或回退到旧属性。显示 `ThinkingBar` 和错误块 |
| `message-list.tsx` | 61 | **虚拟滚动列表**（react-virtuoso）— 自动滚动到底部，空状态问候语 + 快捷提示 |
| `reasoning-block.tsx` | 45 | **可折叠推理块** — "Thinking" 标签，流式传输时自动展开，含 Sparkles 图标 |
| `thinking-bar.tsx` | 30 | **状态指示条** — `pending` 显示时钟图标，`streaming` 显示旋转加载器 + 跳动圆点动画 |
| `tool-call-block.tsx` | 72 | **可折叠工具调用块** — 显示工具名、状态图标（旋转/勾/叉），展开显示 JSON 参数和结果 |

#### 侧边栏组件（`components/sidebar/`）

| 组件 | 行数 | 说明 |
|------|------|------|
| `session-sidebar.tsx` | 72 | **响应式侧边栏** — 桌面端常显，移动端汉堡菜单 + 模态抽屉。含搜索输入（300ms 防抖）、新建按钮 |
| `session-list.tsx` | 29 | **会话列表** — 排序（置顶优先 + updatedAt 降序），空状态提示 |
| `session-item.tsx` | 131 | **会话条目** — 点击选中、内联重命名、三点菜单（置顶/重命名/删除含确认弹窗），活动态左边框高亮 |

### 3.3 lib 工具

| 模块 | 行数 | 说明 |
|------|------|------|
| `session-store.ts` | 299 | **Zustand 全局状态** — 管理 sessions, messages, streaming, pendingContent, error 等状态。核心操作：`init`, `createSession`, `selectSession`, `sendMessage`, `onChunk`（处理所有 9 种 SSE 块类型）, `interrupt`, `renameSession`, `deleteSession`, `togglePin` |
| `use-sse.ts` | 84 | **SSE 自定义 hook** — `connect(url, options, onChunk)` 使用 fetch + ReadableStream。`finish`/`error` 块触发状态变更。`AbortError` 自动重试 3 次（3s 间隔） |
| `container.ts` | 41 | **服务端 IoC 容器**（Awilix）— 注册 `providerManager`, `agentService`, `sessionService`。惰性初始化、去重。会话目录 `.sessions/` 或 `$SESSIONS_DIR` |
| `agent-client.ts` | 70 | **前端 HTTP 客户端** — 封装所有 API 路由的 fetch 调用（`runAgent`, `interruptAgent`, `listSessions`, `createSession`, `getSession`, `updateSession`, `deleteSession`） |
| `stream-parser.ts` | 2 | thin re-export — 从 `rem-agent-bridge/sse` 重导出 `parseSSEStream`, `parseAgentStreamEvent`, `SSEEvent` |
| `types.ts` | 37 | **UI 类型** — `SessionSummary`（扩展 core，添加 `pinned`），`UIMessage`（`ServerMessage` 别名），7 个类型守卫函数（`isSSETextDelta`, `isSSEReasoningDelta`, ...） |
| `utils.ts` | 6 | `cn(...inputs)` — Tailwind 类名合并（clsx + twMerge） |

### 3.4 Web 内部依赖图

```
page.tsx
  ├── @/lib/session-store
  ├── @/components/sidebar/session-sidebar
  └── @/components/chat/chat-panel
        ├── @/lib/session-store
        ├── @/lib/use-sse
        │     ├── @/lib/types (AgentStreamChunk)
        │     └── @/lib/stream-parser → rem-agent-bridge/sse
        ├── ./message-list
        │     ├── @/lib/session-store
        │     ├── @/lib/types (UIMessage)
        │     └── ./message-item
        │           ├── ./reasoning-block (lucide-react)
        │           ├── ./tool-call-block (lucide-react, rem-agent-core/ServerMessage)
        │           └── ./thinking-bar (lucide-react)
        └── ./input-box

session-sidebar
  └── ./session-list → ./session-item → @/lib/session-store

API routes → @/lib/container → rem-agent-bridge (AgentService as IAgentService, createSSEResponse)
                              → rem-agent-core (createProviderManager, FileSessionProvider)
```

---

## 4. rem-agent-tui

**包名：** `rem-agent-tui` | **入口：** `./dist/index.js`
**依赖：** `@opentui/core`, `rem-agent-bridge`

### 4.1 模块清单

#### `src/index.ts`（2 行）— barrel 导出
重导出 `TUIApp`, `TUIAppOptions`

#### `src/app.ts`（471 行）— TUI 应用核心
**导出：** `TUIAppOptions`, `TUIApp`

`TUIApp` — **终端 UI 核心类**：

| 方法 | 说明 |
|------|------|
| `constructor(options)` | 创建 AgentClient，设置 sessionId/maxTurns |
| `init()` | 创建 CliRenderer，调用 `buildUI()` 构建布局 |
| `start()` | 聚焦输入框 |
| `stop()` | 销毁渲染器 |

**UI 布局：** 状态栏 + 滚动聊天区 (`ScrollBoxRenderable`) + 输入框 (`InputRenderable`) + 覆盖层（picker, pending 指示器）

**核心流程：**
1. 用户输入 → `handleSubmit(text)` → `client.run(sessionId, text)` → SSE 流
2. `handleChunk(chunk)` → 按 chunk 类型分发到 `streamParts` / `streamBlocks` / `streamTextRefs` 状态机
3. 各类 UI block（reasoning/tool）通过工厂函数创建、更新、折叠

**键盘绑定：** `Ctrl+C` 退出，`Ctrl+O` 折叠切换，`Escape` 关闭/中断

**特殊命令：** `/new` 新建会话，`/resume` 恢复历史会话

**依赖：** `@opentui/core`, `rem-agent-bridge` (AgentClient, AgentStreamChunk, SessionSummary)

#### `src/message/reasoning-block.ts`（63 行）— 推理块
**导出：** `ReasoningPartState`, `ReasoningBlockHandle`, `createReasoningBlock(renderer, part, collapsed)`

工厂函数，创建包含文本渲染、折叠/展开控制的 reasoning block。

**依赖：** `@opentui/core`

#### `src/message/function-tool-block.ts`（99 行）— 工具调用块
**导出：** `ToolStatus`, `ToolPartState`, `ToolBlockHandle`, `createToolBlock(renderer, part, collapsed)`

支持四种状态（pending/running/success/error）的图标与格式化展示，折叠/展开。

**依赖：** `@opentui/core`, `./tool-formatter.js`

#### `src/message/tool-formatter.ts`（148 行）— 工具格式化器
**导出：** `ToolFormatter`（接口）, `getToolFormatter(toolName)`

根据工具名分发专门格式化器：

| 工具名 | 格式化器 | 示例 |
|--------|---------|------|
| `read` | `readFormatter` | `Read(path) @L12+5` → `Read 42 lines` |
| `write` | `writeFormatter` | `Write(path)` → `Wrote 1024 bytes` |
| `edit` | `editFormatter` | `Edit(path) [3 edits]` → `Edit done` |
| `ls` | `lsFormatter` | `ls(path)` → `7 entries` |
| 默认 | `defaultFormatter` | `toolName({"key":"val"})` |

**依赖：** 无内部依赖

### 4.2 TUI 内部依赖图

```
index.ts → app.ts
             ├── @opentui/core
             ├── rem-agent-bridge
             ├── message/reasoning-block.ts → @opentui/core
             └── message/function-tool-block.ts → @opentui/core, tool-formatter.ts
```

---

*最后更新：2026-06-30*
