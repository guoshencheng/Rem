# Rem Agent — 模块级参考手册

> 状态：✅ 与代码同步（2026-07-29）
>
> 本文档记录每个包的关键模块职责、导出和依赖关系。不记录行数（会腐烂），以目录与关键模块为粒度。

---

## 目录

1. [rem-agent-core](#1-rem-agent-core)
2. [rem-agent-bridge](#2-rem-agent-bridge)
3. [rem-agent-routes](#3-rem-agent-routes)
4. [rem-agent-ui](#4-rem-agent-ui)
5. [rem-agent-web](#5-rem-agent-web)
6. [rem-agent-local-demo](#6-rem-agent-local-demo)

---

## 1. rem-agent-core

**包名：** `rem-agent-core` | **入口：** `./dist/index.js`（另有 `./stream/event-aggregators`、`./token-usage`、`./llm/context-window` 子路径导出）
**关键依赖：** `@earendil-works/pi-ai`、`@sinclair/typebox`、`yaml`

### 1.1 顶层模块（`src/`）

| 模块 | 职责 |
|------|------|
| `agent-factory.ts` | `createAgentFromEnv()` — 从环境变量解析 provider/model 并构造 AgentContext（**配置由 Core 拥有的唯一入口**） |
| `agent-context-assembler.ts` | `assembleAgentContext()` — 纯装配函数，全部 provider 可注入（浏览器侧复用） |
| `agent-context-builder.ts` | `createAgentAssembly()` — 同步装配（Sqlite 存储、文件系统工具、MCP 连接） |
| `agent-di.ts` / `agent-runtime-config.ts` | `AgentDI` / `AgentRuntimeConfig` / `AgentRuntimeInfo` 类型 |
| `run-agent.ts` + `run-agent/` | `runAgent()` — 无状态 Agent 运行，**唯一执行入口**；`run-agent/` 内含 pi-agent-factory（装配 pi-agent-core `Agent`）、tool-bridge（工具执行+审批管线）、context-bridge（上下文压缩）、session-writer（消息持久化），含并发标题生成 |
| `state.ts` / `agent-state.ts` | Agent 运行时状态（Session、budget、status） |
| `events.ts` | `EventBus` + `AgentEvent`（生命周期/阶段/工具/审批/压缩事件） |
| `bus-events.ts` | `BusEvent` — 面向 UI 的广播事件类型（`todo-updated`、`usage-change`、`activity-change`、`child-agent-update` 等） |
| `broadcast-bus.ts` | `BroadcastBus` — BusEvent 发布/订阅总线 |
| `budget.ts` | `IterationBudget` — 轮次/连续错误/相同工具故障护栏 |
| `session.ts` | `Session` / `SessionSummary` 接口（conversation 为 `pi.Message[]`，schema v2） |
| `types.ts` | 核心类型：`AgentStreamEvent`、`AgentStream`、`UserInput`、`AgentOutput`、`Usage` 等 |
| `token-usage.ts` | `TokenUsageDetail` 与 usage 聚合工具 |
| `tool-composer.ts` | `DefaultToolComposer` — 组合基础工具 + MCP 工具 + skill-read 工具 |
| `overlay-tool-provider.ts` | `OverlayToolProvider` — 在已有 ToolProvider 上叠加工具定义 |
| `agent-resolver.ts` | `DefaultAgentResolver` — 多角色 agent 配置解析 |
| `index.ts` | 主 barrel 导出 |

### 1.2 推理与执行

| 目录 | 职责 |
|------|------|
| `reason/` | `generate.ts`（`models.complete` 非流式生成：标题生成、压缩摘要）；流式推理由 pi-agent-core `Agent` 驱动 |
| `execute/` | `approval-engine.ts`（审批引擎）、`request-approval.ts`（审批请求） |

### 1.3 LLM 层（`src/llm/`）

| 模块 | 职责 |
|------|------|
| `models.ts` | `createCoreModels()` — pi-ai `Models` 集合初始化 |
| `context-window.ts` | 上下文窗口大小解析 |
| `reasoning-options.ts` | thinking/reasoning 选项构造 |
| `patch-minimax-compat.ts` | MiniMax 兼容补丁 |

类型直接复用 pi-ai：`pi.Message`、`pi.Tool[]`、`pi.Usage`、`AssistantMessageEvent`。无 adapter 转换层。

### 1.4 SDK 接口（`src/sdk/`）— 16 个接口文件

`agent-role`、`agent-state-provider`、`budget-policy`、`compressor`、`config-provider`、`context-provider`、`error-handler`、`memory-provider`、`session-provider`、`skill-provider`、`storage-provider`、`system-prompt`、`title-provider`、`tool-composer`、`tool-policy`、`tool-provider`（`ToolSet = pi.Tool[]`）。

### 1.5 安全层（`src/security/`）

`exec-classifier`（命令分类）、`permissions/`、`rules/`（RuleEngine / RuleStore / profiles）、`tool-policy-pipeline`、`workspace-root-guard`。

### 1.6 能力目录

| 目录 | 职责 |
|------|------|
| `mcp/` | MCP 客户端：connection-manager、tool-provider、composite-tool-provider、schema-converter |
| `todo/` | session 级 TodoList：`TodoService` / `DefaultTodoService` / `TodoItem` 类型 |
| `sub-agent/` | 子 Agent 上下文构建与任务结果格式化 |
| `system-prompt/` | 模板化系统提示装配：assembler、template-selector、sections/、templates/、loaders/ |
| `stream/` | `agent-event-stream.ts`（AgentEventStreamController 队列流）、`event-aggregators.ts` |
| `registry/` | `AgentToolRegistry` |
| `config/` | `paths.ts` 路径解析 |
| `shared/` | id 生成、debug-log（console + file） |
| `utils/` | `skill-parser.ts` SKILL.md 解析 |

### 1.7 内置插件（`src/plugins/`）— 10 类

`budget`、`compressor`（llm-summary）、`config`、`error`、`memory`、`session`、`skill`、`storage`（sqlite）、`title`（llm）、`tool`（builtin / file-system / static）。

> 测试专用的 in-memory fake（`InMemoryToolProvider` / `InMemorySessionProvider`）位于 `packages/core/tests/helpers/`，非生产代码。

---

## 2. rem-agent-bridge

**包名：** `rem-agent-bridge` | **入口：** `.`（Node 服务端）、`/client`（浏览器 HTTP 客户端）、`/local`（浏览器内服务）
**依赖：** `rem-agent-core`

### 2.1 服务端（`.`）

| 模块 | 职责 |
|------|------|
| `agent-service.interface.ts` | `IAgentService` — UI 唯一依赖的统一接口（run/interrupt/reset/会话 CRUD/todos/审批/stream/workspaces） |
| `agent-service-core.ts` | `AgentServiceCore` — 上述接口的共享实现（AgentService 与 LocalAgentService 复用） |
| `agent.ts` | `AgentService` — Node 服务端服务（Sqlite 存储 + core.runAgent） |
| `agent-session.ts` | `AgentSessionManager` — 会话 CRUD |
| `agent-state-provider.ts` | `BridgeAgentStateProvider` |
| `broadcast-bus.ts` | `BroadcastBus` / `createBroadcastBus` |
| `stream-reducer.ts` | `reduceStreamEvent` — 流事件归并 |
| `workspace-repository.ts` / `-json.ts` / `-sqlite.ts` | 工作区仓库接口与两种实现 |
| `sse.ts` / `response.ts` | SSE 解析与 `createSSEResponse` / `createBusSSEResponse` |
| `types.ts` | `RunRequest`、`SessionSummary`、`UIMessage`、`BusEvent`、`SessionActivity`、`Workspace` 等 |
| `errors.ts` | `ServiceError`（HTTP 状态码错误类） |

### 2.2 客户端（`/client`）

`agent-remote-service.ts` — `AgentRemoteService(baseUrl, { apiPrefix })`：浏览器端 HTTP 客户端，实现 `IAgentService`。

### 2.3 浏览器本地（`/local`）

| 模块 | 职责 |
|------|------|
| `local/agent-local-service.ts` | `LocalAgentService` — 浏览器内直接跑 Agent 的 `IAgentService` 实现 |
| `local/idb-storage-provider.ts` | `IndexedDBStorageProvider`（sessions/todos/rules/archives/workspaces 五个 store） |
| `local/credential-store.ts` | `CredentialStore` — provider 凭据存 IndexedDB |
| `local/browser-providers.ts` | `browserCompatibleProviders` — 浏览器兼容 provider（默认含 MiniMax） |
| `local/openai-compatible-provider.ts` | `createOpenAICompatibleProvider` — 自定义 OpenAI 兼容端点 |
| `local/static-config-provider.ts` / `noop-compressor.ts` / `browser-session-provider.ts` | 浏览器侧配套 provider |
| `local/schema.ts` / `idb.ts` | IndexedDB schema 升级与连接管理 |

---

## 3. rem-agent-routes

**包名：** `rem-agent-routes` | **入口：** `./dist/index.js` | **CLI：** `rem-routes`
**依赖：** `rem-agent-bridge`、`rem-agent-core`

| 模块 | 职责 |
|------|------|
| `router.ts` | `createRemHandler({ getAgentService })` — 返回 `(req, segments) → Response`，按 pattern 匹配分发 |
| `handlers/agent.ts` | `agent/run`、`agent/stream`、`agent/interrupt`、`agent/reset` |
| `handlers/sessions.ts` | `sessions` GET/POST、`sessions/:id` GET/PATCH/DELETE、`sessions/:id/todos` GET |
| `handlers/approvals.ts` | `approvals` GET、`approvals/:id/resolve` POST |
| `handlers/workspaces.ts` | `workspaces` GET/POST/DELETE |
| `workspace-param.ts` | `getWorkspace` — workspace 查询参数解析 |
| `errors.ts` | `toErrorResponse` |
| `cli.ts` / `bin.ts` | `rem-routes init` — 生成宿主薄壳路由（默认挂载 `/api/rem`） |

宿主只需提供 `getAgentService()` 工厂（DI 容器路径可配），路由包不实例化 core。

---

## 4. rem-agent-ui

**包名：** `rem-agent-ui` | **入口：** `.`（远程组件）、`/local`（本地组件）、`/styles.css`
**依赖：** `rem-agent-bridge`、`rem-agent-core`；peer：`react >= 19`、`tailwindcss >= 4`

### 4.1 导出

| 入口 | 导出 |
|------|------|
| `rem-agent-ui` | `RemApp`（完整聊天应用，必传 `service`）、`RemChat`（单独聊天框）、`AgentRemoteService`、`IAgentService` 类型 |
| `rem-agent-ui/local` | `RemLocalApp`（内置凭据设置）、`RemLocalChat`（无侧栏，sessionId 缺省自动创建）、`CustomTool` / `Provider` / `ProviderCredential` 类型 |

### 4.2 组件（`src/components/`）

| 组件 | 职责 |
|------|------|
| `rem-app.tsx` / `rem-chat.tsx` | 远程模式组合根：构造上下文，注入 `IAgentService` |
| `rem-local-app.tsx` / `rem-local-chat.tsx` | 本地模式组合根：凭据设置（`credential-setup.tsx`）+ `LocalAgentService` 构造 |
| `chat-session-view.tsx` | 单会话视图编排 |
| `chat/` | `chat-panel`（编排器）、`message-list`（react-virtuoso 虚拟滚动）、`message-item`、`input-box`、`chat-composer`、`reasoning-block`、`tool-call-block`、`todo-panel`、`token-stats`、`activity-bar`、`approval-bar`、`child-agent-card` / `child-agent-drawer`、`attachment-chips`、`markdown-content`、`copy-button` |
| `sidebar/` | `session-sidebar`、`session-list`、`session-item`、`workspace-sidebar` |
| `workspace/` | `add-workspace-dialog` |

### 4.3 状态与工具（`src/lib/`）

| 模块 | 职责 |
|------|------|
| `use-agents.ts` | `useAgents(service, { workspace })` — 多 session 流式状态管理；sessionMap 保存 messages/pendingApprovals/tokenUsage/childAgents/todos，全部经 bus 事件驱动（`todo-updated`、`usage-change`、`activity-change`、`child-agent-update` 等），未加载 session 先 bufferEvent |
| `use-agent-bus.ts` + `agent-bus.ts` | SSE 连接管理（`service.stream()` 订阅 + `send()` 发起 run） |
| `use-local-agent-service.ts` | 本地 service 构造 hook（凭据 → LocalAgentService） |
| `pi-event-helpers.ts` | pi-ai 流事件 → UI 消息块归并 |
| `attachments.ts` / `context-window.ts` / `markdown.ts` / `types.ts` / `utils.ts` | 附件、上下文窗口展示、markdown 渲染、UI 类型、`cn()` |

---

## 5. rem-agent-web

**包名：** `rem-agent-web` | **框架：** Next.js 15 (App Router) + React 19
**定位：** 薄宿主 — 只负责 DI 容器、路由挂载、页面组合。

| 文件 | 职责 |
|------|------|
| `src/app/page.tsx` | `new AgentRemoteService('', { apiPrefix: '/api/rem' })` → `<RemApp service={service} />` |
| `src/app/api/rem/[...path]/route.ts` | `createRemHandler({ getAgentService })` 挂载全部 REM API |
| `src/app/layout.tsx` | 根布局（dark 主题、全局 CSS） |
| `src/lib/container.ts` | awilix 容器：`SqliteStorageProvider` + `AgentService` 单例（全局缓存防热重载重复初始化） |

---

## 6. rem-agent-local-demo

**包名：** `rem-agent-local-demo`（private） | **框架：** Vite 6 + React 19，纯静态构建
**定位：** 浏览器内跑 Agent 的演示/验证宿主。

| 文件 | 职责 |
|------|------|
| `src/app.tsx` | `?mode=chat` 切换 `RemLocalChat` / `RemLocalApp`，注入 demo tools，`maxTurns=20` |
| `src/demo-tools.ts` | 演示工具：`calculatorTool`、`webFetchTool` |
| `src/empty-module.ts` | Node 内置模块的浏览器空实现（Vite alias 用） |
| `src/main.tsx` | React 挂载入口 |

---

*最后更新：2026-07-29*
