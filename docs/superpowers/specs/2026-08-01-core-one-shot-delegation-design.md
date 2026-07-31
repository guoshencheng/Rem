# Core 一次性 Child Agent 委派设计

## 背景

Core 已具备单 Agent `AgentSystem`、Session Runtime、事件驱动和持久化链路，也已有
`delegate_task` 工具雏形。但当前委派实现仍由父 `REMAgent` 持有 `children`，工具 executor
直接启动 child Agent，并依赖 `child-spawned` 事件让外部驱动持久化。这套模型会长期保留已经
结束的 child 对象，而且进程重启后无法恢复对象关系。

本阶段将委派重建为 Core 内独立的一次性执行能力：child 有自己的持久化 Session，但 child
`REMAgent` 只在一次调用期间存在，完成后释放。

## 目标

- `delegate_task` 在 Core `AgentSystem` 中可以真正执行。
- 每次委派创建独立 child Session，并记录直接父 Session 和父 toolCall。
- child 的消息、usage、标题和压缩历史只写入 child Session。
- child `REMAgent` 不进入父 Agent、父 Runtime 或 Runtime Registry 的长期集合。
- child 可以递归委派孙 child，默认最大深度为 3，并可在系统装配时配置。
- 父运行被中断时，当前调用链上的 child 通过 AbortSignal 级联中断。
- 重启后遗留的 running 委派标记为 interrupted，不自动恢复执行。
- 系统事件流发布 child 生命周期更新，但不把 child 私有流式内容混入父聊天。

## 非目标

- 本阶段不实现长期多 Agent、Organizer 或 `AgentThread`。
- 不提供 child 的独立实时事件订阅入口；历史通过 child Session 读取。
- 不自动重试失败或 interrupted 的委派。
- 不把 child Agent 恢复到内存，也不恢复中断前的工具执行。
- 不支持并行批量委派调度；并发行为仍由父 Agent 的工具执行策略决定。

## 方案选择

采用独立 `DelegationRunner`：

- `delegate_task` 只负责 schema、调用 Runner 和格式化 tool result。
- `DelegationRunner` 负责 child Session 和临时 Agent 的完整生命周期。
- `DelegationEventDriver` 负责 child 事件持久化、usage 汇总和 child 状态事件。
- `SessionService` 提供 child Session 创建与遗留状态修复。

不保留 `REMAgent.children`，因为它把一次性调用错误地变成长期对象关系；也不让工具 executor
直接装配所有基础设施，避免 capability 层反向承担 Session/System 职责。

## 委派领域类型

```typescript
type DelegationStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted';

interface DelegationRequest {
  task: string;
  systemPrompt?: string;
  maxTurns?: number;
}

interface DelegationContext {
  parentSessionId: string;
  parentToolCallId: string;
  workspace: string;
  workspaceRoot: string;
  depth: number;
  signal?: AbortSignal;
}

interface DelegationResult {
  childSessionId: string;
  content: string;
  status: Exclude<DelegationStatus, 'running'>;
  usage?: Usage;
}
```

`depth` 表示即将创建的 child 深度：root Session 为 0，root 创建的 child 为 1。

## Session 持久化模型

child Session 继续使用现有 `Session`，通过 metadata 标识：

```typescript
interface DelegationSessionMetadata {
  type: 'delegation';
  parentSessionId: string;
  parentToolCallId: string;
  delegationStatus: DelegationStatus;
  delegationDepth: number;
  workspace: string;
  title: string;
}
```

- `parentSessionId` 永远指向直接父 Session；孙 child 指向 child，不压平到 root。
- `parentToolCallId` 是直接父 Agent 中触发此次委派的 toolCall ID。
- title 使用 task 去除首尾空白后的前 50 个字符；空任务由工具 schema/运行器拒绝。
- 当前阶段没有 `AgentThread`，因此不伪造 `parentAgentThreadId`。正式引入 Thread 时再扩展 metadata。

Session 创建后立即以 `running` 保存。终态更新与 child 最后一批持久化事件串行完成。

## delegate_task 边界

现有 `SpawnChild` 替换为更高层的委派端口：

```typescript
type RunDelegation = (
  request: DelegationRequest,
  toolContext: ToolContext,
) => Promise<DelegationResult>;
```

`createDelegateTaskExecutor()`：

1. 将工具输入交给 `RunDelegation`。
2. 根据 `DelegationResult.status` 计算 failed。
3. 使用现有 `formatTaskResult()` 生成父 Agent 的 tool result。
4. 捕获运行器异常并生成失败 tool result，不让 child 错误直接抛穿父 Agent loop。

executor 不创建 Session、不创建 Agent、不消费 Agent 事件，也不知道 Runtime Registry。

## DelegationRunner

Runner 构造依赖：

```typescript
interface DelegationRunnerDeps {
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
  sessionService: SessionService;
  eventDriver: DelegationEventDriver;
  createAgent: RootAgentFactory;
  maxDepth: number;
}
```

一次 `run(request, context)`：

1. 校验 `context.depth <= maxDepth`。
2. 创建 running child Session。
3. 创建局部 child `REMAgent`，ID 使用 `delegate-<childSessionId>`。
4. 将 `context.signal` 传给 child Agent，实现父中断级联。
5. 为该 child 注入递归 `RunDelegation`；下一层 parentSessionId 使用当前 child Session，depth + 1。
6. 启动 child 并由 `DelegationEventDriver` 完整消费事件流。
7. 等待 child output，生成 completed/failed/interrupted 结果。
8. 串行写入 Session 终态并返回。
9. 方法退出后不保留 child Agent 引用。

Runner 不将 child 加入 `SessionRuntimeRegistry`。Registry 仍只维护用户可持续交互的 persistent
Session Runtime。

## 最大深度

`createAgentSystem()` 新增：

```typescript
interface CreateAgentSystemOptions {
  createRootAgent?: RootAgentFactory;
  delegation?: {
    maxDepth?: number;
  };
}
```

- 默认 `maxDepth = 3`。
- 允许范围为 1 到 16 的整数；无效配置在系统创建时抛出。
- 当下一层 depth 超限时，不创建 child Session，返回 failed `DelegationResult`。
- 深度超限仍表现为正常 tool result，因此父 Agent可以读取失败原因并继续回答。

## DelegationEventDriver

Driver 消费一个 child 的 `REMAgentEvent`：

- `message-persist`、`usage`、`session-title`、`compress-end`、`finish` 交给
  `SessionService.persistAgentEvent(childSessionId, event)`。
- usage 在本次 child run 内累计，用于最终 `child-agent-update` 和 `DelegationResult`。
- `todo-updated` 已由 TodoService 写入 child Session 对应 todo store，无需父 Session 复制。
- 普通 thinking/text/tool Agent 事件不发布到父 Session 的 `chunk`。
- event 消费或持久化失败会中断 child 并将其标记为 failed。

Runner 在 child Session 创建后发布：

```typescript
{
  type: 'child-agent-update',
  sessionId: rootObservedSessionId,
  childSessionId,
  toolCallId: parentToolCallId,
  summary: task,
  status: 'running'
}
```

完成后发布 completed、failed 或 interrupted。现有事件类型需增加 `interrupted` 状态。

对于嵌套委派，每一级事件的 `sessionId` 使用其直接父 Session，使观察者可以按 Session 关系逐层
订阅和组装；不强制全部投射到根 Session。

## 中断语义

父 root Agent 的 tool context 携带当前 loop signal。Runner 将它传给 child REMAgent；child
递归创建孙 child 时继续传递当前 child tool context signal。

当前 `createAgentTools()` 尚未把 pi-agent-core `AgentTool.execute` 的第三个 `signal` 参数写入
`ToolContext`。本阶段必须补齐这条通路：tool adapter 接收 signal，并在调用
`ToolProvider.execute()` 时设置 `ctx.signal`。所有工具由此获得统一的本轮取消信号，委派不增加
私有的中止协议。

当父运行 interrupt：

```text
root AbortSignal
-> 正在执行的 delegate_task ToolContext.signal
-> child REMAgent interrupt
-> child 内部 delegate_task signal
-> grandchild REMAgent interrupt
```

已完成的 child 没有残留 listener 或对象需要中断。Runner 根据 child 最终 output/stopReason 与
signal 状态判定 interrupted；父 Agent仍收到一个格式化 tool result，由父 loop 自己完成终止。

## 重启修复

系统初始化不预加载 child Agent。`SessionService` 提供一次显式修复操作：

```typescript
recoverInterruptedDelegations(): Promise<number>;
```

它查询所有 Session summary，加载 metadata.type 为 delegation 且 status 为 running 的 Session，
将状态改为 interrupted 并保存，返回修复数量。

`createAgentSystem()` 不隐式启动异步 I/O；调用方完成 `initializeAgentDI()` 后，系统第一次执行
创建/发送/查询用例前，由 `AgentSystem` 共享一个幂等 recovery Promise。恢复失败使该用例失败，
不会悄悄忽略状态不一致。

## 删除旧对象关系

从 `REMAgent` 删除：

```typescript
children
parentToolCallId
attachChild()
```

从 `REMAgentEvent` 删除 `child-spawned`。`AgentRunDriver` 不再包含忽略该事件的临时代码。

父子关系只存在于：

- child Session metadata；
- 委派运行期间的局部调用栈；
- `child-agent-update` 观察事件。

## 模块边界

```text
packages/core/src/delegation/
├── runner.ts
├── event-driver.ts
├── depth.ts
├── types.ts
├── errors.ts
└── index.ts
```

- `types.ts` 只放委派领域类型和端口。
- `depth.ts` 只负责配置验证和深度判断。
- `event-driver.ts` 只消费一次 child run。
- `runner.ts` 只编排一次性生命周期和递归闭包。
- capability `delegate-task.ts` 只保留工具协议适配。
- `runtime/agent-tools.ts` 只增加标准 AbortSignal 到 ToolContext 的透传，不承担委派逻辑。
- 所有实现文件目标不超过 150 行，绝对不超过 200 行。

## 错误处理

- child Session 创建失败：返回 failed result，childSessionId 为空，不产生 running 事件。
- Agent 构造失败：将已创建 child Session 标记 failed，再返回 failed result。
- child 模型或工具失败：完整持久化 error 历史，标记 failed。
- 父信号中止：标记 interrupted。
- 深度超限：不创建 Session，返回明确失败结果。
- 终态保存失败：Runner 抛出，由 delegate executor 格式化为父 tool result；系统事件发布 failed。
- child 失败不直接使父 Agent run 失败。

## 测试

单元测试覆盖：

- delegate executor 只调用 `RunDelegation` 并格式化各终态。
- 最大深度默认值、配置校验和超限不创建 Session。
- child Session metadata 使用直接父关系。
- Event Driver 串行持久化、usage 汇总和失败传播。
- `REMAgent` 不再持有 children，也不发 child-spawned。
- running delegation 的重启修复为 interrupted。

集成测试覆盖：

- root 调用 delegate_task，child 独立持久化两条消息，父 Session 只得到 tool call/tool result。
- child 完成后无法从 Runtime Registry 或父 Agent 找到 child 对象。
- child 递归创建孙 child，孙 child 指向直接 child Session。
- 超过最大深度返回失败 tool result，且不创建额外 Session。
- 父 interrupt 级联中断 child，并将 child 标记 interrupted。
- child 失败后父 Agent仍可以生成最终回答。
- 新建 AgentSystem 后将遗留 running child 标记 interrupted，不恢复 Agent。
- Core build、typecheck、全量测试和结构检查通过。
