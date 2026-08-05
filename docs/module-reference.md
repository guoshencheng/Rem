# Rem Agent — Core 模块参考

> 状态：Core-first 多 Agent 执行内核已落地（2026-08-02）

活动 workspace 只有 `packages/core`。旧模块可在 `archive/` 中查阅，但不属于当前代码边界。

## 顶层入口

| 文件 | 职责 |
|---|---|
| `src/index.ts` | Core 公共 barrel 导出 |
| `src/assembly/agent-factory.ts` | 从 Core 配置环境装配 Agent |
| `src/assembly/agent-assembly.ts` | 同步构造 AgentDI 与 runtime config |

## 当前目录

### `agent/`

单 Agent执行域。`rem-agent.ts` 持有 transcript、消息队列和 abort，直接调用 pi-agent-core 无状态 loop；`agent-run-state.ts` 归并一次 run；`agent-event.ts`、`bus-events.ts` 和 `broadcast-bus.ts` 定义事件。

### `assembly/`

装配边界。包含 `AgentDI`、runtime config、Agent context assembler，以及 `createAgentAssembly` / `createAgentFromEnv`。同步装配会执行已配置的 `AgentPlugin`，并将最终 `SystemPromptAssembler` 注入 `AgentDI`。

### `capabilities/`

可选业务能力。当前包含 session Todo 服务与 `delegate_task` 定义、执行器和结果格式化。

### `infrastructure/`

技术基础设施：配置路径、pi-ai Models、context window、MCP 连接与工具适配、debug log。

### `plugins/`

SDK 默认实现：budget、compressor、config、error、memory、session、skill、storage、title 和 tool。SQLite schema、SessionStore、archive、todo、workspace 存储位于 `plugins/storage/sqlite/`。

### `plugin-system/`

Agent 装配期插件机制。`plugin-host.ts` 校验插件身份并按配置顺序执行注册；`errors.ts` 定义插件和 prompt section 装配错误。该目录不保存 SDK Provider 的默认实现。

### `runtime/`

REMAgent 运行辅助模块。`agent-tools.ts` 组合工具，`compression-transform.ts` 连接上下文压缩与归档，`pending-queue.ts` 管理 steering/follow-up 消息。

### `sdk/`

稳定抽象接口。当前包括 Agent role、budget、compressor、config、error、session、skill、storage、system prompt、title、tool policy 和 tool provider。插件相关稳定接口包括 `AgentPlugin`、`PromptSectionRegistry` 和 `SystemPromptAssembler`。

### `security/`

安全策略：approval、permissions、rules、tool policy 和 workspace 根目录守卫。

### `session/`

持久化 Session 领域。`model.ts` 定义 schema v2 Session；`tree/` 定义 message entry 与 conversation 构建；`messages/` 负责中心消息信封、Session keyed 写入协调和聊天/Thread 投影；`agent-thread/` 保存配置 `agentId`；`agent-thread-runtime.ts` 为每个长期 Agent 提供 REMAgent FIFO 执行权。

### `orchestration/`

Session 运行时协调域。`agent-coordinator-types.ts` 定义 `AgentCoordinator` 接口（createRuntime / send / interrupt / recoverProcessing）与共享 deps（Agent 创建统一走 `createRootAgent` 工厂）；`coordinator-resolver.ts` 按 `Session.metadata.mode` / `runtime.mode` 分发到对应实现。`single-agent-coordinator.ts` 驱动单 Agent 路径（一个 REMAgent 一次 run 到底）。多 Agent 侧：`delivery-*` 定义持久投递与状态机；`scheduler.ts` 负责 claim、并发限制、批次完成和 resume；`multi-agent-coordinator.ts` 实现 Team Session 的 `AgentCoordinator`；`multi-agent-actions.ts` 实现 `send_message` / `finish_discussion` 的当前 Delivery 语义；`discussion-runtime.ts` 与 `discussion-budget.ts` 管理单次讨论、中止和五类预算。

### `system/`

传输无关的 Core 门面。`create-agent-system.ts` 完成用例、Runtime、Delegation 和各 mode Coordinator 的装配与注册；`agent-system.ts` 是纯门面——Session CRUD、Thread/聊天/上下文查询与事件流，运行时操作经 `AgentCoordinatorResolver` 按 mode 分发，自身不持有 mode 分支。

### `delegation/`

一次性 child Agent 执行。每次委派创建独立 child Session 与 one-shot AgentThread，临时 REMAgent 完成后释放；启动恢复只收敛遗留运行状态。

### `shared/`

无业务依赖的共享工具。当前提供 ID 生成。

### `system-prompt/`

system prompt 模板选择和装配，包含默认 section 构造、事务式 section registry、sections、templates 与 loaders。普通 section 可由插件按名称替换和重排；`runtime` 内容可替换但位置固定在最后。

### `tools/`

Tool provider 组合、overlay、registry 和 prompt tool summary。

## 当前重要类型流

```text
SessionProvider / StorageProvider
        ↓
Session tree entries（唯一消息事实）
        ↓
SessionRuntime
        ↓
AgentThreadRuntime → REMAgent
        ↓
runAgentLoop / runAgentLoopContinue
        ↓
REMAgentEvent → Message / Delivery / AgentSystemEvent
```

## AgentSystem 主要查询

| API | 含义 |
|---|---|
| `createSession({ workspace, teamId? })` | 没有 teamId 为单 Agent；显式 teamId 为多 Agent |
| `send({ sessionId, content })` | 用户只面向 Session；多 Agent由 Organizer 首先处理 |
| `getSessionThreads(sessionId)` | 查询该 Session 的 AgentThread |
| `getSessionChat(sessionId)` | 投影中心公开聊天 |
| `getAgentThreadContext(sessionId, agentThreadId)` | 投影指定 Agent 的模型输入视角 |
| `interrupt(sessionId)` | 中止 Session 中全部运行 Agent，并收敛 Delivery |
