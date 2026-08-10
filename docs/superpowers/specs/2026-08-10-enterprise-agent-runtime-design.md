# Rem Agent 企业 Agent 应用运行时设计

日期：2026-08-10  
状态：已确认，待实施  
范围：Core-first 重建后的下一阶段产品与架构目标

## 1. 决策摘要

Rem Agent 的专业化目标不是成为一个面向最终用户的开箱即用 Agent，也不是一个以聊天界面为中心的 Agent Builder。它要成为一套可嵌入、可独立部署的企业 Agent 应用运行时：让已有应用通过 TypeScript SDK 或标准服务 API，快速获得持久化、事件驱动、可恢复、可扩展并能调用企业工具与外部 Agent 服务的执行能力。

本设计采用以下核心决策：

- 交付形态同时支持嵌入式 TypeScript Core 和独立部署的 Agent Service。
- TypeScript-first，但保持协议中立，在系统边缘支持多语言和标准协议。
- `Run` 是统一执行模型；聊天、任务和事件只是不同的触发方式。
- `Session` 表示长期连续性，`SessionEntry` 表示未来 Agent 可见的上下文投影。
- `RunEvent` 是一次执行中发生事实的持久化记录，和 `SessionEntry` 分离。
- `Artifact` 是可供业务系统继续消费的工作产物。
- `ContextSet` 表达 Agent 当前所处的业务与执行现场，彻底取代 Core 中的 `workspace` 假设。
- `RuntimePlugin` 以成套方式为 Context 提供配置、工具、提示词、授权和 Artifact 等能力。
- `Team`、child Agent 和 AgentThread 是 Run 内部执行策略，不成为另一套外部任务模型。
- 首个纵向切片先完成单 Agent Run；不在第一阶段实现 Approval、Team、A2A 和分布式 Worker。
- 允许破坏现有公开 API 和持久化 Schema；旧开发数据不要求在线兼容。

产品定位可以概括为：

> Rem Agent 是一套可嵌入、可独立部署的企业 Agent 应用运行时。它以 Run 为执行中心，以 ContextSet 表达业务现场，以 Runtime Plugin 成套注入现场能力，并通过持久化事件与 Artifact 把 Agent 的工作结果交回业务系统。

## 2. 目标与非目标

### 2.1 目标

- 已有应用无需自行实现 Agent 生命周期，即可提交一个可执行、可查询、可取消的任务。
- Agent 能持续使用 Session 中的有效上下文，但一次 Run 的执行输入和解析结果可被固化和重现。
- Agent 能安全调用企业工具，并对工具调用、副作用和恢复状态提供可观察记录。
- 运行状态能在进程重启后恢复，调用方可以可靠查询结果。
- 同一套 Core 既能嵌入 Node.js 应用，也能由独立 Service 暴露远程 API。
- 企业可以通过 Runtime Plugin 注入自己的业务上下文和成套集成能力。
- Workbench 可以观察、调试和验证 Runtime，但不承载业务规则。

### 2.2 非目标

首个阶段不以以下内容为交付目标：

- 面向最终员工的通用聊天产品。
- 可视化低代码 Agent Builder。
- Approval、Policy Engine、预算和完整审计治理。
- Team、A2A、复杂 child Agent 编排。
- 分布式 Worker、PostgreSQL 和跨区域部署。
- Java、Python 等多语言客户端。
- 对旧 Session Schema 和开发数据的透明迁移。

## 3. 核心领域模型

### 3.1 AgentDefinition

`AgentDefinition` 是可版本化的 Agent 声明，描述 Agent 能做什么，而不是一个运行中的 Agent 实例。

```typescript
interface AgentDefinition {
  agentId: string;
  revision: string;
  name: string;
  instructions: string;
  model: ModelSelector;
  tools: ToolSelector[];
  execution: ExecutionStrategyDefinition;
  acceptedTriggers: RunTriggerType[];
  requiredContexts?: ContextTypeConstraint[];
  optionalContexts?: ContextTypeConstraint[];
  overridableContexts?: string[];
  inputSchema?: StandardSchema;
  outputSchema?: StandardSchema;
}
```

Run 启动时固化 AgentDefinition revision。定义更新不会改变已经开始的 Run。

### 3.2 Session

`Session` 是长期连续性边界，保存：

- tenant 归属；
- 基础 `ContextSet`；
- 可供未来执行读取的 `SessionEntry`；
- 关联的 Run；
- 内部 AgentThread 投影。

如果调用方启动 Run 时没有提供 Session，Runtime 自动创建一个 Session。

### 3.3 Run

`Run` 表示一次具体执行，是 SDK、Service 和 Workbench 共用的统一执行模型。

```text
queued → running → completed
                 → failed
                 → cancelled
                 → waiting
```

首个切片使用 `queued`、`running`、`completed`、`failed`、`cancelled`，并保留通用 `waiting` 扩展空间。Approval 不进入首个状态机；需要审批的工具在当前阶段直接拒绝。

`RunTrigger` 首先支持：

- `message`：用户或系统消息驱动；
- `task`：结构化任务驱动。

后续增加外部 `event` 触发和等待恢复，不改变 Run 的基本语义。

### 3.4 SessionEntry 与 RunEvent

二者必须分离：

- `SessionEntry` 回答“未来 Agent 上下文需要看到什么”。
- `RunEvent` 回答“本次执行实际发生了什么”。

并非所有 RunEvent 都进入 Agent transcript，也并非所有 SessionEntry 都是执行事件。

持久化事件至少包含：

```typescript
interface RunEvent {
  eventId: string;
  sequence: number;
  schemaVersion: number;
  tenantId: string;
  sessionId: string;
  runId: string;
  type: string;
  data: unknown;
  occurredAt: string;
}
```

高频 token、thinking 和工具进度增量使用非持久化 `RunSignal`。重连后调用方通过持久化事件与当前输出快照恢复，不承诺回放全部增量。

### 3.5 Artifact

`Artifact` 是 Run 产出的、可供业务系统继续处理的结果，例如结构化报告、文件、变更提案或外部资源引用。它独立于消息文本，具有明确类型、归属、媒体信息和存储引用。

### 3.6 Approval 的位置

Approval 对企业治理重要，但不是验证运行时核心价值的必要条件。本设计只为通用 `waiting` 和后续恢复语义保留空间，不在首个切片中建立 Approval 实体、Repository、API 或界面。Approval 将与 Policy、Audit 和 Budget 一起进入治理阶段。

## 4. ContextSet 与 Runtime Plugin

### 4.1 移除 Workspace 核心概念

Core 不再拥有 `workspaceId`、`WorkspaceProvider`、`WorkspaceStore`、`forWorkspace` 或基于 workspace 的固定索引。目录、仓库和项目根都不再是 Runtime 的固有假设。

Workspace 能力仍可存在，但它是一个可安装的 Context Plugin，而不是公共领域模型。

### 4.2 ContextSet

```typescript
interface ContextBinding {
  type: string;
  contextId: string;
  revision?: string;
  input?: unknown;
}

interface ContextSet {
  bindings: ContextBinding[];
}
```

一个 Session/Run 可以同时绑定多个 Context，例如仓库、客户账号、故障事件和部署环境。Context 类型使用命名空间，例如 `rem.dev/repository` 和 `company.example/customer-account`。

Session 持有基础 ContextSet，Run 可以显式增补或覆盖。AgentDefinition 声明必需、可选和可覆盖的 Context 类型。Run 启动时生成不可变的 `ResolvedContextSnapshot`，后续 Session Context 的变化不影响已经启动的 Run。

### 4.3 Runtime Plugin

Runtime Plugin 是一组相关运行时能力的交付单元，但只能通过 Core 明确开放的贡献点接入：

```typescript
interface RuntimePlugin {
  manifest: PluginManifest;
  contextTypes?: ContextTypeContribution[];
  configLayers?: ConfigLayerContribution[];
  tools?: ToolContribution[];
  prompts?: PromptContribution[];
  authorization?: AuthorizationContribution[];
  artifacts?: ArtifactContribution[];
  lifecycle?: LifecycleContribution[];
}
```

一个 `workspace-context` 插件可以成套提供项目根识别、项目配置、Skills、文件工具、路径权限、项目提示词和本地 Artifact 路由。Core 只理解通用 Context 和贡献点。

插件不能获得任意全局 Hook，不能绕过授权、隐式替换 Core 服务、修改其他插件数据或在未声明阶段执行副作用。Manifest 必须声明插件版本、Context 类型、权限、依赖、配置 Schema 和能力入口。

### 4.4 Context 解析流程

Run 启动时依次执行：

1. 合并 Session Context 与 Run Context。
2. 校验 AgentDefinition 的 Context 约束。
3. 根据 Context 类型定位插件。
4. 解析和验证每个 Context。
5. 根据可信 Principal 授权每个 Context。
6. 生成有序配置层。
7. 收集工具、提示词和 Artifact 路由。
8. 固化 `ResolvedContextSnapshot`。
9. 创建 Run、初始事件和 WorkItem。

持久化的是可序列化的绑定与快照，不是插件运行实例。

### 4.5 冲突规则

- 配置使用具名 Layer 和明确优先级。
- 工具使用命名空间，不允许静默覆盖同名工具。
- Prompt 使用具名 Section 和确定性顺序。
- Authorization 采用 deny-wins。
- Artifact 按类型和显式路由选择处理器。
- Context 覆盖必须由调用方显式表达并符合 AgentDefinition 约束。

同样输入必须得到同样的解析顺序和快照结果。

### 4.6 安全身份与业务上下文分离

`Principal` 和 `tenantId` 是认证层提供的可信安全边界；`ContextSet` 是业务与执行现场。普通 ContextBinding 不能冒充或覆盖 Principal 和 Tenant。

## 5. 架构与模块职责

### 5.1 包边界

```text
packages/
  core/       rem-agent-core，完整运行时和唯一 Agent 生命周期实现
  service/    HTTP 认证、校验、序列化、流式输出和 Core 组装
  client/     远程 TypeScript Client
  workbench/  Runtime 观察与调试界面
  plugins/    可选的官方 Runtime Plugin
```

Service、Client 和 Workbench 均不得重新实现 Agent 生命周期。

### 5.2 Core 内部分层

```text
packages/core/src/
  domain/
    agent-definition/
    session/
    run/
    event/
    artifact/
    context/
    identity/
  application/
    runtime/
    agents/
    sessions/
    runs/
    artifacts/
  execution/
    worker/
    single-agent/
    tools/
    recovery/
    orchestration/
  plugins/
    registry/
    context/
    configuration/
    tools/
    prompts/
    authorization/
    artifacts/
  sdk/
    storage/
    models/
    secrets/
    telemetry/
  infrastructure/
    storage/sqlite/
    models/pi-ai/
    events/local/
  assembly/
```

Domain 不依赖基础设施、pi-agent 或 HTTP。现有 `REMAgent` 和 pi-agent loop 进入 `execution/single-agent`，继续作为内部单 Agent 执行器。

### 5.3 Team 与编排

Team 是 `ExecutionStrategy`，不是 Runtime 的基础模型。外部仍通过 `startRun` 执行；Team、child Agent、AgentThread、Delivery、Organizer 和 Scheduler 在 Run 内部协作。首个纵向切片稳定后再迁移这些能力。

## 6. 执行、持久化与恢复语义

### 6.1 基本保证

- `startRun` 支持幂等键。
- 一个 Run 同时只有一个有效执行租约。
- RunEvent sequence 单调递增。
- 状态变化和对应事件在同一事务提交。
- 过期租约可被重新领取。
- Event/Webhook 采用 at-least-once，消费者通过 `eventId` 去重。
- 系统不承诺无法实现的端到端 exactly-once。

### 6.2 StorageProvider

StorageProvider 增加显式事务或 Unit of Work，并为以下对象提供 Repository：

- sessions 与 sessionEntries；
- runs 与 runEvents；
- workItems；
- toolInvocations；
- artifacts；
- idempotency records；
- threads 与 deliveries（后续迁移）。

状态和事件不得通过两个独立、可能部分失败的写操作提交。

### 6.3 WorkItem 与执行租约

持久化 WorkItem 使用 `queued`、`leased`、`completed`、`failed` 状态，并记录 lease owner 和 expiry。本地 Worker 是第一种实现；未来独立 Worker 使用相同语义，不改变 AgentRuntime API。

### 6.4 幂等

幂等记录至少包含 tenant、operation、idempotency key、request hash 和 resource id。同一个键和同一个请求返回已有资源；同一个键对应不同请求时返回 `IDEMPOTENCY_CONFLICT`。

### 6.5 ToolInvocation

工具调用是一等持久化记录，至少支持：

```text
planned → executing → succeeded
                    → failed
                    → unknown
```

工具定义需要表达副作用分类、是否幂等、超时和可用的 reconcile 能力。恢复规则是：

- 工具执行前崩溃：可以重新执行。
- 已保存成功结果：复用结果，不重复执行。
- 工具可能已产生副作用但结果未保存：只有只读、幂等、支持幂等键或支持 reconcile 时才自动恢复；否则标为 `unknown`，Run 进入 `waiting`，等待操作方处理。

不得对不明确的外部副作用盲目重试。

### 6.6 Event 与 Signal

RunEvent 是持久化事实；EventNotifier 只是实时通知提示。订阅者错过 Signal 后通过 Event cursor 和输出快照恢复。未来 Webhook 使用 Outbox，不直接耦合执行事务与网络请求。

## 7. 配置体系

配置分为三类，不再由一个模糊的 Config 对象承担全部职责。

### 7.1 RuntimeBootstrapConfig

决定 Runtime 如何运行：Storage、Plugins、AgentDefinitionProvider、ModelProvider、SecretProvider、Worker 和 Telemetry。嵌入应用或 Service 启动入口负责提供它。

### 7.2 AgentDefinitionProvider

决定有哪些 Agent。Provider 可以从 TypeScript、YAML/JSON、数据库或企业配置中心读取，也可以组合多个来源。配置文件只是 AgentDefinitionProvider 的一种实现。

### 7.3 Contextual Config

决定 Agent 在当前业务现场如何工作。配置合并顺序为：

```text
Runtime defaults
  → AgentDefinition defaults
  → Session Context layers
  → Run Context layers
  → 显式允许的 Run 参数
```

每层记录来源、版本和哈希，并进入 Context Snapshot。

### 7.4 Secrets

密钥通过 SecretProvider 延迟解析。AgentDefinition、ContextBinding、RunEvent、Artifact metadata 和配置快照只能保存 Secret reference，不能保存明文。插件只能申请 Manifest 已声明的 Secret。

## 8. 公开 API 与 Service

### 8.1 稳定公开入口

Core 稳定公开 `createAgentRuntime`、`AgentRuntime`、`ScopedAgentRuntime` 及 AgentDefinition、Session、Run、RunEvent、Artifact、Context 和身份相关类型。

REMAgent、Worker、WorkItem、ExecutionLease、ToolInvocation Repository、AgentThread、Delivery、Team Coordinator、SQLite Repository 和 EventNotifier 都是内部实现。

### 8.2 Runtime 作用域

```typescript
interface AgentRuntime {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  as(context: RuntimeRequestContext): ScopedAgentRuntime;
}

interface ScopedAgentRuntime {
  agents: AgentOperations;
  sessions: SessionOperations;
  runs: RunOperations;
  artifacts: ArtifactOperations;
}
```

`startRun` 返回已创建的 Run，不等待执行完成。轮询、事件查询、Signal 订阅和 `waitForCompletion` 都是建立在异步 Run 之上的访问方式。

### 8.3 首版 Service API

```text
GET    /v1/agents
GET    /v1/agents/:agentId
POST   /v1/sessions
GET    /v1/sessions/:sessionId
PATCH  /v1/sessions/:sessionId/contexts
POST   /v1/runs
GET    /v1/runs/:runId
POST   /v1/runs/:runId/cancel
GET    /v1/runs/:runId/events
GET    /v1/runs/:runId/stream
GET    /v1/artifacts/:artifactId
```

不提供 Approval API、Team 专属 API、内部 Worker API、工具直接执行 API 或任意插件 Hook API。

### 8.4 Schema 单一来源

输入输出 Schema 使用 Standard Schema 兼容方式定义，并复用于 Runtime 校验、AgentDefinition、Context Plugin、Service、OpenAPI、Client 和 Workbench，避免多份 Schema 漂移。

## 9. 错误模型

公开错误具有稳定 `code`、安全 `message`、`retryable` 和可选 `details`。首批错误域包括：

- 身份与输入：`INVALID_INPUT`、`UNAUTHENTICATED`、`FORBIDDEN`；
- Agent：`AGENT_NOT_FOUND`、`AGENT_REVISION_NOT_FOUND`、`TRIGGER_NOT_SUPPORTED`；
- Session/Run：`SESSION_NOT_FOUND`、`RUN_NOT_FOUND`、`RUN_CONFLICT`、`RUN_ALREADY_TERMINAL`；
- Context/Plugin：`CONTEXT_TYPE_NOT_FOUND`、`CONTEXT_INVALID`、`CONTEXT_CONFLICT`、`CONTEXT_UNAUTHORIZED`、`PLUGIN_DEPENDENCY_MISSING`；
- Tool：`TOOL_NOT_FOUND`、`TOOL_DENIED`、`TOOL_EXECUTION_FAILED`、`TOOL_RESULT_UNKNOWN`；
- Model：`MODEL_UNAVAILABLE`、`MODEL_EXECUTION_FAILED`；
- Storage：`STORAGE_CONFLICT`、`STORAGE_UNAVAILABLE`、`IDEMPOTENCY_CONFLICT`；
- Execution：`EXECUTION_TIMEOUT`、`EXECUTION_CANCELLED`、`INTERNAL_ERROR`。

错误映射到 TypeScript Error、HTTP 状态、持久化 RunEvent 和可观测性记录。敏感 cause 不进入公共响应或事件。

## 10. 实施路线

### 阶段一：运行时骨架

建立 AgentRuntime、AgentDefinition、Session、Run、RunEvent、Artifact、ContextSet、RuntimePlugin、身份边界和新的 Storage 事务模型。

### 阶段二：单 Agent 纵向切片

完成以下闭环：

```text
注册 AgentDefinition
  → 创建带 ContextSet 的 Session
  → startRun(message | task)
  → 持久化 Run、WorkItem 和初始事件
  → 本地 Worker 领取租约
  → 解析 Context Plugin
  → REMAgent / pi-agent 执行
  → 工具调用
  → SessionEntry、RunEvent、Artifact
  → 查询或订阅结果
```

此阶段支持 SQLite、本地 Worker、取消、超时、幂等、持久化事件、实时 Signal、基础 Artifact、租约恢复和 ToolInvocation 恢复语义。

### 阶段三：SDK 与独立 Service

提供等价的嵌入式调用和远程 TypeScript Client。Service 只承担认证、校验、序列化、事件流、错误映射和 Core 组装。

### 阶段四：Workspace 插件迁移

把现有 Workspace 的项目根、配置文件、文件工具、路径边界、Skills、Prompt 和本地 Artifact 路由迁入 `workspace-context` 插件，删除 Core 中的 Workspace 假设。

### 阶段五：编排能力迁移

在新 Run 模型上迁移 child Agent、AgentThread、Team、Delivery、Organizer 和 Scheduler，使其成为内部执行策略。

### 阶段六：企业扩展与治理

按需求增加 Webhook/Outbox、外部事件、A2A/MCP 适配器、多 Worker、PostgreSQL、Approval、Policy、Audit、Budget、Secret Provider、OpenTelemetry 和其他语言客户端。

## 11. 测试策略

### 11.1 领域与应用测试

覆盖 Definition revision 固化、Context 合并与覆盖、插件冲突、身份隔离、Run 状态机、Event sequence、幂等、SessionEntry/Event 分离和 Artifact 归属。

### 11.2 Storage 契约测试

所有 StorageProvider 实现运行同一组契约测试，覆盖事务原子性、租约竞争与回收、并发幂等、事件游标、ToolInvocation 恢复和 Context Snapshot。

### 11.3 崩溃恢复测试

在 Run 创建、Worker 领取、模型请求、工具执行、事件写入和 Artifact 写入前后主动终止进程，验证恢复后不会产生错误重复执行或虚假成功。

### 11.4 SDK 与 Service 一致性测试

同一组集成场景分别通过嵌入式 SDK 和远程 Client 执行并比较结果，保证两种交付形态语义一致。

### 11.5 Plugin 契约测试

提供测试工具验证 Manifest、Context Schema、确定性解析、配置与工具冲突、deny-wins、快照序列化和插件 revision 行为。

## 12. 首个里程碑验收标准

首个里程碑不以“新类型已经建立”为完成标准，而以真实应用集成闭环验收：

> 一个业务应用通过 SDK 提交带有客户、仓库等多个 Context 的任务。Runtime 能持久化并执行任务，调用插件提供的工具，在进程重启后保持正确状态，并通过 RunEvent 与 Artifact 返回可供业务系统继续处理的结构化结果。

Workbench 只用于观察和调试该闭环。首个里程碑完成后，再评估 Team、外部事件和治理能力的优先级。

