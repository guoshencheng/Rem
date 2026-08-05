---
# AGENTS.md — Rem Agent 项目规则手册
# 这是规则手册，不是变更日志。只放“下次 AI 写代码时必须看到”的信息。
---

# Rem Agent

一个 Agent-first 的 TypeScript 通用 Agent Harness。当前处于 Core-first 重建阶段。

## 项目结构

```text
packages/
  core/    — rem-agent-core：完整 Agent Harness 的唯一活动实现
archive/   — 旧 Core、Bridge、Routes、UI、Web 实现，仅供历史参考，不在活动 workspace 中修改
```

当前阶段先把 Session、单 Agent、一次性 child Agent、AgentThread、中心消息投影和 Organizer/Scheduler 完整建设在 Core，再重新向上建设接入层与 UI。

## 开发环境

- Node.js >= 22.19.0（pi-ai 引擎要求）
- pnpm

## 开发命令

| 命令 | 作用 |
|---|---|
| `pnpm install` | 安装依赖 |
| `pnpm build` | 构建 Core |
| `pnpm typecheck` | Core 类型检查 |
| `pnpm test` | 运行 Core 测试 |
| `pnpm check:structure` | 检查 Core 模块边界与文件大小 |

## 红线与边界

### 1. 完整 Agent 能力由 Core 拥有

Session、Agent runtime、消息持久化、事件驱动、单 Agent、child Agent、多 Agent调度、预算与中止都必须在 `rem-agent-core` 内实现。未来的接入层只能组装、序列化和包装 Core，不能重新承载 Agent 生命周期。

### 2. Provider 配置由 Core 拥有

Provider 的认证、默认模型、baseURL 等配置必须由 Core 解析。客户端禁止直接读取 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY` 等环境变量。

标准入口：

```typescript
import { createAgentFromEnv } from 'rem-agent-core';

const assembly = await createAgentFromEnv();
```

需要构造/init 分离时，使用 `createAgentAssembly` 同步装配，再调用 Core 的异步初始化入口。实际 LLM 调用统一通过 `@earendil-works/pi-ai` 的 `Models` 集合。

### 3. 模块拆分遵循 module-separation-convention

创建、修改或重构 TypeScript 模块时，必须使用已安装的 `module-separation-convention` skill。保持文件精简、职责单一、模块独立维护。

### 4. 不依赖 Vercel AI SDK，Agent 控制自有

Core 不依赖 `ai` 包。推理循环复用 `@earendil-works/pi-agent-core` 的无状态 `runAgentLoop` / `runAgentLoopContinue`，不使用其 `Agent` 类。transcript、steering、follow-up、abort 和 maxTurns 由 `REMAgent` 自己持有。

### 5. 直接复用 pi-ai 类型

- Tool 集统一为 `pi.Tool[]`。
- Core 消息内容使用 `pi.Message`。
- Harness 的作者、可见性、mentions 等编排元数据放在 Session entry 信封中，不修改 `pi.Message` 协议。
- 旧 schema v1 Session 不兼容，加载时抛出 `UnsupportedSessionSchemaError`。

### 6. archive 只读

`archive/` 是旧实现参考，不属于活动 workspace。除非用户明确要求，不在重建过程中修改或恢复 archive 内文件。

## 当前常用入口

| 文件 | 用途 |
|---|---|
| `packages/core/src/assembly/agent-factory.ts` | `createAgentFromEnv` |
| `packages/core/src/assembly/agent-assembly.ts` | `createAgentAssembly` |
| `packages/core/src/agent/rem-agent.ts` | 当前单 Agent 执行单元 |
| `packages/core/src/orchestration/agent-coordinator-types.ts` | AgentCoordinator 接口（按 Session mode 分发单/多 Agent 实现） |
| `packages/core/src/session/model.ts` | 当前持久化 Session 模型 |
| `packages/core/src/sdk/storage-provider.ts` | Storage Provider 稳定接口 |
| `packages/core/src/plugins/storage/sqlite/` | 默认 SQLite 存储实现 |

## 深入文档

| 主题 | 文件 |
|---|---|
| Core Agent System 重建设计 | `docs/superpowers/specs/2026-07-31-core-agent-system-rebuild-design.md` |
| 当前架构 | `docs/architecture.md` |
| Core 模块参考 | `docs/module-reference.md` |
| Core 早期设计（历史） | `docs/core-design.md` |
| 旧实现 | `archive/` |

## 测试

- 单元测试放在 `packages/core/tests/`。
- 测试专用 fake 位于 `packages/core/tests/helpers/`。
- 完成修改后运行 `pnpm build && pnpm typecheck && pnpm test`。
- 结构检查当前全绿，不得新增结构违规。

## 语言

会话、文档请使用中文。
