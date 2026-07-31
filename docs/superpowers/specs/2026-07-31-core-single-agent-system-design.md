# Core 单 Agent System 设计

## 背景

Core-only 基线已经建立，`REMAgent` 也已经完成结构拆分，但 Core 当前仍缺少一条完整的
Session 运行链路。调用方必须自行加载 Session、创建 Agent、消费事件并持久化结果，无法只依赖
Core 完成一次对话。

本阶段建设最小 `AgentSystem` 门面和单 Agent Session Runtime。它既是可直接使用的完整链路，
也是未来一次性 child Agent 和长期多 Agent 编排的基础。

## 目标

- Core 独立提供 Session 创建、加载、发送、终止和事件订阅能力。
- 每个活跃 Session 在同一进程内惰性持有并复用一个 root `REMAgent`。
- 服务重启后，Runtime 从持久化 Session 惰性重建，不恢复中断中的运行。
- Agent 事件驱动消息、usage、标题、压缩历史和 Session turn 的持久化。
- 同一 Session 禁止并发运行，不同 Session 可相互独立运行。
- 公共 API 只使用 Core 领域类型，不包含 HTTP、SSE 或 UI DTO。

## 非目标

- 本阶段不实现一次性 child Agent。
- 不实现长期多 Agent、Organizer、Delivery 或中心消息元数据投影。
- 不迁移审批、Workspace 管理和 Todo 查询门面。
- 不支持进程重启后自动续跑中断中的 Agent。
- 不重新引入 Bridge 或任何传输层。

## 方案选择

采用分层 Core Runtime：

- `AgentSystem` 只负责公共用例协调。
- `SessionService` 是 Session 持久化的唯一业务写入方。
- `SessionRuntime` 持有单个 Session 的内存运行状态和 root Agent。
- `SessionRuntimeRegistry` 负责 Runtime 的唯一性和惰性加载。
- `AgentRunDriver` 负责消费 Agent 事件、持久化和发布系统事件。

不采用单体 `AgentSystem`，避免重新形成旧 `AgentsUniService` 的职责聚合；也不只提供低层
Runtime，因为那会继续把运行驱动和持久化责任留给 Core 外部。

## 公共 API

```typescript
interface AgentSystem {
  createSession(input: CreateSessionInput): Promise<SessionInfo>;
  getSession(sessionId: string): Promise<SessionInfo>;
  listSessions(workspace: string): Promise<SessionInfo[]>;
  send(input: SendMessageInput): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  events(signal?: AbortSignal): AsyncIterable<AgentSystemEvent>;
}

interface CreateSessionInput {
  workspace: string;
}

interface SendMessageInput {
  sessionId: string;
  content: UserInputContent;
}
```

`send()` 启动一次后台运行并在运行成功启动后返回。流式输出和终态通过 `events()` 观察。
如果 Session 已在运行，`send()` 抛出明确的领域错误。

Core 提供：

```typescript
function createAgentSystem(assembly: AgentAssembly): AgentSystem;
```

工厂只进行同步组装。调用方仍负责在创建系统前通过现有入口初始化 `AgentDI`。

## SessionService

`SessionService` 负责：

- 创建和加载 Session。
- 按 workspace 列出 Session。
- 缓存已加载的 Session 对象，保证 Runtime 与持久化写入使用同一个内存实例。
- 消费需要持久化的 `REMAgentEvent`。
- 持久化消息、usage、标题、压缩历史和正常完成后的 `currentTurn/updatedAt`。

消息持久化继续调用 `SessionProvider.appendMessage()`，不创建新的消息表或表示层。写入在每个
`AgentRunDriver` 的事件消费循环内按事件顺序串行执行。

持久化失败不能被静默吞掉：Driver 发布 `session-error`，Runtime 进入 error 后回到非运行态。
这与旧 Bridge 的 best-effort 写入不同，避免模型已继续执行而消息历史永久缺失。

## SessionRuntime

```typescript
type SessionRuntimeStatus = 'idle' | 'running' | 'error';

class SessionRuntime {
  readonly sessionId: string;
  readonly workspace: string;
  readonly rootAgent: REMAgent;
  status: SessionRuntimeStatus;
}
```

Runtime 在构造时接收已经加载的 Session，但 root Agent 通过工厂惰性创建。第一次 `send()`
创建 root Agent；后续 `send()` 复用同一个实例，从而延续 `REMAgent` 自持 transcript。

Runtime 负责原子状态迁移：

```text
idle/error -> running -> idle
                     \-> error
```

- `startRun()` 在已经 running 时抛出 `SessionAlreadyRunningError`。
- `finishRun()` 清理本轮 AbortController 并进入 idle。
- `failRun()` 清理本轮状态并进入 error。
- `interrupt()` 调用 root Agent 的 `interrupt()`；事件流正常结束后由 Driver 收尾。
- interrupt 不销毁 root Agent，也不删除 Runtime。

`error` 表示上一轮失败，不阻止下一次 `send()`；下一轮开始时可以再次进入 running。

## SessionRuntimeRegistry

Registry 用 `Map<string, Promise<SessionRuntime>>` 缓存加载结果，确保同一进程内针对同一
`sessionId` 的并发首次访问只创建一个 Runtime 和 root Agent 所有权边界。

```typescript
getOrCreate(sessionId, load): Promise<SessionRuntime>
get(sessionId): SessionRuntime | undefined
remove(sessionId): void
```

如果加载失败，Registry 必须删除对应的 rejected Promise，允许后续重试。Registry 不扫描或
预加载数据库；重启后所有 Runtime 都由首次访问惰性重建。

## AgentRunDriver

Driver 接收 Runtime、root Agent 的事件流和发布函数，并按顺序处理：

1. `message-persist`：交给 `SessionService` 追加消息，不作为公开 chunk 发布。
2. `usage`：持久化 usage，并发布 `usage-change`。
3. `session-title`、`compress-end`：先持久化，再发布对应 chunk。
4. 普通 Agent 事件：发布带 `sessionId/workspace/agentId` 的 `chunk`。
5. `todo-updated`：发布专门的系统事件，不重复作为 chunk。
6. `finish`：更新 Session turn，Runtime 回到 idle，发布 `session-end`。
7. `error` 或消费异常：Runtime 进入 error，发布 `session-error`。

每轮开始时 `AgentSystem.send()` 先发布 `session-start` 和 pending activity；Driver 根据
`turn_start`、流式 thinking/text/toolcall、`turn_end` 和终态事件发布 activity 变化。

本阶段不保留完整流式 snapshot；以后传输层若需要断线回放，可在独立观测模块中基于事件建立，
不塞入 Session Runtime。

## AgentSystemEvent

本阶段沿用已有 `BusEvent` 的单 Agent 子集，但对外命名为 `AgentSystemEvent`，并保留
`BusEvent` 类型别名兼容现有 Core API：

```typescript
type AgentSystemEvent =
  | { type: 'session-start'; sessionId: string; workspace: string }
  | { type: 'session-end'; sessionId: string; workspace: string }
  | { type: 'session-error'; sessionId: string; workspace: string; error: string }
  | { type: 'activity-change'; sessionId: string; workspace: string; activity: SessionActivity }
  | { type: 'chunk'; sessionId: string; workspace: string; agentId: string; chunk: AgentStreamEvent }
  | { type: 'usage-change'; sessionId: string; workspace: string; usage: Usage }
  | { type: 'todo-updated'; sessionId: string; workspace: string; todos: TodoItem[] };
```

`events(signal)` 将 `BroadcastBus` 的订阅适配为 AsyncIterable。每个订阅者拥有独立队列，慢订阅者
不阻塞 Agent 执行；AbortSignal 结束订阅并释放 listener。

## 数据流

```text
AgentSystem.send
  -> SessionService.requireSession
  -> SessionRuntimeRegistry.getOrCreate
  -> SessionRuntime.startRun
  -> SessionRuntime.getOrCreateRootAgent
  -> REMAgent.run
  -> AgentRunDriver.drive
       -> SessionService.persistAgentEvent
       -> BroadcastBus.publish
       -> SessionRuntime.finishRun/failRun
```

同一进程内第二次发送复用 Runtime 和 root Agent。进程重启后，Registry 为空；首次发送加载完整
Session conversation，新的 `REMAgent` 从该 conversation 初始化 transcript，因此恢复历史但不
恢复旧运行状态。

## 错误处理

- Session 不存在：抛出 `SessionNotFoundError`。
- Session 正在运行：抛出 `SessionAlreadyRunningError`，不启动第二个 Agent loop。
- Agent 装配或模型错误：由 `REMAgent` 合成为 error 事件，Driver 发布 `session-error`。
- 持久化失败或事件消费失败：Driver 中止 Agent、标记 Runtime error 并发布 `session-error`。
- 订阅者回调异常：由 BroadcastBus 隔离，不影响运行。
- `interrupt()` 找不到已加载 Runtime 或当前没有运行时为幂等 no-op；它不为只执行终止而加载
  Session。

## 模块边界

```text
packages/core/src/
├── system/
│   ├── agent-system.ts
│   ├── create-agent-system.ts
│   ├── event-stream.ts
│   ├── errors.ts
│   ├── types.ts
│   └── index.ts
├── session/
│   ├── service.ts
│   ├── runtime.ts
│   └── runtime-registry.ts
└── agent/
    └── agent-run-driver.ts
```

- 类型与错误独立放置。
- 实现文件目标不超过 150 行，绝对不超过 200 行。
- `system` 只依赖 Core 的 agent/session/assembly 能力。
- Session Runtime 不负责持久化，SessionService 不负责驱动 Agent。
- Driver 不创建 Session 或 Agent，只消费一次运行的事件。

## 测试

单元测试覆盖：

- Runtime 首次创建 root Agent并在连续运行中复用。
- Registry 并发首次加载只创建一次，失败后可重试。
- Runtime 的并发运行拒绝、interrupt 和 error 后重试。
- Event AsyncIterable 的独立订阅、AbortSignal 和取消清理。
- SessionService 对各类 Agent 事件的顺序持久化。

集成测试覆盖：

- `createAgentSystem()` 创建 Session并完成一次发送。
- 同一 Session 连续发送复用 root Agent并持久化两轮消息。
- 不同 Session 使用不同 root Agent，历史互不污染。
- 模拟重启（新建 AgentSystem，共用 StorageProvider）后继续既有 Session 历史。
- interrupt 后事件流正常终止，Session 可再次发送。
- Core build、typecheck、全部测试和结构检查全绿。
