# Rem Agent — 系统架构

> 状态：✅ 与代码同步（2026-06-30）
>
> 基于 Hermes Agent 和 OpenClaw 架构分析，采用 Plugin-Core Balance 方案。

---

## 1. 项目概览

`rem-agent` 是一个 Agent-first 的 TypeScript monorepo，构建通用的 AI Agent Harness 系统。专注 Agent 推理循环、状态管理、事件系统、预算控制与工具执行。

**Monorepo 结构（pnpm workspace）：**

| 包 | npm 名称 | 层级 | 职责 |
|---|---|---|---|
| `packages/core` | `rem-agent-core` | 核心层 | Agent 生命周期、ReAct 循环、状态、事件、预算、LLM、安全、SDK 接口 |
| `packages/bridge` | `rem-agent-bridge` | 桥接层 | HTTP client/server、SSE 编解码、AgentService、IAgentService |
| `packages/web` | `rem-agent-web` | 表现层 | Next.js 15 + React 19 聊天 UI，SSE 流消费，会话管理 |
| `packages/tui` | `rem-agent-tui` | 表现层 | 基于 `@opentui/core` 的终端 UI 组件 |

---

## 2. 总体架构图

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         表现层 (Presentation)                             │
│                                                                          │
│  ┌─────────────────────────────┐     ┌──────────────────────────────┐   │
│  │       rem-agent-web         │     │       rem-agent-tui          │   │
│  │   Next.js 15 + React 19     │     │      @opentui/core           │   │
│  │                             │     │                              │   │
│  │  components/chat/           │     │  TUIApp                      │   │
│  │  ├─ ChatPanel              │     │  ├─ message-list (滚动区)     │   │
│  │  ├─ MessageList             │     │  ├─ InputBox                 │   │
│  │  ├─ InputBox                │     │  ├─ ReasoningBlock (可折叠)   │   │
│  │  ├─ MessageItem             │     │  └─ ToolBlock (可折叠)       │   │
│  │  ├─ ReasoningBlock          │     │                              │   │
│  │  ├─ ToolCallBlock           │     │  message/                    │   │
│  │  └─ ThinkingBar             │     │  ├─ reasoning-block.ts       │   │
│  │                             │     │  ├─ function-tool-block.ts   │   │
│  │  components/sidebar/        │     │  └─ tool-formatter.ts        │   │
│  │  ├─ SessionSidebar          │     │                              │   │
│  │  ├─ SessionList             │     └──────────────┬───────────────┘   │
│  │  └─ SessionItem             │                    │                    │
│  │                             │                    │                    │
│  │  lib/                       │                    │                    │
│  │  ├─ session-store.ts        │                    │                    │
│  │  │   (zustand 全局状态)     │                    │                    │
│  │  ├─ use-sse.ts (SSE hook)   │                    │                    │
│  │  ├─ container.ts (awilix DI)│                    │                    │
│  │  ├─ agent-client.ts         │                    │                    │
│  │  ├─ stream-parser.ts        │                    │                    │
│  │  ├─ types.ts                │                    │                    │
│  │  └─ utils.ts                │                    │                    │
│  │                             │                    │                    │
│  │  app/api/                   │                    │                    │
│  │  ├─ agent/run/route.ts      │                    │                    │
│  │  │   POST → SSE Response    │                    │                    │
│  │  └─ sessions/route.ts       │                    │                    │
│  │      GET/POST CRUD          │                    │                    │
│  └─────────────┬───────────────┘                    │                    │
│                │                                     │                    │
└────────────────┼─────────────────────────────────────┼────────────────────┘
                 │                                     │
                 │          depends on                 │
                 ▼                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        桥接层 (Bridge)                                    │
│                                                                          │
│  ┌────────────────────── rem-agent-bridge ────────────────────────────┐  │
│  │                                                                     │  │
│  │  客户端                               服务端                         │  │
│  │  AgentClient                          AgentService                  │  │
│  │  ├─ run(sessionId, input)             ├─ run({sessionId, content})  │  │
│  │  │   → AsyncIterable<                │   → {stream, output}        │  │
│  │  │     AgentStreamChunk>              │   → 调用 core.runAgent()    │  │
│  │  ├─ interrupt() / reset()             ├─ getMessages()              │  │
│  │  └─ listSessions()                    └─ 跟踪活跃 run               │  │
│  │                                                                     │  │
│  │  SSE 工具                            SessionService                 │  │
│  │  ├─ parseSSEStream(reader)           ├─ list / create / get         │  │
│  │  ├─ parseAgentStreamEvent(event)     ├─ update / delete             │  │
│  │  └─ createSSEResponse(stream)        └─ 内存存储 + 元数据            │  │
│  │                                                                     │  │
│  │  errors.ts — ServiceError (HTTP 状态码错误类)                        │  │
│  │  types.ts — RunRequest, InterruptRequest, ResetRequest,             │  │
│  │             SessionSummary, ServerStreamEvent                       │  │
│  │                                                                     │  │
│  └─────────────────────────────────┬───────────────────────────────────┘  │
│                                    │                                      │
└────────────────────────────────────┼──────────────────────────────────────┘
                                     │ depends on
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        核心层 (Core) — rem-agent-core                     │
│                                                                          │
│  ┌───────────────┐  ┌───────────────┐  ┌──────────────────────────────┐ │
│  │  CoreAgent    │  │  runAgent()   │  │  createAgentFromEnv()        │ │
│  │  生命周期管理   │  │  无状态运行    │  │  工厂函数                     │ │
│  └───────┬───────┘  └───────┬───────┘  └──────────────────────────────┘ │
│          │                  │                                            │
│          ▼                  ▼                                            │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                        ReactLoop (ReAct 循环)                      │   │
│  │                                                                   │   │
│  │  ReactTurnRunner (带 step 限制的迭代器)                              │   │
│  │                                                                   │   │
│  │  执行流程:                                                         │   │
│  │  prepare → reason → plan → execute → observe → reflect             │   │
│  │                     ↑                │                             │   │
│  │                     └─── reflect ◄───┘                             │   │
│  └──────────────────────────────┬───────────────────────────────────┘   │
│                                 │                                        │
│                  ┌──────────────┼──────────────┐                        │
│                  ▼              ▼              ▼                        │
│  ┌──────────────────┐ ┌───────────────┐ ┌──────────────────┐           │
│  │ InferenceEngine  │ │ ToolRegistry  │ │ MemoryProvider   │           │
│  │ (LLM 封装)       │ │ (工具执行)     │ │ (上下文构建)      │           │
│  └────────┬─────────┘ └───────────────┘ └──────────────────┘           │
│           │                                                              │
│           ▼                                                              │
│  ┌─────────────────────────────────────────┐                           │
│  │        LLMProvider 注册表                │                           │
│  │  ├─ OpenAI  (openai SDK)                │                           │
│  │  └─ Anthropic (@anthropic-ai/sdk)       │                           │
│  └─────────────────────────────────────────┘                           │
│                                                                          │
│  基础设施:                                                               │
│  ┌────────────┐ ┌───────────┐ ┌─────────────────┐ ┌──────────────────┐  │
│  │ AgentState │ │ EventBus  │ │ IterationBudget │ │ AgentStream      │  │
│  │ 对话历史/状态│ │ 事件系统   │ │ 轮次/错误护栏    │ │ Controller(队列流)│  │
│  └────────────┘ └───────────┘ └─────────────────┘ └──────────────────┘  │
│                                                                          │
│  SDK 接口 (sdk/):                                                        │
│  ToolProvider · MemoryProvider · SessionProvider · SkillProvider         │
│  ConfigProvider · BudgetPolicy · ContextCompressor · ErrorHandler        │
│  ToolPolicy · ToolHook · ProviderLoader                                 │
│                                                                          │
│  安全 (security/):                                                        │
│  ApprovalManager · ToolHookRunner · ToolPolicyPipeline · WorkspaceGuard │
│                                                                          │
│  内置插件 (plugins/):                                                     │
│  session (in-memory/file/local) · tool (in-memory/file-system)          │
│  memory/simple · skill/file · budget/fixed · compressor/no-op           │
│  error/simple · config/default                                          │
│                                                                          │
│  注册表 (registry/):                                                     │
│  AgentToolRegistry · AgentProviderRegistry · DefaultProviderLoader      │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 包间依赖关系

```
                ┌──────────────────────────────┐
                │       rem-agent-web           │
                │  (Next.js 15 / React 19)      │
                └─────────┬────────────────────┘
                          │ depends on
                ┌─────────┴────────────────────┐
                │     rem-agent-bridge          │
                │  (HTTP client/server, SSE)   │
                └─────────┬────────────────────┘
                          │ depends on
          ┌───────────────┼───────────────┐
          │               │               │
     ┌─────────┴──────┐  ┌─────────┴──────────┐
     │ rem-agent-tui  │  │  rem-agent-core    │
     │  (终端 UI)     │  │  (核心引擎)         │
     └────────────────┘  └────────────────────┘
```

**依赖方向：** `web → bridge → core`，`tui → bridge → core`

---

## 4. 关键数据流

### 流程 A：Web UI 完整请求生命周期

```
用户输入 "Hello"
  │
  ▼
[web] InputBox → useSessionStore.sendMessage("Hello")
  │  创建 userMsg + assistantMsg(pendingContent)
  │
  ▼
[web] ChatPanel useEffect → POST /api/agent/run {sessionId, content}
  │
  ▼
[web] app/api/agent/run/route.ts
  │  container.resolve('agentService').run({sessionId, content})
  │
  ▼
[bridge] AgentService.run()
  │  调用 core.runAgent({pm, sessionId, input, signal})
  │
  ▼
[core] runAgent()
  │  创建 AgentStreamController
  │  加载 Session → 构建 ReactLoop → 执行推理循环
  │
  ▼
[core] ReactLoop.iterate()
  │  ① MemoryProvider.buildContext()    → 系统提示 + 记忆
  │  ② ContextCompressor               → 按需压缩上下文
  │  ③ InferenceEngine.infer(...)       → LLM 调用 (带 onChunk 回调)
  │  ④ ToolRegistry.execute(calls)      → 工具执行
  │  ⑤ AgentStreamController.enqueue()  → 产出 AgentStreamChunk
  │
  ▼
[bridge] AgentService 返回 {stream, output}
  │
  ▼
[web route] createSSEResponse(stream.fullStream)
  │  编码为 text/event-stream
  │  event: chunk\ndata: {"type":"text-delta",...}\n\n
  │
  ▼
[web/browser] useSSE → fetch() → ReadableStream
  │  parseSSEStream(reader) → parseAgentStreamEvent → AgentStreamChunk
  │
  ▼
[web] useSessionStore.onChunk(chunk)
  │  更新 assistantMsg → React 重新渲染 MessageList
  │
  ▼
用户看到流式响应
```

### 流程 B：TUI 终端流程

```
[用户] 输入文本
  │
  ▼
[tui] TUIApp.handleSubmit(text)
  │  client.run(sessionId, text)
  │
  ▼
[bridge] AgentClient.run()
  │  POST http://localhost:8321/api/agent/run {sessionId, content}
  │  → SSE 流路径（同流程 A）
  │
  ▼
[tui] 遍历 AgentStreamChunk
  │  text-delta     → TextRenderable
  │  reasoning-*    → ReasoningBlock (可折叠)
  │  tool-call-*    → ToolBlock (可折叠，含格式化器)
  │  error          → 错误消息
```

### 流程 C：Core 内部事件驱动

```
createAgentFromEnv({name, provider, maxTurns})
  │
  ▼
new CoreAgent(config)
  │  registerBuiltInProviders()
  │  resolveProviderConfig() → 读取环境变量
  │
  ▼
agent.initialize({sessionId?})
  │  创建 AgentState，通过 SessionProvider 加载/保存
  │  发出 'core-agent:init'
  │
  ▼
agent.run({content: "Hello"})
  │  发出 'core-agent:start'
  │  进入 ReactTurnRunner 循环
  │  对于每个 ReAct 步骤：
  │    发出 'turn:before' → ReactLoop.iterate() → 发出 'turn:after'
  │    检查 budgetPolicy.checkTurn()
  │  循环直到完成 / 中断 / 预算耗尽
  │  发出 'core-agent:stop'
  │  返回 {stream, output}
  │
  ▼
agent.on('turn:after', handler) — 可观测性
agent.interrupt() — 优雅停止
agent.reset() — 清除状态
```

---

## 5. 核心设计原则

| 原则 | 说明 |
|------|------|
| **Plugin-Core Balance** | Core 最小化（生命周期 + 循环 + 状态），所有能力通过 SDK 接口提供 |
| **事件驱动** | Core 通过 EventBus 发出事件（`turn:before/after`、`phase:reason:*`），插件订阅 |
| **Provider 注册表** | LLM provider 和 SDK provider 使用统一注册表模式（`registerProvider`/`resolveProvider`） |
| **依赖注入** | Web 层通过 Awilix 连接，Core 通过 `ProviderManager`/`ProviderRegistry` 连接 |
| **SSE 流** | `AgentStreamChunk` 标准化块类型，通过 HTTP SSE 传输 |
| **预算护栏** | `IterationBudget` 强制执行最大轮次、连续错误、相同工具故障限制 |
| **可扩展循环** | `LoopStrategy` 接口支持未来 Plan-and-Solve 等替代循环 |

### 红线

| 红线 | 说明 |
|------|------|
| Provider 配置由 Core 拥有 | 客户端禁止直接读取 `OPENAI_API_KEY` 等环境变量，必须通过 `createAgentFromEnv()` |
| Core 不依赖 Vercel AI SDK | LLM 调用通过自建 Provider 层直接调用 `openai` / `@anthropic-ai/sdk` |
| 模块按分离规范拆分 | 每个文件 ≤ 200 行（上限），类型/接口/实现分离 |

---

## 6. 事件系统

Core 通过 `EventBus` 发出以下事件：

| 事件 | 触发时机 | 订阅者示例 |
|------|---------|-----------|
| `core-agent:init` | agent 初始化完成 | 日志、状态同步 |
| `core-agent:start` | agent 开始运行 | UI 状态更新 |
| `core-agent:stop` | agent 运行完成 | UI 渲染最终结果 |
| `turn:before` | 每轮开始前 | MemoryProvider 注入记忆 |
| `turn:after` | 每轮结束后 | SkillProvider 提醒、日志记录 |
| `phase:reason:before` | LLM 推理前 | BudgetChecker 检查预算 |
| `phase:reason:after` | LLM 推理后 | 统计 token 消耗 |
| `phase:execute:before` | 工具执行前 | SecurityPlugin 检查危险命令 |
| `phase:execute:after` | 工具执行后 | 记录执行轨迹 |
| `step:start` | ReactTurnRunner 步开始 | |
| `step:finish` | ReactTurnRunner 步完成 | |

---

## 7. LLM Provider 层

```
src/llm/
├── types.ts              通用类型 (ProviderConfig, GenerateResult, StreamChunk, StreamCollector)
├── api-registry.ts        注册表 (registerProvider, resolveProvider, resolveProviderConfig)
├── engine.ts              InferenceEngine — 核心推理引擎
├── partition-stream.ts    流分区 — 分离 thinking 标签与正文
└── providers/
    ├── index.ts           内置 Provider 注册
    ├── openai.ts          OpenAI 实现 (generate + stream)
    └── anthropic.ts       Anthropic 实现 (generate + stream)
```

**设计要点：**
- 不依赖 Vercel AI SDK，直接封装各 provider 原生 SDK
- `StreamCollector` 累积流式块，`partitionProviderStream` 分离 thinking/reasoning 内容
- `InferenceEngine.infer()` 统一入口，根据 provider 名称路由

---

## 8. 基础设施

| 组件 | 用途 |
|------|------|
| **包管理器** | pnpm (workspace) |
| **测试** | Vitest |
| **类型检查** | tsc --noEmit |
| **Web 框架** | Next.js 15 (App Router) + React 19 |
| **状态管理 (Web)** | Zustand |
| **依赖注入 (Web)** | Awilix |
| **TUI** | `@opentui/core` |
| **LLM SDK** | `openai` (v6) + `@anthropic-ai/sdk` |
| **模式验证** | `@sinclair/typebox` |
| **配置** | YAML + 环境变量 |
| **样式 (Web)** | Tailwind CSS v4 |
| **Markdown 渲染** | react-markdown + remark-gfm + rehype-highlight |
| **虚拟滚动** | react-virtuoso |

---

## 9. 项目目录结构（实际）

```
rem/
├── packages/
│   ├── core/                    rem-agent-core — 核心引擎
│   │   └── src/
│   │       ├── core-agent.ts        CoreAgent 类 + createAgentFromEnv()
│   │       ├── run-agent.ts         无状态 runAgent() 函数
│   │       ├── loop-strategy.ts     ReactLoop + LoopStrategy 接口
│   │       ├── turn.ts              ReactTurnRunner + TurnContext
│   │       ├── state.ts             AgentState
│   │       ├── events.ts            EventBus + AgentEvent
│   │       ├── budget.ts            IterationBudget
│   │       ├── session.ts           Session / SessionSummary 接口
│   │       ├── types.ts             核心类型 (ModelMessage, AgentStreamChunk, ...)
│   │       ├── provider-manager.ts  ProviderManager 门面
│   │       ├── config/paths.ts      路径解析
│   │       ├── shared/              共享工具 (id 生成, debug-log, thinking-tag, code-regions)
│   │       ├── stream/agent-stream.ts  AgentStreamController
│   │       ├── llm/                 LLM 层 (types, api-registry, engine, partition-stream, providers/)
│   │       ├── sdk/                 11 个 SDK 接口
│   │       ├── registry/            AgentToolRegistry, ProviderRegistry, ProviderLoader
│   │       ├── security/            审批管理, 工具策略, 工作区守卫
│   │       ├── ui/                  UI 会话封装
│   │       ├── utils/skill-parser.ts SKILL.md 解析
│   │       └── plugins/             9 类内置 Provider 实现
│   ├── bridge/                  rem-agent-bridge — 桥接层
│   │   └── src/
│   │       ├── client.ts            AgentClient (浏览器端 HTTP 客户端)
│   │       ├── agent.ts             AgentService (服务端, 封装 core.runAgent + 会话管理)
│   │       ├── agent-session.ts     AgentSessionManager (会话 CRUD，被 AgentService 使用)
│   │       ├── sse.ts               SSE 解析 (parseSSEStream, parseAgentStreamEvent)
│   │       ├── response.ts          createSSEResponse (流 → SSE Response)
│   │       ├── types.ts             请求/响应类型
│   │       └── errors.ts            ServiceError
│   ├── web/                     rem-agent-web — Web UI
│   │   └── src/
│   │       ├── app/                 Next.js App Router (layout, page, api routes)
│   │       ├── components/chat/     7 个聊天组件
│   │       ├── components/sidebar/  3 个侧边栏组件
│   │       ├── lib/                 7 个工具模块 (session-store, use-sse, container, ...)
│   │       └── styles/globals.css   Tailwind v4 主题
│   └── tui/                     rem-agent-tui — 终端 UI
│       └── src/
│           ├── app.ts               TUIApp 核心类
│           └── message/             消息渲染 (reasoning-block, function-tool-block, tool-formatter)
├── docs/
│   ├── architecture.md          本文档
│   ├── core-design.md            Core 层详细设计
│   └── module-reference.md       模块级参考
└── CLAUDE.md                    项目规则手册
```

---

*最后更新：2026-06-30*
