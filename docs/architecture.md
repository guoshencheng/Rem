# Rem Agent — 系统架构

> 状态：✅ 与代码同步（2026-07-27）
>
> 基于 Hermes Agent 和 OpenClaw 架构分析，采用 Plugin-Core Balance 方案。

---

## 1. 项目概览

`rem-agent` 是一个 Agent-first 的 TypeScript monorepo，构建通用的 AI Agent Harness 系统。专注 Agent 推理循环、状态管理、事件系统、预算控制与工具执行。

**Monorepo 结构（pnpm workspace）：**

| 包 | npm 名称 | 层级 | 职责 |
|---|---|---|---|
| `packages/core` | `rem-agent-core` | 核心层 | Agent 生命周期、ReAct 循环、状态、事件、预算、LLM 抽象、安全、SDK 接口 |
| `packages/bridge` | `rem-agent-bridge` | 桥接层 | `IAgentService` 抽象、HTTP client/server、SSE 编解码、`LocalAgentService`（浏览器内运行） |
| `packages/routes` | `rem-agent-routes` | 接入层 | REM API 路由包：`createRemHandler` + `rem-routes init` CLI（宿主薄壳生成） |
| `packages/ui` | `rem-agent-ui` | 表现层 | React 聊天组件包：`<RemApp />` / `<RemChat />`（远程）与 `<RemLocalApp />` / `<RemLocalChat />`（本地，`rem-agent-ui/local`） |
| `packages/web` | `rem-agent-web` | 宿主 | Next.js 15 + React 19 宿主应用，薄组合层（DI 容器 + 路由挂载 + 页面） |
| `packages/local-demo` | `rem-agent-local-demo` | 宿主 | 纯前端 Vite demo：浏览器内跑 Agent，凭据存 IndexedDB |

---

## 2. 总体架构图

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         表现层 / 宿主 (Presentation)                      │
│                                                                          │
│  ┌─────────────────────────────┐     ┌──────────────────────────────┐   │
│  │       rem-agent-web         │     │     rem-agent-local-demo     │   │
│  │   Next.js 15 + React 19     │     │     Vite 纯前端 demo          │   │
│  │  （薄宿主）                  │     │                              │   │
│  │  app/page.tsx → <RemApp/>   │     │  app.tsx → <RemLocalApp/>    │   │
│  │  app/api/rem/[...path]      │     │         → <RemLocalChat/>    │   │
│  │    → createRemHandler       │     │  demo-tools.ts (演示工具)     │   │
│  │  lib/container.ts (awilix)  │     │                              │   │
│  └──────┬──────────────┬───────┘     └──────────────┬───────────────┘   │
│         │              │                            │                    │
│         │ routes       │ ui                         │ ui/local           │
│         ▼              ▼                            ▼                    │
│  ┌──────────────┐  ┌────────────────────────────────────────────────┐   │
│  │ rem-agent-   │  │              rem-agent-ui                       │   │
│  │ routes       │  │  RemApp / RemChat（必传 service）                │   │
│  │              │  │  RemLocalApp / RemLocalChat（内置凭据设置）       │   │
│  │ createRem-   │  │  components/chat/* · sidebar/* · workspace/*    │   │
│  │ Handler      │  │  lib/use-agents（多 session 流式状态管理）        │   │
│  │ rem-routes   │  │  lib/use-agent-bus + agent-bus（SSE 客户端）     │   │
│  │ init CLI     │  └───────────────┬────────────────┬───────────────┘   │
│  └──────┬───────┘                  │                │                    │
└─────────┼──────────────────────────┼────────────────┼────────────────────┘
          │                          │                │
          ▼                          ▼                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        桥接层 (Bridge) — rem-agent-bridge                 │
│                                                                          │
│  IAgentService（统一接口，UI 只依赖它）                                     │
│  ┌────────────────────────┐  ┌────────────────────────────────────────┐  │
│  │ AgentRemoteService     │  │ LocalAgentService（/local 入口）        │  │
│  │ 浏览器端 HTTP 客户端    │  │ 浏览器内直接跑 Agent：                  │  │
│  │ （apiPrefix 可配）      │  │  IndexedDB 存储 + CredentialStore      │  │
│  ├────────────────────────┤  │  + browserCompatibleProviders          │  │
│  │ AgentService           │  └────────────────────────────────────────┘  │
│  │ 服务端：封装 core       │  AgentServiceCore：run/会话/审批/todos      │
│  │ runAgent + 会话管理     │  的共享实现（AgentService 与                │  │
│  │                        │  LocalAgentService 复用）                    │  │
│  ├────────────────────────┤                                              │
│  │ BroadcastBus           │  SSE 工具                                    │
│  │ BusEvent 广播（多       │  ├─ parseSSEStream / parseAgentStreamEvent │  │
│  │ session 流式事件总线）  │  └─ createSSEResponse / createBusSSEResponse│ │
│  └────────────────────────┘  WorkspaceRepository（json / sqlite）        │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │ depends on
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        核心层 (Core) — rem-agent-core                     │
│                                                                          │
│  入口：                                                                   │
│  ┌────────────────────────┐  ┌────────────────────────────────────────┐  │
│  │ createAgentFromEnv()   │  │ runAgent()  无状态运行（唯一执行入口）   │  │
│  │ agent-factory.ts       │  │ assembleAgentContext() 纯装配函数       │  │
│  └────────────────────────┘  └────────────────────────────────────────┘  │
│                                                                          │
│  Agent 循环（@earendil-works/pi-agent-core 的 Agent 类）:                │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  runtime/pi-agent-factory.ts 装配 Agent；                          │   │
│  │  runtime/tool-bridge.ts       → 工具执行 + 审批管线                │   │
│  │  runtime/context-bridge.ts    → 上下文压缩（transformContext）     │   │
│  │  消息持久化经 message-persist 事件由上层 SessionService 落盘        │   │
│  │  runtime/generation/generate.ts → models.complete（非流式生成）    │   │
│  │  事件:    AgentStreamEvent = pi.AssistantMessageEvent             │   │
│  │           | RemMetaEvent                                          │   │
│  └──────────────────────────────┬───────────────────────────────────┘   │
│                                 │                                        │
│                  ┌──────────────┼──────────────┐                        │
│                  ▼              ▼              ▼                        │
│  ┌──────────────────┐ ┌───────────────┐ ┌──────────────────┐           │
│  │ pi-ai Models     │ │ ToolComposer  │ │ SystemPrompt     │           │
│  │ (llm/models.ts)  │ │ + Registry    │ │ Assembler        │           │
│  └──────────────────┘ └───────────────┘ └──────────────────┘           │
│                                                                          │
│  类型直接复用 pi-ai：消息为 pi.Message，工具集为 pi.Tool[]，              │
│  无 REM 自建消息表示层（无 adapter）。                                     │
│                                                                          │
│  基础设施:                                                               │
│  ┌────────────┐ ┌───────────┐ ┌─────────────────┐ ┌──────────────────┐  │
│  │ AgentState │ │ EventBus  │ │ IterationBudget │ │ AgentEventStream │  │
│  │ 对话历史/状态│ │ 事件系统   │ │ 轮次/错误护栏    │ │ Controller(队列流)│ │
│  └────────────┘ └───────────┘ └─────────────────┘ └──────────────────┘  │
│                                                                          │
│  能力目录:                                                               │
│  sdk/（16 个接口文件）· security/（审批/策略/工作区守卫）· mcp/（MCP 客户端）│
│  todo/（session 级 TodoList）· sub-agent/（子 Agent 上下文）              │
│  system-prompt/（模板化系统提示装配）· plugins/（10 类内置 Provider 实现， │
│  含 storage/sqlite）                                                      │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 包间依赖关系

```
   ┌─────────────────────┐   ┌──────────────────────┐
   │   rem-agent-web     │   │ rem-agent-local-demo │
   │   (Next.js 薄宿主)   │   │   (Vite 纯前端)       │
   └───┬────────┬────────┘   └──────┬───────────────┘
       │        │                   │
       ▼        ▼                   ▼
   rem-agent-routes   rem-agent-ui (/local)
       │        │                   │
       │        ▼                   ▼
       │    rem-agent-bridge (/client, /local)
       │        │
       └────────┤
                ▼
          rem-agent-core (/browser 子集供浏览器使用)
```

**依赖方向：** 宿主 → {routes, ui} → bridge → core。UI 只依赖 `IAgentService` 接口；远程/本地只是注入不同的实现（`AgentRemoteService` / `LocalAgentService`）。

---

## 4. 关键数据流

### 流程 A：Web 远程请求生命周期

```
用户输入 "Hello"
  │
  ▼
[ui] InputBox → useAgents.send(workspace, sessionId, "Hello")
  │
  ▼
[bridge/client] AgentRemoteService.run()
  │  POST /api/rem/agent/run {workspace, sessionId, content}
  │
  ▼
[web] app/api/rem/[...path]/route.ts → createRemHandler
  │  getAgentService() → container.resolve('agentService')
  │
  ▼
[routes] handlers/agent.ts → AgentService.run()
  │
  ▼
[bridge] AgentService.run() → core.runAgent({sessionId, input, signal})
  │
  ▼
[core] runAgent()
  │  加载 Session → pi-agent-core Agent 循环：
  │  ① 系统提示装配 + 记忆注入
  │  ② context-bridge            → 按需压缩上下文
  │  ③ models.stream(...) → LLM 流式调用（pi-agent-core Agent 驱动）
  │  ④ tool-bridge → 工具执行（含审批管线）
  │  ⑤ AgentEventStreamController.emit → AgentStreamEvent
  │
  ▼
[bridge] 事件同时写入 SSE 响应流 + BroadcastBus（BusEvent）
  │
  ▼
[ui] use-agent-bus 消费 SSE → useAgents 归并 sessionMap 状态
  │  （todos / tokenUsage / childAgents / pendingApprovals 均由 bus 事件驱动）
  │
  ▼
React 重新渲染 MessageList → 用户看到流式响应
```

### 流程 B：浏览器内本地流程（local-demo）

```
[local-demo] <RemLocalApp tools={...} />
  │
  ▼
[ui/local] 凭据设置（CredentialStore → IndexedDB）
  │  构造 LocalAgentService
  │
  ▼
[bridge/local] LocalAgentService.run()
  │  IndexedDBStorageProvider（sessions/todos/rules/archives/workspaces）
  │  browserCompatibleProviders（浏览器兼容的 LLM provider，如 MiniMax）
  │  customProviders passthrough（自定义 OpenAI 兼容端点）
  │
  ▼
[core] runAgent() — 直接在浏览器内执行 Agent 循环
  │  事件经 BroadcastBus 回到 useAgents，渲染链路同流程 A
```

### 流程 C：Core 内部执行

```
createAgentFromEnv({name, maxTurns})
  │  读取环境变量解析 provider/model（配置由 Core 拥有）
  │  → AgentContext（models, providers, ...）
  │
  ▼
runAgent({context, sessionId, input, signal})
  │  加载/创建 Session（schema v2，旧 v1 抛 UnsupportedSessionSchemaError）
  │  进入 pi-agent-core Agent 循环，每步受 IterationBudget 护栏约束
  │  EventBus 发出 turn:before/after、phase:*、tool:* 等事件
  │  循环直到完成 / 中断 / 预算耗尽
  │
  ▼
返回 {stream, output}
```

---

## 5. 核心设计原则

| 原则 | 说明 |
|------|------|
| **Plugin-Core Balance** | Core 最小化（生命周期 + 循环 + 状态），能力通过 SDK 接口与 plugins/ 提供 |
| **事件驱动** | Core 通过 EventBus 发出生命周期/阶段事件；Bridge 通过 BroadcastBus 广播 UI 级 BusEvent |
| **IAgentService 抽象** | UI 只依赖接口，远程 HTTP 与浏览器内本地运行可互换 |
| **直接复用 pi-ai 类型** | 消息为 `pi.Message`、工具集为 `pi.Tool[]`，无自建表示层/adapter |
| **SSE 流** | `AgentStreamEvent` 标准化事件类型，通过 HTTP SSE 传输 |
| **预算护栏** | `IterationBudget` 强制执行最大轮次、连续错误、相同工具故障限制 |
| **循环委托 pi-agent-core** | Agent 推理由 `@earendil-works/pi-agent-core` 的 `Agent` 执行，core 只做装配与桥接 |

### 红线

| 红线 | 说明 |
|------|------|
| Provider 配置由 Core 拥有 | 客户端禁止直接读取 `OPENAI_API_KEY` 等环境变量，必须通过 `createAgentFromEnv()`（浏览器侧由 CredentialStore/凭据注入走 Core 装配） |
| Core 不依赖 Vercel AI SDK | LLM 调用统一通过 `@earendil-works/pi-ai` 的 `Models` 集合 |
| 模块按分离规范拆分 | 文件精简、职责单一，类型/接口/实现分离 |

---

## 6. 事件系统

**Core EventBus**（`core/src/events.ts`）发出的事件：

| 类别 | 事件 |
|------|------|
| 状态 | `agent:state-change` |
| 轮次 | `turn:before` / `turn:after` |
| 阶段 | `phase:prepare` / `phase:reason:before|after|error` / `phase:execute:before|after` / `phase:observe` / `phase:reflect` |
| 工具 | `tool:before` / `tool:after` / `tool:error` / `tool:blocked` |
| 审批 | `tool:approval:requested` / `tool:approval:resolved` / `tool:approval:expired` |
| 压缩 | `compress:before` / `compress:after` |

**Bridge BroadcastBus**（`BusEvent`，面向 UI 多 session 广播）：消息流式事件、`usage-change`、`activity-change`、`todo-updated`、`child-agent-update`、审批请求等。UI 的 `useAgents` 全部经由 bus 事件驱动更新。

---

## 7. LLM Provider 层

```
src/llm/
├── models.ts                # createCoreModels：pi-ai Models 集合初始化
├── context-window.ts        # 上下文窗口大小解析
├── reasoning-options.ts     # thinking/reasoning 选项
└── patch-minimax-compat.ts  # MiniMax 兼容补丁
```

Core 通过 `AgentContext.models` 使用 pi-ai `Models` 集合：`reason()` 调用 `models.stream(model, context, options)`，`generate()` 调用 `models.complete(...)`。

**设计要点：**
- Core 不依赖 Vercel AI SDK，LLM 能力由 `@earendil-works/pi-ai` 的 `Models` 集合提供
- `Models` 负责 provider 路由、流式事件生成和 usage 统计
- 类型直接复用 pi-ai：`pi.Message`（user / assistant / toolResult）、`pi.Tool[]`、`pi.Usage`，无 adapter 转换层
- 流式事件统一为 pi-ai 的 `AssistantMessageEvent`；Core 在此基础上叠加 `RemMetaEvent`（`step-start`、`compress-start`、`approval-request` 等）
- 旧 schema v1 session 不再兼容，加载时抛出 `UnsupportedSessionSchemaError`

---

## 8. 基础设施

| 组件 | 用途 |
|------|------|
| **包管理器** | pnpm (workspace) |
| **测试** | Vitest |
| **类型检查** | tsc --noEmit |
| **Web 宿主** | Next.js 15 (App Router) + React 19 |
| **本地 demo** | Vite 6 + React 19 |
| **依赖注入 (web)** | Awilix |
| **LLM SDK** | `@earendil-works/pi-ai` (统一 provider 抽象) |
| **模式验证** | `@sinclair/typebox` |
| **配置** | YAML + 环境变量（Node）/ IndexedDB 凭据（浏览器） |
| **样式** | Tailwind CSS v4 |
| **Markdown 渲染** | marked + marked-shiki (shiki) |
| **虚拟滚动** | react-virtuoso |

---

## 9. 项目目录结构（实际）

```
rem/
├── packages/
│   ├── core/                    rem-agent-core — 核心引擎
│   │   └── src/
│   │       ├── agent/               REMAgent 生命周期、运行状态、输出、事件、预算、usage、bus
│   │       ├── assembly/            agent-factory / agent-assembly / agent-context-assembler / agent-di
│   │       ├── runtime/             assemble-pi-agent, pi-agent-factory, tool-bridge, context-bridge, generation/
│   │       ├── session/             model / manager / tree
│   │       ├── tools/               registry, composer, overlay, prompt-tool-summary
│   │       ├── security/            approval, permissions, rules, workspace, tool-policy
│   │       ├── capabilities/        todo, sub-agent（delegate_task）
│   │       ├── sdk/                 16 个 SDK 接口文件
│   │       ├── infrastructure/      llm, mcp, config, observability
│   │       ├── system-prompt/       模板化系统提示装配
│   │       ├── shared/              generate-id
│   │       ├── plugins/             10 类内置 Provider（storage/sqlite, ...）
│   │       ├── compat.ts            临时兼容出口（V2 别名）
│   │       └── index.ts             稳定/高级/兼容 三段式公共出口
│   ├── bridge/                  rem-agent-bridge — 桥接层
│   │   └── src/
│   │       ├── agent-service.interface.ts  IAgentService 统一接口
│   │       ├── agent-service-core.ts  run/会话/审批/todos 共享实现
│   │       ├── agent.ts             AgentService（Node 服务端）
│   │       ├── agent-remote-service.ts  AgentRemoteService（HTTP 客户端）
│   │       ├── local/               LocalAgentService, IndexedDB 存储, 凭据, 浏览器 provider
│   │       ├── broadcast-bus.ts     BroadcastBus（BusEvent 多 session 总线）
│   │       ├── sse.ts / response.ts SSE 编解码
│   │       ├── stream-reducer.ts    流事件归并
│   │       └── workspace-repository*.ts  工作区仓库（json / sqlite）
│   ├── routes/                  rem-agent-routes — REM API 路由包
│   │   └── src/
│   │       ├── router.ts            createRemHandler（pattern 匹配分发）
│   │       ├── handlers/            agent / sessions / approvals / workspaces
│   │       └── cli.ts               rem-routes init（生成宿主薄壳路由）
│   ├── ui/                      rem-agent-ui — React 聊天组件包
│   │   └── src/
│   │       ├── components/          RemApp, RemChat, RemLocalApp, RemLocalChat,
│   │       │                        chat/*, sidebar/*, workspace/*
│   │       ├── lib/                 use-agents, use-agent-bus, agent-bus,
│   │       │                        use-local-agent-service, pi-event-helpers, ...
│   │       ├── index.ts             远程入口（RemApp / RemChat）
│   │       └── local.ts             本地入口（RemLocalApp / RemLocalChat）
│   ├── web/                     rem-agent-web — Next.js 薄宿主
│   │   └── src/
│   │       ├── app/page.tsx         <RemApp service={AgentRemoteService} />
│   │       ├── app/api/rem/[...path]/route.ts  createRemHandler 挂载
│   │       └── lib/container.ts     awilix DI（AgentService + SqliteStorageProvider）
│   └── local-demo/              rem-agent-local-demo — Vite 纯前端 demo
│       └── src/
│           ├── app.tsx              RemLocalApp / RemLocalChat（?mode=chat 切换）
│           └── demo-tools.ts        演示工具（calculator, webFetch）
├── docs/
│   ├── architecture.md          本文档
│   ├── core-design.md           Core 层早期设计（历史参考）
│   └── module-reference.md      模块级参考
└── AGENTS.md                    项目规则手册
```

---

*最后更新：2026-07-27*
