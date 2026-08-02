# 配置驱动的长期多 Agent 编排设计

## 背景

Core 已支持单 Agent Session、一次性 child Agent、持久化 AgentThread、中心 Message 单份存储及
群聊/Thread 上下文投影。当前缺口是长期多 Agent 的实际运行编排。

现有 `AgentProfile` 持久化与配置中的 `agents` 重复表达 Agent 定义。本设计将 Agent 和 Team 的
唯一事实源收敛到 ConfigProvider，数据库只保存 Session 中的 Agent 身份、消息和投递状态。

## 目标

- 不传 `teamId` 时保持现有单 Agent 行为。
- 显式传入 `teamId` 时创建 Organizer 驱动的多 Agent Session。
- Organizer 负责语义决策，确定性 Scheduler 负责投递、并发、预算和中断。
- 同一 Session 的同一 AgentThread 严格串行，不同 AgentThread 可并行。
- Message 仍只保存一份；Delivery 只引用 Message。
- Organizer 显式结束讨论，且 Core 验证没有未完成工作。
- AgentThread、Message、Delivery 可恢复；REMAgent 和 Runtime 不序列化。

## 非目标

- 不允许聊天用户在发送消息时选择具体 Agent。
- 不从自然语言 `@name` 解析调度意图。
- 不自动重放进程中断的 Agent 或外部工具调用。
- 不实现自动 Delivery 重试、跨进程分布式 Worker 或优先级调度。
- 不建设 HTTP、UI 或传输 DTO。

## 配置模型

配置增加 Team 定义；不存在 `activeTeam` 或任何隐式默认 Team。

```yaml
agents:
  organizer:
    name: 组织者
    corePrompt: 负责分派成员并汇总最终结论
  architect:
    name: 架构师
    corePrompt: 负责架构分析
  reviewer:
    name: 审查者
    corePrompt: 负责风险审查

teams:
  engineering:
    organizer: organizer
    members:
      - architect
      - reviewer

orchestration:
  maxAgentRuns: 20
  maxMessages: 50
  maxDepth: 8
  timeoutMs: 300000
  maxTokens: 200000
  maxParallelAgents: 4
```

配置类型：

```typescript
interface TeamConfig {
  organizer: string;
  members: string[];
}

interface ResolvedTeam {
  id: string;
  organizer: ResolvedAgentRole;
  members: ResolvedAgentRole[];
}

interface OrchestrationConfig {
  maxAgentRuns: number;
  maxMessages: number;
  maxDepth: number;
  timeoutMs: number;
  maxTokens: number;
  maxParallelAgents: number;
}
```

ConfigProvider 增加 `resolveTeam(id)` 和 `getOrchestrationConfig()`。解析时必须校验：

- Team ID 存在。
- Organizer Agent 存在。
- Member Agent 全部存在。
- Organizer 不出现在 members 中。
- members 去重且至少一个。

配置可以按 workspace 合并；Session 创建后保存 `teamId`。后续恢复使用该 workspace 的当前配置。
配置更新后新建的 Thread Runtime 使用新配置；已存在的进程内 Runtime 不热切换。

## 移除 AgentProfile 持久化

删除：

- `agent-profile/` 领域模块。
- `AgentProfileStore`、`AgentProfileUsecase`。
- SQLite `agent_profiles` 表和相关 Provider 属性。

AgentThread 改为：

```typescript
interface AgentThread {
  agentThreadId: string;
  sessionId: string;
  agentId: string;
  role: 'primary' | 'organizer' | 'member' | 'delegated';
  lifecycle: 'persistent' | 'one-shot';
  createdAt: Date;
  updatedAt: Date;
}
```

`agentId` 是配置 `agents` 的稳定 key。Thread 恢复时若配置中不存在该 Agent，Core 明确报错，
不自动替换或猜测。

## SQLite v11

schema 从 v10 升到 v11：

1. 重建 `agent_threads`，把 `agent_profile_id` 改为 `agent_id` 并移除 Profile 外键。
2. `default-primary` 映射为配置 Agent `default`；其他旧 ID 原样保留。
3. 保留 Session 外键、role 唯一索引及 persistent `(session_id, agent_id)` 唯一索引。
4. 删除 `agent_profiles` 表。
5. 新增 `message_deliveries` 表。

```typescript
type MessageDeliveryKind = 'message' | 'resume';
type MessageDeliveryStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'interrupted';

interface MessageDelivery {
  deliveryId: string;
  sessionId: string;
  kind: MessageDeliveryKind;
  batchId: string;
  messageId: string;
  rootUserMessageId: string;
  targetAgentThreadId: string;
  requestedByAgentThreadId?: string;
  status: MessageDeliveryStatus;
  attempt: number;
  depth: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

Delivery 约束：

- 外键 Session/target Thread 删除时 cascade。
- requestedBy Thread 删除使用 restrict。
- `(kind, batch_id, target_agent_thread_id)` 唯一，防止重复投递和重复 resume。
- Store 提供 createBatch、listByRoot、listQueued、claim、complete、fail、interrupt 和恢复操作。
- `claim` 必须原子检查目标 Thread 没有 processing Delivery。

`send_message` 的中心 Message、active leaf 更新和整批 Delivery 必须在同一个 SQLite 事务中完成。
StorageProvider 增加 OrchestrationStore 事务端口；MessageDeliveryUsecase 在 Session keyed 临界区内调用
该端口。禁止先 append Message 再逐条创建 Delivery，以免崩溃后留下无法调度的公开消息。

## Session 创建语义

```typescript
interface CreateSessionInput {
  workspace: string;
  teamId?: string;
}
```

- 无 `teamId`：单 Agent Session，使用配置 Agent `default`，建立 primary Thread。
- 有 `teamId`：多 Agent Session，保存 teamId，幂等建立一个 organizer Thread 和所有 member Thread。
- 用户后续只调用 `send({ sessionId, content })`，不选择 Agent。

## 三层 Runtime

### SessionRuntimeRegistry

按 `sessionId` 缓存 SessionRuntime，并合并并发首次加载。

### SessionRuntime

```typescript
class SessionRuntime {
  readonly sessionId: string;
  readonly workspace: string;
  readonly mode: 'single' | 'multi-agent';
  readonly threadRuntimes: AgentThreadRuntimeRegistry;
  activeDiscussion?: DiscussionRuntime;
}
```

SessionRuntime 是 Session 的进程内执行所有权，保证同一 Session 同时只有一条用户问题在运行。
单 Agent 和多 Agent 统一使用 ThreadRuntime；单 Agent 只有 primary Thread。

### AgentThreadRuntime

```typescript
class AgentThreadRuntime {
  readonly thread: AgentThread;
  readonly agent: REMAgent;
  status: 'idle' | 'queued' | 'running' | 'error';
  enqueue(run: () => Promise<void>): Promise<void>;
  interrupt(): void;
}
```

每个 Runtime 持有一个 REMAgent 和一个 keyed Promise tail。同一 AgentThread 的任务 FIFO 串行，
不同 AgentThread 的任务受 `maxParallelAgents` 限制并行。

ThreadRuntime 按需创建：Scheduler 首次向 Thread 投递时解析 Agent 配置、投影上下文并创建 REMAgent。

### DiscussionRuntime

```typescript
class DiscussionRuntime {
  readonly rootUserMessageId: string;
  readonly startedAt: number;
  readonly abortController: AbortController;
  status: 'running' | 'finishing' | 'completed' | 'failed' | 'interrupted';
  budget: DiscussionBudgetState;
  finishRequest?: { requestedByAgentThreadId: string; answer: string };
}
```

DiscussionRuntime 只存在于一条用户消息触发的讨论期间，负责总中断、预算和 finish 请求。讨论完成后
从 SessionRuntime 释放；SessionRuntime、ThreadRuntime 和 REMAgent 保留供下一轮复用。

## REMAgent 上下文同步

多 Agent 中，目标 Agent 空闲期间会产生其他 Agent 的公开回复。每次 Delivery 执行前必须重新投影。

```typescript
agent.syncTranscript(projectedMessages);
agent.continue();
```

`syncTranscript`：

- 只允许 REMAgent 非 running 时调用。
- 用完整投影替换内存 transcript。
- 不写数据库、不触发 message-persist。
- 不改变 Agent 身份和已装配工具。

Scheduler 每次运行前调用 `projectThreadContext`，保证目标 Agent 看到最新中心消息。只有 Agent 新产生
的 assistant/toolResult 才由事件驱动器持久化。

## Organizer 工具

### send_message

```typescript
send_message({
  to: ['architect', 'reviewer'],
  content: '请分别评估该方案',
});
```

Organizer 和 Member 都可调用。执行器：

1. 校验调用者属于当前 Team、Discussion 仍可投递。
2. 按 agentId 解析 Session Thread，禁止发给自己并对目标去重。
3. 创建一条 session-scope、agent author 的中心 Message，mentions 保存目标 Thread ID。
4. 使用同一个 batchId 为目标创建 message Delivery。
5. 返回排队确认，不同步等待目标执行。

Agent 间通信需要合法的 pi AssistantMessage。运行装配层使用当前已解析 Model 构造通信 Message，
usage 为零，正文只包含 send_message content；不引入自定义模型消息类型。

### finish_discussion

```typescript
finish_discussion({ answer: '最终结论' });
```

只有 Organizer 有此工具。执行器只向 DiscussionRuntime 登记请求。Scheduler 在当前 Organizer
Delivery 完成后原子检查：

- 请求者是 Organizer。
- 除当前执行项外不存在 queued/processing Delivery。
- Discussion 未失败或中断。
- answer trim 后非空。

满足后将 answer 构造成 Organizer 的公开 AssistantMessage，持久化并结束讨论；否则拒绝 finish。

## Scheduler 与 Delivery 流程

首次用户发送：

```text
持久化 user Message
→ 创建指向 Organizer 的 message Delivery
→ Scheduler claim
→ Organizer ThreadRuntime 执行
```

一条 send_message 请求多个成员：

```text
中心 Message（一份）
├── Delivery → Member A
└── Delivery → Member B
```

不同 Thread 可并行；同一 Thread 的后续 Delivery 保持 queued。成员公开回复进入中心 Message。

当同一 batch 的所有 message Delivery 进入终态时，Scheduler 幂等创建一个 resume Delivery 给
requestedBy Thread。resume 不创建聊天消息；它只触发请求方基于最新中心投影继续运行。唯一约束保证
一个 batch 只回投一次。

首次用户消息创建的 Organizer Delivery 没有 requestedBy Thread，因此结束后不创建 resume。
Delivery depth 初始为 0；send_message 创建的下一层 message Delivery 使用当前 depth + 1，resume
保留触发批次的 depth。

Organizer 可以继续投递或 finish。Member 也可以向其他 Member/Organizer 投递，深度由 Delivery
链路和 Discussion budget 控制。

## 讨论预算

预算按 Discussion 统计：Agent run 次数、中心消息数量、投递深度、墙钟时间和 token。Scheduler
在创建及领取 Delivery 前检查。

超限时：

1. 禁止普通 send_message。
2. 中止活跃 Member。
3. queued/processing Member Delivery 收敛为 interrupted。
4. 最多创建一次受限 Organizer resume。
5. Organizer 只能 finish，不能继续投递。
6. Organizer 仍不能总结时 Discussion failed。

## 中断、失败与恢复

`interrupt(sessionId)`：

- 中止 active Discussion。
- 中断所有 running ThreadRuntime。
- queued Delivery 立即标记 interrupted。
- processing Delivery 在执行收尾时标记 interrupted。
- finish 后禁止创建新 Delivery。

失败语义：

- Member 失败：Delivery failed，并写入一条由该 Member authored 的公开合成错误 Message，使请求方
  通过正常 Thread 投影看到失败；同批其他 Member 继续。
- Organizer 失败：Discussion failed，同 root 下剩余 Delivery interrupted。
- 不自动重试 Delivery；attempt 保留为未来扩展。

启动恢复：

- processing Delivery 统一改为 interrupted。
- 不重放 Agent 或工具调用。
- 历史 Message、Thread 和 Delivery 可查询。
- 下一条新用户消息可开启新 Discussion。

## 公共 API

```typescript
interface AgentSystem {
  createSession(input: CreateSessionInput): Promise<SessionInfo>;
  send(input: SendMessageInput): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  getSessionThreads(sessionId: string): Promise<AgentThread[]>;
  getSessionChat(sessionId: string): Promise<SessionChatMessage[]>;
  getThreadMessages(sessionId: string, agentThreadId: string): Promise<Message[]>;
  events(signal?: AbortSignal): AsyncIterable<AgentSystemEvent>;
}
```

事件增加 Agent activity、Delivery 和 Discussion 状态。私有流式 chunk 带 agentThreadId，但不进入
中心聊天事实。

## 模块边界

```text
config/
  team-types.ts
  team-resolver.ts
orchestration/
  delivery-model.ts
  delivery-store.ts
  delivery-usecase.ts
  scheduler.ts
  discussion-runtime.ts
  discussion-budget.ts
  send-message-tool.ts
  finish-discussion-tool.ts
session/
  runtime.ts
  agent-thread-runtime.ts
  agent-thread-runtime-registry.ts
  agent-thread/
    model.ts
    store.ts
    agent-thread-usecase.ts
plugins/storage/sqlite/
  message-delivery-store.ts
  schema/delivery-ddl.ts
```

类型、Store 接口、Usecase、Runtime 和 SQLite 实现保持独立文件。Scheduler 只依赖领域接口和
Usecase，不直接依赖 SQLite。

## 测试策略

- 配置：Team 解析、缺失 Agent、重复成员、workspace 覆盖。
- 迁移：v10→v11 Thread agentId 转换、Profile 表删除、Delivery DDL。
- Store：批量创建、原子 claim、同 Thread 互斥、唯一 resume、恢复。
- Runtime：Session 缓存、Thread FIFO、跨 Thread 并行、transcript 同步、中断。
- 工具：目标校验、去重、单份 Message、多 Delivery、Organizer-only finish。
- Scheduler：首次 Organizer、成员并行、批次回投、多轮讨论、最终 finish。
- 预算：run/message/depth/time/token 限制及受限总结。
- 集成：单 Agent不回归、one-shot child 不回归、多 Agent 完整讨论、重启和 interrupt。

## 完成标准

- Agent 和 Team 只来自配置，数据库不保存 AgentProfile。
- 不传 teamId 永远走单 Agent；显式 teamId 才走多 Agent。
- 同一 AgentThread 无并发，不同 AgentThread 可并行。
- Message 单份存储，Delivery 可审计且状态机完整。
- Organizer 只能在无未完成工作时结束讨论。
- 中断、失败、预算和进程恢复具有确定行为。
- 原有单 Agent和一次性 child Agent 测试全部通过。
