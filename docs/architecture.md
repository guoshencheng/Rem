# Rem Agent 当前架构

> 状态：Runtime 单栈切换完成（2026-08-14）

## 活动边界

`packages/core` 是唯一的 Agent 执行内核，公开入口是 `AgentRuntime`、`RuntimeClient`
使用的 `/v1` Service 协议，以及 Runtime Plugin/Storage/Config 端口。`packages/web`
只负责 Workbench 展示、用户输入和 HTTP/SSE 调用；它不持有 Agent 生命周期、Worker、租约或
工具状态机。`archive/` 仅供历史查阅，不参与活动构建。

活动执行路径固定为：

```text
企业应用 → RuntimeClient → HTTP/SSE Service → AgentRuntime → LocalRunWorker
                                                    ↓
                                  AgentDefinition + Context Plugins + Runtime Tools
                                                    ↓
                                  Run / Journal / Session / Artifact / ToolInvocation
```

Core 不依赖 HTTP、SSE 或 React。Service 负责认证上下文、序列化、错误映射和请求边界；
Client 负责日期解码、SSE 校验和断线兜底。宿主负责 Runtime 的创建、初始化和关闭。

## Core 分层

```text
packages/core/src/
├── domain/          Run、Session、AgentDefinition、Context、Event、Artifact 类型与状态机
├── application/     startRun、查询、Context patch、工具处置和 Runtime facade
├── execution/       Agent Loop、单 Agent/Team/child、Worker、journal、lease、工具审计
├── assembly/        createAgentRuntime / createAgentRuntimeFromEnv
├── sdk/             Runtime Storage、Config、Plugin、Tool 和 AgentDefinition 端口
├── plugins/         默认配置、静态 Definition、Runtime SQLite、静态 Tool Provider
├── plugin-system/   Runtime Plugin 注册、版本和 Context materialize 边界
├── runtime-events/  Run SignalHub 与订阅背压
├── infrastructure/  LLM、日志、路径和模型适配
└── shared/          无业务依赖的共享工具
```

根导出只包含 Runtime API：`createAgentRuntime`、`createAgentRuntimeFromEnv`、
`AgentRuntime`、Run/Session/Artifact/Execution 类型、Runtime Plugin/Tool/Config/Storage
端口、`StaticAgentDefinitionProvider` 和 `SqliteRuntimeStorageProvider`。旧 AgentSystem、
旧 Session Runtime、Thread、workspace、旧 Team API 和旧事件总线不属于活动源码。

## Runtime 请求路径

所有执行统一从 `startRun(agentId, trigger)` 开始：

1. `StartRunUsecase` 校验 trigger、task schema、租户和幂等键。
2. `AgentDefinitionProvider` 固化 revision，Context Plugin 解析并快照 Context、工具、配置层和 prompt sections。
3. 单事务写入 Session（需要时）、Run、`run.created`、WorkItem 和幂等记录。
4. `LocalRunWorker` claim lease，写入 `run.started`，按 Definition 选择 single-agent 或 team executor。
5. Agent Loop 只接收不可变 transcript、system prompt、模型配置、工具、预算和 AbortSignal。
6. ToolInvocation 按 planned → executing → succeeded/failed/unknown 审计；unknown 将 Run 置为 waiting。
7. 完整模型消息、工具结果和控制动作写入 execution journal；token/reasoning 增量只走 Signal。
8. `RunOutcomePersistence` 在单事务中提交 Session entries、Artifact、终态事件和 WorkItem 收尾。

Run、ExecutionNode、ExecutionEntry、Delivery、ToolInvocation 和 Artifact 是最终事实；
Signal 是可丢失的实时投影。Worker 重启后从持久化 journal、lease 和 invocation 状态恢复，
不依赖内存 Agent。

## Team、child 与 waiting

Team 由 `AgentDefinition.execution.type = "team"` 表达。Organizer、member 和 delegated
节点都属于同一个 root Run；不会创建独立外部 Run 或 Session。成员 revision、工具、模型、
Schema 和预算在启动时固化到 `ExecutionPlanSnapshot`。默认预算为：

```text
maxAgentRuns=20  maxMessages=50  maxDepth=8
timeoutMs=300000  maxTokens=200000  maxParallelAgents=4
```

Team 采用 Organizer-first 的持久化调度：启动时只创建 Organizer 的初始 Delivery，成员保持
`idle`；Organizer 或 Member 通过内部 `send_message` 追加一份中央消息和同批 Deliveries。
同一 node 串行、不同 node 按 `maxParallelAgents` 并行；批次全部进入终态后只创建一个确定性
resume Delivery，Organizer 再继续收尾。Delivery 的来源、请求节点、attempt 和结果入口都写入
Execution Graph，重启时可以从同一 node checkpoint 继续，不重新生成旧工具调用。

`unknown` ToolInvocation 只能由已有 Run 访问权限的操作者处置：

- `confirm-succeeded`：写入人工结果、追加 toolResult journal，并重新排队 Run；
- `retry`：只对无副作用、幂等或支持幂等键的工具执行；
- `fail`：与 Run failed 在同一事务中终结。

每个处置请求必须提供幂等键；状态漂移返回 `RUN_CONFLICT`，同键不同请求返回
`IDEMPOTENCY_CONFLICT`。

## 实时流

`GET /v1/runs/:runId/stream` 使用结构化 SSE，兼容生命周期 `run.*`、`tool.*`，并提供
`assistant.text.delta`、`assistant.reasoning.delta`、`assistant.message.completed` 与
`tool.execution.*`。SignalHub 为慢订阅者限制待消费队列；断开不会取消 Run。Client 健康流
只在终态读取一次 Run，流提前关闭才启用兜底查询，不补回丢失 token。

## Storage 与配置

`RuntimeStorageProvider` 暴露 `init`、`close`、`checkHealth` 和 `runtimeStore`。SQLite Provider 只创建
Runtime 表：Session、Run、WorkItem、Event、Artifact、ToolInvocation、ExecutionNode、
ExecutionEntry 和 Delivery；已有数据库中的遗留表不读取、不删除。

`RuntimeConfigProvider` 只负责模型、行为默认值、工具策略、压缩和运行预算。Provider API Key
由 Core 从直接配置或 `<PROVIDER>_API_KEY`/`${VAR}` 解析，永不进入 Run、ExecutionPlan、
Signal 或日志。`executionRoot` 在 Runtime 创建时固定，Context snapshot 只能通过显式授权
的快照覆盖。

## 接入层约束

Service/Client/Web 只使用 `/v1`：agents、sessions、runs、execution、tool resolution、
contexts 和 artifacts。首页只请求 agents 与 sessions；选择 Session 后才请求 entries 和
runs。一次健康发送包含一次创建 Run、一次 SSE、一次终态 Run、一次 entries 和一次 sessions
刷新，不产生 Session entries N+1 请求。

面向企业系统集成时，优先使用 `ScopedAgentRuntime.tasks` 或 `RuntimeClient.tasks`。Task 只组合
现有 Run、Signal、Journal 和 Artifact，不绕过 Worker、租约、waiting 或幂等机制。宿主运维面
使用 `RuntimeObserver` 获取脱敏 best-effort 观测，使用 `runtime.health()`/`GET /v1/health`
判断 ready、degraded 或 stopped；Observer 不是审计事实，Run/Journal/ToolInvocation/Artifact
仍是恢复和对账的唯一事实来源。

详见 [Runtime Service 与 TypeScript Client](service-client.md) 和
[Runtime 单栈切换计划](superpowers/plans/2026-08-14-runtime-single-stack-cutover.md)。
