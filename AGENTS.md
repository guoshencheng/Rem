---
# AGENTS.md — Rem Agent 项目规则手册
# 这是规则手册，不是变更日志。只放"下次 AI 写代码时必须看到"的信息。
---

# Rem Agent

一个 Agent-first 的 TypeScript 通用 Agent Harness 系统，聚焦 Agent 推理循环、状态、事件、预算与工具。

## 项目结构

```text
packages/
  core/    — rem-agent-core：生命周期、ReAct 循环、事件、预算、LLM 抽象层
  bridge/  — rem-agent-bridge：HTTP client/server、SSE 编解码、AgentService / LocalAgentService
  routes/  — rem-agent-routes：REM API 路由包（createRemHandler + rem-routes init CLI）
  ui/      — rem-agent-ui：React 聊天组件包（<RemApp /> / <RemChat /> 必传 service；<RemLocalApp /> 见 rem-agent-ui/local）
  web/     — rem-agent-web：Next.js 15 + React 19 宿主应用（薄组合层）
  local-demo/ — rem-agent-local-demo：纯前端 Vite demo（浏览器内跑 Agent，凭据存 IndexedDB）
```

架构与设计细节见 `docs/architecture.md` 和 `docs/core-design.md`。

## 开发环境

- Node.js >= 22.19.0（pi-ai 引擎要求）
- pnpm

## 开发命令

| 命令 | 作用 |
|---|---|
| `pnpm install` | 安装依赖 |
| `pnpm test` | 运行所有测试（vitest） |
| `pnpm typecheck` | 全仓类型检查 |
| `pnpm --filter rem-agent-core typecheck` | 仅检查 core |

## 红线与边界

### 1. Provider 配置由 Core 拥有

**Provider 的认证、默认模型、baseURL 等配置必须在 `rem-agent-core` 内部解析。** Demo、CLI 或其他客户端**禁止**直接读取 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY` 等环境变量。

客户端应调用 Core 提供的入口：

```typescript
import { createAgentFromEnv } from 'rem-agent-core';

const agent = await createAgentFromEnv();
```

Core 在 `assembly/agent-factory.ts` 中通过 `createAgentFromEnv` 读取环境变量，并构造 `AgentAssembly`（`AgentDI` 含 `models` 与全部 provider；`AgentRuntimeConfig` 含 `securityMode` 与 `runtime`）。实际的 LLM 调用由 `@earendil-works/pi-ai` 的 `Models` 集合统一处理。

服务宿主（如 bridge `AgentService`）需要构造/init 分离时，改用 `createAgentAssembly` 同步装配 + 内联异步初始化（`configProvider.init` / `storage.init` / `initRuleEngine` / MCP connectAll）。

- ✅ 客户端只处理自身层次的配置（如通过 `createAgentFromEnv` 传入 `paths`、`storageProvider` 等装配选项；行为配置走配置文件或自定义 `ConfigProvider`）。
- ❌ 客户端不直接导入 `openai` 或 `@anthropic-ai/sdk`，不读 `OPENAI_API_KEY`。

### 2. 模块拆分遵循 module-separation-convention

创建、修改、重构 TypeScript 模块时，必须使用已安装的 `module-separation-convention` skill。保持文件精简、职责单一、模块独立维护。

### 3. 不依赖 Vercel AI SDK，Agent 控制自有

`packages/core` **不依赖** `ai` 包。所有 LLM 调用通过 `@earendil-works/pi-ai` 的 `Models` 集合进行。Agent 推理循环复用 `@earendil-works/pi-agent-core` 导出的**无状态** `runAgentLoop` / `runAgentLoopContinue`；**不使用**其 `Agent` 类——transcript / steering / follow-up / abort / maxTurns 由 `REMAgent` 自己持有（`agent/rem-agent.ts` 直调 loop 函数，loop 入参（`AgentContext`/`AgentLoopConfig`/`streamFn`）在首次 run 时惰性组装（幂等可重入）），为多 Agent 扩展保留完全控制权。不交给 Vercel AI SDK 或外部 Agent 类管理。

### 4. 直接复用 pi-ai 类型

- `ToolSet` 统一为 `pi.Tool[]`；`ToolProvider.getToolSet()` 直接返回可传给 `pi-ai.Context.tools` 的数组。
- Core 内部消息类型统一为 `pi.Message`；不再维护 `ModelMessage` / `ContentPart` 等自建表示层。
- 旧 schema v1 session 数据不再兼容；加载时会抛出 `UnsupportedSessionSchemaError`。

## 常用入口

| 文件 | 用途 |
|---|---|
| `packages/core/src/assembly/agent-factory.ts` | `createAgentFromEnv` |
| `packages/core/src/agent/rem-agent.ts` | `REMAgent`：new（同步）后直用；loop 入参（`AgentContext`/`AgentLoopConfig`/`streamFn`/`maxTurns`）在每次 `run`/`continue` 时惰性组装（幂等可重入）；持有 transcript / 队列 / abort，直调 pi-agent-core 的 `runAgentLoop` / `runAgentLoopContinue` |
| `packages/core/src/runtime/generation/generate.ts` | `generate()`：使用 `models.complete` 执行非流式生成（标题/压缩摘要） |
| `packages/core/src/infrastructure/llm/models.ts` | `createCoreModels`：pi-ai `Models` 集合初始化 |
| `packages/core/src/infrastructure/llm/context-window.ts` | 上下文窗口大小解析 |
| `packages/core/src/assembly/agent-context-assembler.ts` | `assembleAgentContext`：纯装配函数，全部 provider 可注入 |
| `packages/core/src/assembly/agent-assembly.ts` | `createAgentAssembly`（同步装配） |
| `packages/bridge/src/local/agent-local-service.ts` | `LocalAgentService`：浏览器内 AgentService（`rem-agent-bridge/local`） |
| `packages/routes/src/router.ts` | `createRemHandler`：REM API 路由分发 |
| `packages/routes/src/cli.ts` | `rem-routes init`：生成宿主薄壳路由 |
| `packages/ui/src/components/rem-app.tsx` | `<RemApp />` 完整聊天应用 |
| `packages/ui/src/components/rem-chat.tsx` | `<RemChat />` 单独聊天框 |
| `packages/ui/src/components/rem-local-app.tsx` | `<RemLocalApp />` 纯前端聊天应用（内置 key 设置，`rem-agent-ui/local`） |
| `packages/ui/src/components/rem-local-chat.tsx` | `<RemLocalChat />` 纯聊天版（无侧栏，sessionId 缺省自动创建，`rem-agent-ui/local`） |

## 深入文档

| 主题 | 文件 |
|---|---|
| 系统架构 | `docs/architecture.md` |
| 模块级参考 | `docs/module-reference.md` |
| 边界审查报告（2026-06-30，历史） | `docs/boundary-review.md` |
| 预期架构（已基本落地，历史） | `docs/target-architecture.md` |
| Core 层早期设计（历史） | `docs/core-design.md` |
| Core API 与事件 | `packages/core/README.md` |

## 测试

- 单元测试放在 `packages/core/tests/`；测试专用 in-memory fake（`InMemoryToolProvider` / `InMemorySessionProvider`）在 `packages/core/tests/helpers/`。
- 运行测试前确保类型检查通过：`pnpm typecheck && pnpm test`。

## 语言

会话、文档请使用中文

