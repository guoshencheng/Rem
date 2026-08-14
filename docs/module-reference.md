# Rem Agent — Core 模块参考

> 状态：Runtime 单栈（2026-08-14）

活动源码位于 `packages/core/src`；`archive/` 仅供历史查阅。Core 根入口只导出 Runtime
接口和领域模型，Service、Client、Web 不拥有执行状态机。

## 顶层入口

| 文件 | 职责 |
|---|---|
| `src/index.ts` | Runtime 公共 barrel |
| `src/assembly/agent-runtime-assembly.ts` | `createAgentRuntime` / `createAgentRuntimeFromEnv` |
| `src/application/runtime/agent-runtime.ts` | 生命周期、租户 scoped facade |
| `src/application/runtime/scoped-agent-runtime.ts` | agents/sessions/runs/artifacts 操作 |

## 活动目录

### `domain/`

纯领域类型和状态机：`agent-definition/`（Definition、ExecutionPlan）、`run/`（Run、WorkItem、
ToolInvocation、Execution Graph）、`session/`、`context/`、`event/`、`artifact/`、`identity/` 和
`json/`。不读取环境变量或执行 I/O。

### `application/`

用例层。`runs/` 负责 start、查询、输入/Schema 校验、幂等、工具处置和执行计划；`contexts/`
负责 Context Resolver、插件工具定义和 canonical JSON；`runtime/` 提供生命周期、访问控制、
SSE/Signal 订阅和完成等待；`sessions/` 提供 Context 乐观并发 patch。

### `execution/`

`LocalRunWorker` 负责 claim、lease、heartbeat、取消、超时和恢复；`SingleAgentRunExecutor`
负责无状态 Agent Loop，`TeamRunExecutor` 负责 root Run 内的 organizer/member 节点，child
delegation 复用同一执行器。`RecordingToolProvider` 持久化工具生命周期，`run-execution-journal`
和 `run-outcome-persistence` 负责事实写入，`run-live-signal-projector` 负责实时投影。

### `runtime-events/`

`RunSignalHub` 是进程内可丢失 Signal 总线，具备订阅背压；持久化 RunEvent、SessionEntry、
ExecutionEntry、ToolInvocation 和 Artifact 才是最终事实。

### `sdk/`

窄化端口：`RuntimeConfigProvider`、`RuntimeStorageProvider`、`RuntimePlugin`、
`AgentDefinitionProvider`、`ToolProvider`、Runtime Storage repositories 和 Tool Policy。API Key
只停留在配置/模型调用边界，不写入 Run 或日志。

### `plugins/`

`agent-definition/static/` 提供静态 Definition；`config/default/` 读取 Runtime 模型和行为配置；
`storage/sqlite/` 提供 Runtime-only SQLite DDL、Store 和 repositories；`tool/static/` 提供进程内
工具集合。

### `plugin-system/`

`RuntimePluginHost` 校验插件 manifest、版本依赖和 Context materialize 边界。插件贡献的是
Context snapshot、config layers、prompt sections 和 Runtime tools，不直接访问未授权 Session/Run。

### `infrastructure/`

LLM Models、模型兼容层、Context window、日志和 Runtime 路径。`executionRoot` 在 Runtime 创建时
固定，Context snapshot 只能通过显式授权的快照覆盖。

### `security/tool-policy/`

仅负责工具 allow/deny、profile、provider 和 sender 规则的筛选；审批与文件根目录安全不属于
当前 Runtime 单栈切片。

### `shared/`

无业务依赖的共享工具，目前提供稳定 ID 生成。

## 重要类型流

```text
RuntimeRequestContext
        ↓
ScopedAgentRuntime.runs.start(agentId, trigger)
        ↓
StartRunUsecase → ContextResolver → ExecutionPlanSnapshot
        ↓
RuntimeStorage: Run + Event + WorkItem（同一事务）
        ↓
LocalRunWorker → SingleAgentRunExecutor / TeamRunExecutor
        ↓
Agent Loop → ToolInvocation / Execution Journal / Live Signal
        ↓
RunOutcomePersistence → SessionEntry + Artifact + terminal Run
```

## 公开 Runtime 操作

```text
agents.list/get
sessions.list/create/get/listEntries/patchContexts
runs.start/get/list/cancel/subscribe/waitForCompletion
runs.listExecutionNodes/listExecutionEntries/listDeliveries/listToolInvocations
runs.resolveToolInvocation
artifacts.listByRun/get
```

Team、child 和 waiting 都是 root Run 内部节点；不会创建独立外部 Run 或 Session。未知工具结果
只能通过幂等的 confirm-succeeded、受控 retry 或人工 fail 处置。完整接口和 HTTP 映射见
`docs/service-client.md` 与 `docs/architecture.md`。
