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
  bridge/  — rem-agent-bridge：HTTP client/server、SSE 编解码、AgentService
  web/     — rem-agent-web：Next.js 15 + React 19 聊天 UI
  tui/     — rem-agent-tui：基于 @opentui/core 的终端 UI 组件
```

架构与设计细节见 `docs/architecture.md` 和 `docs/core-design.md`。

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

const agent = createAgentFromEnv({ name: 'MyAgent', maxTurns: 60 });
```

Core 通过 `resolveProviderConfig(provider)` 读取环境变量并返回 `ProviderConfig`。

- ✅ 客户端只处理自身层次的配置（如通过 `createAgentFromEnv` 传入 `name`、`maxTurns`）。
- ❌ 客户端不导入 `openai` SDK，不读 `OPENAI_API_KEY`。

### 2. 模块拆分遵循 module-separation-convention

创建、修改、重构 TypeScript 模块时，必须使用已安装的 `module-separation-convention` skill。保持文件精简、职责单一、模块独立维护。

### 3. 不依赖 Vercel AI SDK

`packages/core` **不依赖** `ai` 包。所有 LLM 调用通过自建 Provider 层（`InferenceEngine` + `LLMProvider` registry）直接调用 `openai` / `@anthropic-ai/sdk`。循环逻辑由 `ReactLoop` / `LoopStrategy` 自己实现，不交给 Vercel AI SDK 管理。

## 常用入口

| 文件 | 用途 |
|---|---|
| `packages/core/src/core-agent.ts` | `CoreAgent`、`createAgentFromEnv` |
| `packages/core/src/loop-strategy.ts` | `ReactLoop` / `LoopStrategy` |
| `packages/core/src/llm/api-registry.ts` | Provider 注册与 `resolveProviderConfig` |
| `packages/core/src/llm/providers/openai.ts` | OpenAI provider + `resolveConfig` |
| `packages/core/src/llm/providers/anthropic.ts` | Anthropic provider + `resolveConfig` |

## 深入文档

| 主题 | 文件 |
|---|---|
| 系统架构 | `docs/architecture.md` |
| 预期架构（重构目标） | `docs/target-architecture.md` |
| 模块边界审查 | `docs/boundary-review.md` |
| 模块级参考 | `docs/module-reference.md` |
| Core 层设计 | `docs/core-design.md` |
| Core API 与事件 | `packages/core/README.md` |

## 测试

- 单元测试放在 `packages/core/tests/`。
- 运行测试前确保类型检查通过：`pnpm typecheck && pnpm test`。

## 语言

会话、文档请使用中文