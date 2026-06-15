---
# CLAUDE.md — Agent Harness 项目规则手册
# 这是规则手册，不是变更日志。只放"下次 AI 写代码时必须看到"的信息。
---

# Agent Harness

一个 Agent-first 的 TypeScript 通用 Agent Harness 系统，聚焦 Agent 推理循环、状态、事件、预算与工具。

## 项目结构

```text
packages/
  core/   — @agent-harness/core：生命周期、ReAct 循环、事件、预算、LLM 抽象层
  demo/   — @agent-harness/demo：基于 core 的 TUI 演示程序
```

架构与设计细节见 `docs/architecture.md` 和 `docs/core-design.md`。

## 开发命令

| 命令 | 作用 |
|---|---|
| `pnpm install` | 安装依赖 |
| `pnpm test` | 运行所有测试（vitest） |
| `pnpm typecheck` | 全仓类型检查 |
| `pnpm --filter @agent-harness/core typecheck` | 仅检查 core |
| `pnpm --filter @agent-harness/demo start` | 运行 demo |

## 红线与边界

### 1. Provider 配置由 Core 拥有

**Provider 的认证、默认模型、baseURL 等配置必须在 `@agent-harness/core` 内部解析。** Demo、CLI 或其他客户端**禁止**直接读取 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY` 等环境变量。

客户端应调用 Core 提供的入口：

```typescript
import { createAgentFromEnv } from '@agent-harness/core';

const agent = createAgentFromEnv({ name: 'MyAgent', maxTurns: 60 });
```

Core 通过 `resolveProviderConfig(provider)` 读取环境变量并返回 `ProviderConfig`。

- ✅ Demo 只处理 `DEMO_AGENT_NAME`、`DEMO_MAX_TURNS` 等演示层配置。
- ❌ Demo 不导入 `openai` SDK，不读 `OPENAI_API_KEY`。

### 2. 模块拆分遵循 module-separation-convention

创建、修改、重构 TypeScript 模块时，必须使用已安装的 `module-separation-convention` skill。保持文件精简、职责单一、模块独立维护。

### 3. 不要引入 Vercel AI SDK 的 Loop 抽象

`packages/core` 使用 `ai` 包仅作底层模型调用（`generateText` / stream），不自建 loop 交给 Vercel AI SDK 管理。循环逻辑由 `AgentLoop` / `LoopStrategy` 自己实现。

## 常用入口

| 文件 | 用途 |
|---|---|
| `packages/core/src/core-agent.ts` | `CoreAgent`、`createAgentFromEnv` |
| `packages/core/src/loop-strategy.ts` | `ReactLoop` / `LoopStrategy` |
| `packages/core/src/llm/api-registry.ts` | Provider 注册与 `resolveProviderConfig` |
| `packages/core/src/llm/providers/openai.ts` | OpenAI provider + `resolveConfig` |
| `packages/core/src/llm/providers/anthropic.ts` | Anthropic provider + `resolveConfig` |
| `packages/demo/src/agent.ts` | Demo 层对 `CoreAgent` 的事件绑定 |
| `packages/demo/src/config.ts` | Demo 层配置（仅 `DEMO_*` 变量） |

## 深入文档

| 主题 | 文件 |
|---|---|
| 系统架构 | `docs/architecture.md` |
| Core 层设计 | `docs/core-design.md` |
| Core API 与事件 | `packages/core/README.md` |
| Demo 用法 | `packages/demo/README.md` |

## 测试

- 单元测试放在 `packages/core/tests/` 和 `packages/demo/src/*.test.ts`。
- 运行测试前确保类型检查通过：`pnpm typecheck && pnpm test`。
