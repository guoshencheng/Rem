---
# AGENTS.md — Rem Agent 项目规则手册
---

# Rem Agent

一个 Agent-first 的 TypeScript 企业 Runtime。活动代码使用 Runtime 单栈：所有执行从
`AgentRuntime.startRun(agentId, trigger)` 开始，接入层只包装 Core，不重新实现 Agent 生命周期。

## 项目结构

```text
packages/core/    — Runtime、Run、Session、Worker、Journal、Plugin 和 Storage
packages/service/ — /v1 HTTP/SSE 适配
packages/client/  — RuntimeClient 远程 SDK
packages/web/     — Runtime Workbench
archive/          — 历史实现，只读
```

## 开发命令

| 命令 | 作用 |
|---|---|
| `pnpm install` | 安装依赖 |
| `pnpm build` | 构建 Core、Service、Client、Web |
| `pnpm typecheck` | 全仓类型检查 |
| `pnpm test` | Core、Service、Client、Web 测试 |
| `pnpm check:structure` | 检查 Core 模块边界与文件大小 |

## 红线与边界

1. 完整 Agent 能力必须在 Core：Session、Run、Worker、租约、消息持久化、单 Agent、Team、
   child、预算、中止、waiting 和 Artifact 都不能由 Service/Web 重实现。
2. 活动源码只使用 `AgentRuntime`、`RuntimeStorageProvider`、`RuntimeConfigProvider`、
   `AgentDefinitionProvider` 和 `RuntimePlugin`。根入口不得重新导出旧系统、旧 Thread、旧
   workspace 或旧事件总线。
3. Provider 认证、模型、baseURL 和默认行为由 Core 配置端口解析。Client/Web 不读取
   `OPENAI_API_KEY`、`DEEPSEEK_API_KEY` 等环境变量。
4. Core 不依赖 Vercel AI SDK；Agent Loop 使用 `@earendil-works/pi-agent-core` 的无状态
   `runAgentLoop` / `runAgentLoopContinue`，transcript、Abort、maxTurns 和 journal 由 Runtime 持有。
5. `RuntimeStorage` 的事务 callback 必须同步；Run、Event、ToolInvocation、Artifact 和
   Session entry 的事实写入必须在明确的事务边界内完成。
6. 高频 token/reasoning 只走结构化 Signal；最终模型消息、工具结果和控制动作写入 journal。
   SSE 断开不取消 Run，unknown 工具结果不得被静默重放。
7. 所有 TypeScript 模块遵循 `module-separation-convention`：职责单一，源码实现文件不超过
   200 行，类型文件不超过 250 行，测试不超过 350 行，局部导入使用 `.js` 扩展名。
8. `archive/` 只读。除非用户明确要求，不修改、恢复或重新接入历史实现。

## 公开入口

```typescript
import { createAgentRuntimeFromEnv } from 'rem-agent-core';

const runtime = await createAgentRuntimeFromEnv({ agentDefinitions });
const scoped = runtime.as({ tenantId, principalId, claims });
const run = await scoped.runs.start({ agentId, trigger });
```

Runtime 创建时必须显式提供 `AgentDefinitionProvider`；默认 Config、SQLite、模型集合和日志
由 `createAgentRuntimeFromEnv` 装配。`executionRoot` 在创建时固定，不在执行中读取当前目录。

## 测试与交付

- 单元测试放在 `packages/core/tests/`；Fake Storage 与 SQLite 共享 Runtime 契约。
- 修改完成后运行：

  ```bash
  pnpm build && pnpm typecheck && pnpm test && pnpm check:structure && git diff --check
  ```

- 变更前检查 `rg "AgentSystem|SessionRuntime|/api/rem|workspace" packages/core/src packages/web/src`；
  活动源码不得重新引入这些旧概念。

## 深入文档

- 当前架构：`docs/architecture.md`
- Service/Client：`docs/service-client.md`
- Runtime 单栈计划：`docs/superpowers/plans/2026-08-14-runtime-single-stack-cutover.md`
- 历史实现：`archive/`

## 语言

会话、文档请使用中文。
