# 预期架构 — 模块边界修正后

> 基于 `docs/boundary-review.md` 审查报告。
>
> 核心决策：**仅保留 `run-agent` 作为唯一 agent 执行入口**，移除 `CoreAgent` 类。

---

## 1. 总体包结构

```
rem/
├── packages/
│   ├── core/       # rem-agent-core — 核心引擎（唯一入口：runAgent + createAgentFromEnv）
│   ├── bridge/     # rem-agent-bridge — 桥接层（含共享 stream-reducer）
│   ├── web/        # rem-agent-web — Web UI
│   ├── tui/        # rem-agent-tui — 终端 UI
│   └── demo/       # rem-agent-demo — 演示入口
```

---

## 2. `packages/core` — 预期模块结构

```
packages/core/src/
├── index.ts                          # barrel 导出
├── types.ts                          # 核心类型 (ModelMessage, AgentStreamChunk, ...)
├── session.ts                        # Session / SessionSummary 接口
│
├── run-agent.ts                      # 无状态 runAgent (唯一执行入口)
├── agent-factory.ts     [新]         # createAgentFromEnv 工厂 (从 core-agent.ts 移入)
│
├── shared/
│   ├── generate-id.ts
│   ├── debug-log.ts
│   └── text/
│       ├── code-regions.ts           # 拆出 processFenceState / processInlineState
│       ├── strip-thinking-tags.ts
│       └── thinking-tag/
│           ├── index.ts
│           ├── types.ts
│           ├── detection.ts
│           └── partitioner.ts
│
├── state.ts                          # AgentState
├── events.ts                         # EventBus
├── budget.ts                         # IterationBudget
│
├── turn.ts                           # ReactTurnRunner
├── loop-types.ts        [新]         # TurnHooks, LoopContext, LoopResult, LoopStrategy
├── loop-strategy.ts                  # ReactLoop 实现 (~180 行，拆分后)
│
├── stream/
│   ├── agent-stream.ts               # AgentStreamController (~150 行，拆分后)
│   └── stream-aggregators.ts [新]    # aggregateSteps, aggregateText, aggregateUsage
│
├── config/
│   └── paths.ts
│
├── utils/
│   └── skill-parser.ts
│
├── llm/
│   ├── types.ts                      # 纯类型
│   ├── stream-collector.ts [新]      # StreamCollector 类 + collectStream
│   ├── api-registry.ts               # registerProvider / resolveProvider
│   ├── engine.ts                     # InferenceEngine
│   ├── partition-stream.ts
│   └── providers/
│       ├── index.ts                  # registerBuiltInProviders
│       ├── openai-adapter.ts  [新]   # convertToOpenAIMessages / convertToOpenAITools
│       ├── openai.ts                 # openaiProvider (~120 行)
│       ├── anthropic-adapter.ts [新] # convertToAnthropicMessages / convertToAnthropicTools
│       └── anthropic.ts              # anthropicProvider (~100 行)
│
├── sdk/
│   ├── index.ts                      # barrel (修复重复导出)
│   ├── provider-loader.ts
│   ├── tool-provider.ts
│   ├── memory-provider.ts
│   ├── session-provider.ts
│   ├── skill-provider.ts             # 仅接口，不含实现
│   ├── config-provider.ts
│   ├── compressor.ts
│   ├── error-handler.ts
│   ├── budget-policy.ts
│   ├── tool-policy.ts
│   └── tool-hook.ts
│
├── security/
│   ├── index.ts
│   ├── approval-manager.ts
│   ├── tool-policy-shared.ts
│   ├── tool-policy-profile.ts
│   ├── tool-policy-pipeline.ts       # 修复 alsoAllow Bug
│   ├── tool-hook-runner.ts
│   ├── workspace-root-guard.ts
│   └── tool-hooks/
│       ├── index.ts
│       └── dangerous-tool-hook.ts
│
├── registry/
│   ├── tool-registry.ts
│   ├── provider-loader.ts
│   └── provider-registry.ts
│
├── provider-manager.ts
│
├── plugins/
│   ├── index.ts
│   │
│   ├── budget/fixed/
│   │   └── index.ts
│   ├── compressor/no-op/
│   │   └── index.ts
│   ├── config/default/
│   │   ├── index.ts                  # DefaultConfigProvider (~80 行)
│   │   ├── config-loader.ts  [新]
│   │   ├── config-parser.ts  [新]
│   │   └── config-merger.ts  [新]
│   ├── error/simple/
│   │   └── index.ts
│   ├── memory/simple/
│   │   └── index.ts
│   ├── session/
│   │   ├── base.ts          [新]     # BaseFileSessionProvider
│   │   ├── in-memory/
│   │   │   └── index.ts
│   │   ├── file/
│   │   │   └── index.ts
│   │   └── local/
│   │       └── index.ts
│   ├── skill/
│   │   ├── file/
│   │   │   └── index.ts
│   │   └── default-catalog.ts [新]
│   └── tool/
│       ├── in-memory/
│       │   └── index.ts
│       └── file-system/
│           ├── index.ts
│           ├── read.ts
│           ├── write.ts
│           ├── edit.ts
│           ├── edit-schemas.ts [新]
│           ├── edit-recovery.ts [新]
│           ├── edit-diff.ts
│           ├── ls.ts
│           ├── exec.ts
│           └── shared/
│               ├── file-mutation-queue.ts
│               ├── truncate.ts
│               └── limits.ts
│
└── ~~ui/~~                            # ❌ 删除 — 依赖 CoreAgent，无其他引用
```

### 2.1 Core 层模块关系图

```
                    ┌──────────────────────────────┐
                    │          index.ts             │
                    │        (barrel export)        │
                    └──────────────┬───────────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         │                         │                         │
  ┌──────┴──────────┐   ┌──────────┴──────┐   ┌─────────────┴──────────┐
  │ agent-factory.ts│   │  run-agent.ts   │   │  provider-manager.ts   │
  │ createAgentFrom │──→│   runAgent()    │←──│  (ProviderManager)     │
  │     Env() [新]  │   │  (唯一执行入口)  │   └─────────────┬──────────┘
  └─────────────────┘   └────────┬───────┘                 │
                                 │                         │
                                 │    ┌────────────────────┘
                                 │    ▼
                                 │ ┌───────────────────┐
                                 │ │    reactor 层      │
                                 │ │                   │
                                 │ │ turn.ts           │
                                 │ │ loop-types.ts [新] │
                                 │ │ loop-strategy.ts  │
                                 │ │ state.ts          │
                                 │ │ events.ts         │
                                 │ │ budget.ts         │
                                 │ └─────────┬─────────┘
                                 │           │
                                 │     ┌─────┴──────┐
                                 │     ▼            ▼
                                 │ ┌────────┐ ┌──────────────────┐
                                 │ │  llm/  │ │    registry 层    │
                                 │ │ engine │ │ provider-registry │
                                 │ │   ···  │ │ provider-loader   │
                                 │ └────────┘ │ tool-registry     │
                                 │            └────────┬─────────┘
                                 │                     │
                                 │                     ▼
                                 │            ┌──────────────────┐
                                 │            │    plugins/      │
                                 │            │ session/*        │
                                 │            │ tool/*           │
                                 │            │ memory/*         │
                                 │            │ skill/*          │
                                 │            │ budget/*         │
                                 │            │ compressor/*     │
                                 │            │ error/*          │
                                 │            │ config/*         │
                                 │            └──────────────────┘
                                 │
                                 ▼
                          ┌──────────────┐
                          │    sdk/      │
                          │ (所有接口)    │
                          └──────────────┘
```

**执行路径：** 唯一入口 `runAgent()`，接收 `ProviderManager`，内部组装 ReactLoop + AgentState + AgentStreamController → 执行。

**中断/取消：** 通过 `AbortSignal` 传递，不维护内部生命周期。

**事件系统：** 保留 `EventBus`，在 ReactLoop 内部使用。不对外暴露。

---

## 3. `packages/bridge` — 预期模块结构

```
packages/bridge/src/
├── index.ts                          # barrel 导出
├── types.ts                          # RunRequest, InterruptRequest, ...
├── errors.ts                         # ServiceError
│
├── agent-service.interface.ts [新]   # IAgentService 接口 (run/interrupt/reset/listSessions)
├── agent-service.ts       [重命名]   # AgentService — 直接调用 core.runAgent，实现 IAgentService
├── agent-remote-service.ts [新]     # AgentRemoteService — 通过 HTTP SSE 调用，实现 IAgentService
│
├── sse.ts                            # parseSSEStream, parseAgentStreamEvent
├── response.ts                       # createSSEResponse
│
├── stream-tap.ts        [新]         # tapFullStream
├── content-builder.ts   [新]         # buildPartsFromContent
├── sessions.ts                       # SessionService
│
└── stream-reducer.ts    [新]         # reduceStreamChunk — web+tui 共享
```

### 3.1 IAgentService 接口

```typescript
// packages/bridge/src/agent-service.interface.ts

import type { AgentStreamChunk } from 'rem-agent-core';

interface SessionSummary {
  sessionId: string;
  title?: string;
  updatedAt: number;
  messageCount: number;
}

interface IAgentService {
  /** 启动一次 agent 运行，返回 SSE 流块的可迭代对象 */
  run(sessionId: string, input: string): Promise<AsyncIterable<AgentStreamChunk>>;

  /** 中断正在运行的会话 */
  interrupt(sessionId: string): Promise<void>;

  /** 重置会话 */
  reset(sessionId: string): Promise<void>;

  /** 列出所有会话 */
  listSessions(): Promise<SessionSummary[]>;
}
```

### 3.2 双实现对比

| | AgentService（直调） | AgentRemoteService（远程） |
|---|---|---|
| **实现方式** | 直接调用 `core.runAgent()` | HTTP `fetch` + SSE 解析 |
| **`run()` 返回** | `AgentStreamController.fullStream` | `parseSSEStream(reader)` → chunk 迭代器 |
| **中断/重置** | `AbortController.abort()` | `POST /api/agent/interrupt` / `POST /api/agent/reset` |
| **`listSessions()`** | `SessionProvider.list()` | `GET /api/sessions` |
| **使用场景** | 服务端（bridge 自身、CLI/TUI 本地模式） | 浏览器端（web）、远程 TUI |
| **构造函数** | `new AgentService(providerManager)` | `new AgentRemoteService(baseUrl)` |

### 3.3 Bridge 层模块关系图

```
                    ┌──────────────────────────────────┐
                    │           index.ts                │
                    │         (barrel export)           │
                    └───────────────┬──────────────────┘
                                    │
           ┌────────────────────────┼────────────────────────────┐
           │                        │                            │
  ┌────────┴────────────┐  ┌────────┴──────────────┐  ┌─────────┴─────────┐
  │ agent-service.      │  │ agent-remote-service  │  │ sessions.ts       │
  │ interface.ts [新]   │  │     .ts [新]          │  │ SessionService    │
  │                     │  │                       │  └───────────────────┘
  │   IAgentService     │  │ AgentRemoteService    │
  │   (共同接口)         │  │ implements IAgentService│
  └─────────┬───────────┘  └───────────┬───────────┘
            │                          │
            │              ┌───────────┴────────────────┐
            │              │                            │
     ┌──────┴──────┐  ┌────┴──────┐              ┌──────┴──────┐
     │ agent-service│  │ client.ts │              │    sse.ts   │
     │    .ts       │  │ (HTTP 层) │              │  response.ts│
     │              │  └───────────┘              └─────────────┘
     │ AgentService │
     │ implements   │
     │ IAgentService│
     └──────┬───────┘
            │
   ┌────────┼────────┐
   │        │        │
┌──┴────┐ ┌┴──────┐ ┌┴─────────────┐
│stream-│ │content│ │stream-reducer │
│tap    │ │builder│ │    [新]       │
│ [新]  │ │ [新]  │ │(web+tui 共享) │
└───────┘ └───────┘ └───────────────┘
```

**设计要点：**
- `AgentService`（直调）和 `AgentRemoteService`（远程）实现同一个 `IAgentService` 接口
- 消费方（web、tui、demo）只依赖 `IAgentService`，通过 DI 注入具体实现
- TUI 本地模式注入 `AgentService`，远程模式注入 `AgentRemoteService`，无需改业务代码
- Web 始终使用 `AgentRemoteService`（浏览器端无法直调 core）

---

## 4. `packages/web` — 预期模块结构

```
packages/web/src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   └── api/
│       ├── agent/run/route.ts
│       └── sessions/
│           ├── route.ts
│           └── [id]/route.ts
│
├── components/
│   ├── chat/
│   │   ├── chat-panel.tsx
│   │   ├── input-box.tsx
│   │   ├── message-item.tsx
│   │   ├── message-list.tsx
│   │   ├── reasoning-block.tsx
│   │   ├── thinking-bar.tsx
│   │   └── tool-call-block.tsx
│   └── sidebar/
│       ├── session-sidebar.tsx
│       ├── session-list.tsx
│       └── session-item.tsx
│
├── lib/
│   ├── container.ts                   # Awilix DI — 注入 IAgentService (AgentRemoteService)
│   ├── session-store.ts               # Zustand store (~150 行) — 依赖 IAgentService 接口
│   ├── use-sse.ts                     # SSE hook — 通过 IAgentService.run() 消费流
│   ├── types.ts                       # 从 rem-agent-bridge 导入 IAgentService, SessionSummary 等
│   └── utils.ts
│
├── ~~agent-client.ts~~                # ❌ 删除 — 用 bridge AgentRemoteService 替代
├── ~~stream-parser.ts~~               # ❌ 删除 — 直接从 bridge/sse 导入
│
└── styles/
    └── globals.css
```

### 4.1 Web 层数据流（修正后）

```
用户输入
  │
  ▼
[session-store] sendMessage()
  │
  ▼
[chat-panel] useSSE().connect(...)
  │
  ▼
[use-sse] → agentService.run(sessionId, content)   ← IAgentService 接口
  │            └── AgentRemoteService (HTTP SSE)
  │
  ▼
[use-sse] onChunk(chunk)
  │
  ▼
[session-store] reduceStreamChunk(prevParts, chunk) → newParts  ← bridge stream-reducer
  │
  ▼
React 重新渲染 MessageList
```

**关键变化：**
- 业务代码只依赖 `IAgentService` 接口，不感知 `AgentRemoteService` 具体实现
- `container.ts` 负责注入 `new AgentRemoteService('')`

---

## 5. `packages/tui` — 预期模块结构

```
packages/tui/src/
├── index.ts
├── app.ts                            # TUIApp (~80 行) — 依赖 IAgentService 接口
│
├── ui-layout.ts         [新]
├── session-picker.ts    [新]
├── commands.ts          [新]
│
└── message/
    ├── reasoning-block.ts
    ├── function-tool-block.ts
    └── tool-formatter.ts
```

### 5.1 TUI 层数据流（修正后）

```
用户输入
  │
  ▼
[app.ts] handleSubmit(text)
  │   agentService.run(sessionId, text)    ← IAgentService 接口
  │
  │   ┌─ 本地模式: AgentService (直调 core)
  │   └─ 远程模式: AgentRemoteService (HTTP SSE)
  │
  ▼
[app.ts] onChunk(chunk)
  │   reduceStreamChunk(prevParts, chunk) → newParts  ← bridge stream-reducer
  │
  ▼
[app.ts] 根据 newParts 更新 UI blocks
```

**关键变化：**
- `TUIApp` 构造函数接收 `IAgentService` 而非直接创建 `AgentClient`
- 本地/远程模式通过注入不同实现切换，TUI 业务代码零改动
- demo 层决定注入哪种实现

---

## 6. 关键变化对比

| 项目 | 当前 | 修正后 |
|------|------|--------|
| Agent 执行入口 | `CoreAgent` + `runAgent` 双入口 | `runAgent` 唯一入口 |
| 工厂函数 | `core-agent.ts:createAgentFromEnv` | `agent-factory.ts:createAgentFromEnv` |
| 生命周期管理 | `CoreAgent.initialize/interrupt/reset` | `AbortSignal` + `ProviderManager` 管理 |
| 事件订阅 | `CoreAgent.on/once` 对外暴露 | EventBus 仅 ReactLoop 内部使用 |
| UI 封装 | `ui/session.ts:createUIAgentSession` | 删除，UI 层自行管理 |
| 标题生成 | `core-agent.ts` + `run-agent.ts` 各一份 | 内联在 `run-agent.ts` 中（无重复） |
| chunk 归并 | tui + web 各一份 switch-case | `bridge/stream-reducer.ts` 共享 |
| **bridge 服务层** | `AgentService` + `AgentClient` 两套 API | **统一 `IAgentService` 接口，两种实现** |
| **bridge 客户端** | `AgentClient` (HTTP fetch) | **`AgentRemoteService` implements IAgentService** |
| **bridge 直调端** | `AgentService` (直调 core) | **`AgentService` implements IAgentService** |

---

## 7. 全链路请求流（修正后）

```
用户输入 "Hello"
  │
  ▼
[web] session-store.sendMessage("Hello")
  │
  ▼
[web] → agentService.run(sessionId, text)       ← IAgentService 接口 (AgentRemoteService)
  │
  ▼
[bridge] AgentRemoteService.run()
  │ POST /api/agent/run → SSE
  │
  ▼
[web route] agentService.run() → createSSEResponse()
  │                                   ↑ IAgentService 接口 (AgentService)
  │
  ▼
[bridge] AgentService.run()
  │
  ▼
[core] runAgent({pm, sessionId, input, signal})
  │
  │  ReactLoop.iterate()
  │    → MemoryProvider.buildContext()
  │    → InferenceEngine.infer()
  │    → AgentToolRegistry.execute()
  │    → AgentStreamController.enqueue()
  │
  ▼
[bridge] createSSEResponse(stream.fullStream)
  │
  ▼
[web] useSSE → parseSSEStream()                 ← 直接从 bridge/sse 导入
  │
  ▼
[web] reduceStreamChunk(parts, chunk)            ← 复用 bridge stream-reducer
  │
  ▼
React 渲染
```

### 7.1 TUI 双模式对比

```
┌─ 远程模式 (当前) ─────────────────────┐
│                                       │
│  [tui] AgentRemoteService             │
│          │ HTTP fetch + SSE           │
│          ▼                            │
│  [server] API route → AgentService    │
│              → core.runAgent()        │
│                                       │
└───────────────────────────────────────┘

┌─ 本地模式 (直调) ─────────────────────┐
│                                       │
│  [tui] AgentService                   │
│          │ 直接调用                    │
│          ▼                            │
│  [core] runAgent()                    │
│                                       │
└───────────────────────────────────────┘

切换方式: TUIApp 构造函数接收 IAgentService
  - 远程: new AgentRemoteService('http://localhost:8321')
  - 本地: new AgentService(providerManager)
```

---

## 8. 文件数量对比

| 包 | 当前 | 修正后 | 变化 |
|----|------|--------|------|
| core | 78 | 75 | -3 (删除 core-agent + ui/*，新增 agent-factory + 拆分文件) |
| bridge | 8 | 13 | +5 (interface + agent-service + agent-remote-service + stream-tap + content-builder + stream-reducer, client.ts 重写) |
| web | 22 | 20 | -2 |
| tui | 5 | 8 | +3 |
| demo | 2 | 2 | 0 |

### 新建

| 包 | 文件 | 来源 |
|----|------|------|
| core | `agent-factory.ts` | 从 core-agent.ts 提取 createAgentFromEnv |
| core | `loop-types.ts` | 从 loop-strategy.ts 拆分接口 |
| core | `stream/stream-aggregators.ts` | 从 agent-stream.ts 拆分 |
| core | `llm/stream-collector.ts` | 从 llm/types.ts 拆分 |
| core | `llm/providers/openai-adapter.ts` | 从 openai.ts 拆分 |
| core | `llm/providers/anthropic-adapter.ts` | 从 anthropic.ts 拆分 |
| core | `plugins/config/default/config-loader.ts` | 从 index.ts 拆分 |
| core | `plugins/config/default/config-parser.ts` | 从 index.ts 拆分 |
| core | `plugins/config/default/config-merger.ts` | 从 index.ts 拆分 |
| core | `plugins/session/base.ts` | 提取 file+local 基类 |
| core | `plugins/skill/default-catalog.ts` | 从 sdk/skill-provider 移入 |
| core | `plugins/tool/file-system/edit-schemas.ts` | 从 edit.ts 拆分 |
| core | `plugins/tool/file-system/edit-recovery.ts` | 从 edit.ts 拆分 |
| bridge | `agent-service.interface.ts` | 新建：IAgentService 统一接口 |
| bridge | `agent-remote-service.ts` | 从 client.ts 重写，实现 IAgentService |
| bridge | `stream-tap.ts` | 从 agent.ts 拆分 |
| bridge | `content-builder.ts` | 从 agent.ts 拆分 |
| bridge | `stream-reducer.ts` | 新建 |
| tui | `ui-layout.ts` | 从 app.ts 拆分 |
| tui | `session-picker.ts` | 从 app.ts 拆分 |
| tui | `commands.ts` | 从 app.ts 拆分 |

### 删除

| 包 | 文件 | 原因 |
|----|------|------|
| core | `core-agent.ts` | 合并到 run-agent，唯一入口 |
| core | `security/approval-hook.ts` | 死代码 |
| core | `ui/types.ts` | 依赖 CoreAgent，无其他引用 |
| core | `ui/session.ts` | 依赖 CoreAgent，无其他引用 |
| core | `ui/index.ts` | 目录删除 |
| bridge | `client.ts` | 重写为 agent-remote-service.ts |
| web | `lib/agent-client.ts` | 用 bridge AgentRemoteService 替代 |
| web | `lib/stream-parser.ts` | 直接从 bridge/sse 导入 |

### 重命名

| 包 | 旧名 | 新名 | 原因 |
|----|------|------|------|
| bridge | `agent.ts` | `agent-service.ts` | 与 agent-remote-service 命名对称 |
| bridge | `client.ts` | `agent-remote-service.ts` | AgentRemoteService 实现 IAgentService |

---

## 9. 实施优先级

```
Phase 0 (立即)
  ├── 删除 approval-hook.ts 死代码
  ├── 修复 tool-policy-pipeline.ts alsoAllow Bug
  └── 修复 sdk/index.ts 重复导出

Phase 1 (P0)
  ├── 新建 IAgentService 接口 + 重命名 AgentClient → AgentRemoteService
  ├── AgentService 实现 IAgentService
  ├── 删除 core-agent.ts，createAgentFromEnv 移到 agent-factory.ts
  ├── 删除 ui/ 目录
  ├── 拆分 tui/app.ts (4 文件)
  └── 拆分 loop-strategy.ts (loop-types + loop-strategy)

Phase 2 (P1)
  ├── 新建 bridge/stream-reducer.ts
  ├── web session-store + tui handleChunk 改用 stream-reducer
  ├── 提取 session base.ts 基类
  └── 拆分 bridge/agent-service.ts (stream-tap + content-builder)

Phase 3 (P2)
  ├── web 删除 agent-client.ts + stream-parser.ts
  ├── web 改用 IAgentService (AgentRemoteService) + bridge/sse 直导
  ├── TUIApp 构造函数改为接收 IAgentService
  ├── demo 根据模式注入 AgentService 或 AgentRemoteService
  ├── 拆分 plugins/config/default/
  ├── 拆分 llm/providers/ (adapter)
  ├── llm/types 拆出 stream-collector
  └── sdk/skill-provider 移出 DefaultSkillCatalog

Phase 4 (P3)
  ├── 拆分 stream/agent-stream.ts
  ├── 拆分 edit.ts
  ├── 修复插件层 SDK-only 依赖
  └── 低严重度优化项
```

---

*预期架构规划完成：2026-06-30*
