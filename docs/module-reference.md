# Rem Agent — Core 模块参考

> 状态：Core-first 重建阶段（2026-07-31）

活动 workspace 只有 `packages/core`。旧模块可在 `archive/` 中查阅，但不属于当前代码边界。

## 顶层入口

| 文件 | 职责 |
|---|---|
| `src/index.ts` | Core 公共 barrel 导出 |
| `src/compat.ts` | 临时兼容导出集中入口 |
| `src/assembly/agent-factory.ts` | 从 Core 配置环境装配 Agent |
| `src/assembly/agent-assembly.ts` | 同步构造 AgentDI 与 runtime config |

## 当前目录

### `agent/`

单 Agent执行域。`rem-agent.ts` 持有 transcript、消息队列和 abort，直接调用 pi-agent-core 无状态 loop；`agent-run-state.ts` 归并一次 run；`agent-event.ts`、`bus-events.ts` 和 `broadcast-bus.ts` 定义事件。

### `assembly/`

装配边界。包含 `AgentDI`、runtime config、Agent context assembler，以及 `createAgentAssembly` / `createAgentFromEnv`。

### `capabilities/`

可选业务能力。当前包含 session Todo 服务与 `delegate_task` 定义、执行器和结果格式化。

### `infrastructure/`

技术基础设施：配置路径、pi-ai Models、context window、MCP 连接与工具适配、debug log。

### `plugins/`

SDK 默认实现：budget、compressor、config、error、memory、session、skill、storage、title 和 tool。SQLite schema、SessionStore、archive、todo、workspace 存储位于 `plugins/storage/sqlite/`。

### `runtime/`

REMAgent 运行辅助模块。`agent-tools.ts` 组合工具，`compression-transform.ts` 连接上下文压缩与归档，`pending-queue.ts` 管理 steering/follow-up 消息。

### `sdk/`

稳定抽象接口。当前包括 Agent role、budget、compressor、config、error、session、skill、storage、system prompt、title、tool policy 和 tool provider。

### `security/`

安全策略：approval、permissions、rules、tool policy 和 workspace 根目录守卫。

### `session/`

持久化 Session 领域。`model.ts` 定义 schema v2 Session；`tree/` 定义 message entry 与 conversation 构建；`manager/` 提供通用 CRUD 和 UI-neutral 查询逻辑。

### `shared/`

无业务依赖的共享工具。当前提供 ID 生成。

### `system-prompt/`

system prompt 模板选择和装配，包含 sections、templates 与 loaders。

### `tools/`

Tool provider 组合、overlay、registry 和 prompt tool summary。

## 当前重要类型流

```text
SessionProvider / StorageProvider
        ↓
Session(pi.Message[])
        ↓
REMAgent
        ↓
runAgentLoop / runAgentLoopContinue
        ↓
REMAgentEvent / AgentOutput
```

## 计划模块

以下模块属于已批准设计，尚未全部实现：

| 计划模块 | 目标职责 |
|---|---|
| `system/` | `AgentSystem` 公共门面与完整 Core 装配 |
| `session/runtime.ts` | Session 级长期运行态 |
| `session/runtime-registry.ts` | 按 sessionId 管理运行态 |
| `session/messages/` | 中心 entry 元数据、串行 append、聊天投影 |
| `session/agent-thread/` | AgentThread 类型、持久化、runtime 和上下文投影 |
| `agent/agent-run-driver.ts` | 消费 REMAgent 事件并协调持久化与系统事件 |
| `delegation/delegation-runner.ts` | one-shot child Session/Agent 执行 |
| `orchestration/` | Organizer、Scheduler、Delivery、讨论预算与终止协议 |
| `workspace/` | Core workspace 应用服务 |

详细边界和阶段见 `docs/superpowers/specs/2026-07-31-core-agent-system-rebuild-design.md`。
