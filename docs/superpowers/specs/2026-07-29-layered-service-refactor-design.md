# 分层服务重构设计（core-v2 / bridge-v2）

日期：2026-07-29
状态：已确认

## 背景与动机

现有分层存在三类问题，本次重构三者同等重要：

1. **多 Agent 不是一等公民**：delegate_task 子 Agent 绕过 AgentService 管理（不进 activeRuns、无法 steer/interrupt、drive 循环双份实现）。
2. **分层与职责不清**：`runAgent` 是 230 行 god function；session 有两个写入方（sessionHelper 写消息、runAgent 写 metadata/usage）；`AgentState` 全局单例身兼 run 生命周期、snapshot 聚合、广播总线三职，被 core/bridge 两侧直接操作。
3. **Workspace 没有作用域**：workspace 只是贯穿字符串参数，session 过滤在内存做，`SessionStore.listByWorkspace` 已实现却闲置。

## 总体策略：新旧并存

新建 `packages/core-v2` 与 `packages/bridge-v2` 承载新实现，旧 `core`/`bridge` 不动。web 通过启动时环境变量 `REM_IMPL=v1|v2` 切换装配旧 `AgentService` 或新 `AgentsUniService`，routes/ui 接口保持兼容以支持无感切换与新旧对比。旧包删除不在本次范围。

## 分层架构

```
┌─ WorkspaceService (bridge-v2)
│    workspace 注册表（list/add/remove）
│    workspace 级配置解析（forWorkspace 收敛到这里）
│    session 按 workspace 隔离（走 SessionStore.listByWorkspace SQL 层）
│
├─ AgentsUniService (bridge-v2) —— 对外门面，routes/ui 只跟它说话
│    sessions: REMSessions（Map<sessionId, REMSession>）
│    组合并编排下面三个服务；持有全局事件总线（一条总流）
│
├─ AgentService (bridge-v2) —— 仅 Agent 的运行和监听
│    run / listen / steer / followUp / interrupt
│
├─ SessionService (bridge-v2) —— 会话持久化，唯一写入方
│    CRUD / list / search / getMessages / update / delete
│    appendMessage / saveMetadata 统一落盘
│
└─ REMSession (bridge-v2) —— session 级全部内存状态
     agents: REMAgent[]
     status / budget / streamingSnapshot / runController /
     activity / pendingToolCalls / approvalEngine / tokenUsage

REMAgent (core-v2) —— 无状态执行单元 + 事件源
  包装 pi-agent Agent；children: REMAgent[]（delegate_task 子 Agent 挂这里）
  run(input) → AsyncIterable<REMAgentEvent>
  不碰存储、不持有总线、不持有任何内存状态
```

关键变化：

- core-v2 不再有 session/状态概念，`runAgent` 函数重构为 `REMAgent` 类。
- 全局单例 `AgentState` 拆掉，内存状态按 session 隔离进 `REMSession`。
- 持久化从订阅者副作用改为显式 `message-persist` 事件，SessionService 是唯一写入方（含消息、metadata、usage、标题）。

## 数据流

### 主 Agent run

```
AgentsUniService.run(ws, sid, input)
  → REMSessions.getOrCreate(sid)           （REMSession 载入/恢复状态）
  → remAgent = core-v2 REMAgent 装配       （DI + 配置 + 工具 + systemPrompt）
  → remSession.agents.push(remAgent)
  → SessionService.appendMessage(用户消息)
  → AgentService.run(remSession, remAgent, input)
        消费 remAgent 事件流，每个事件三路分发：
          ① remSession.applyEvent()         → 更新内存状态（snapshot/activity/usage）
          ② message-persist → SessionService → 统一落盘
          ③ 打标签 {sessionId, agentId}      → 全局总流（BusEvent）
```

### 子 Agent（delegate_task）

```
remAgent.run 中触发 delegate_task 工具
  → 父 REMAgent 创建 child REMAgent，挂入 children[]
  → 抛出 child-spawned 事件 → AgentService 收到后 listen(child)
  → child 的事件流同样三路分发（标签带父子关系 agentId 路径，如 'root.delegate-1'）
  → child 结束 → 结果回到父 agent 的 tool result，child 标记 finished
```

### 重连回放

客户端订阅总流时，AgentsUniService 遍历 REMSessions，回放所有 running REMSession 的 snapshot（现状逻辑平移，来源从全局 AgentState 变为 REMSessions）。

### 审批

REMAgent 不持有 approvalEngine。tool-bridge 需要审批时抛出 approval-request 事件并挂起 Promise；REMSession 的 approvalEngine 承接；`resolveApproval` 经 AgentsUniService 路由到对应 REMSession 回填。

## 组件接口契约

### core-v2 —— REMAgent

```typescript
class REMAgent {
  readonly agentId: string;              // 如 'root' / 'root.delegate-1'
  readonly children: REMAgent[];
  readonly status: 'idle' | 'running' | 'finished' | 'error';

  run(input: UserInput, signal?: AbortSignal): AsyncIterable<REMAgentEvent>;
  steer(input: UserInput): void;         // 透传 pi-agent steering
  followUp(input: UserInput): void;
  interrupt(): void;
}

type REMAgentEvent =
  | pi.AgentEvent                        // pi 原生事件原样上抛
  | RemMetaEvent                         // compress/approval/session-title/finish/error
  | { type: 'message-persist'; message: pi.Message; messageId: string }
  | { type: 'child-spawned'; child: REMAgent; parentToolCallId: string }
  | { type: 'usage'; usage: Usage };
```

### bridge-v2 —— REMSession

```typescript
class REMSession {
  readonly sessionId: string;
  agents: REMAgent[];
  // 现 AgentLiveState 全部内容：
  // status / budget / streamingSnapshot / runController /
  // activity / pendingToolCalls / approvalEngine / tokenUsage
  applyEvent(agentId: string, event: REMAgentEvent): BusEvent | undefined;
}
```

`REMSessions` 为 `Map<sessionId, REMSession>` 的管理器，提供 getOrCreate、运行中枚举（供回放）。

### bridge-v2 —— Service 方法面

```typescript
class AgentService {
  run(session: REMSession, agent: REMAgent, input: UserInput): Promise<void>;
  listen(session: REMSession, agent: REMAgent): void;   // 含 children 树递归
  steer(sessionId: string, input: UserInput, agentId?: string): void;
  followUp(sessionId: string, input: UserInput, agentId?: string): void;
  interrupt(sessionId: string, agentId?: string): void;
}

class SessionService {
  create(workspace?): Promise<Session>;
  load(sessionId): Promise<Session | null>;
  list(): Promise<SessionSummary[]>;
  listByWorkspace(workspace): Promise<SessionSummary[]>;  // 走 SessionStore SQL 过滤
  search(workspace?, query): Promise<SessionSummary[]>;
  update(sessionId, updates): Promise<void>;
  delete(sessionId): Promise<void>;
  getMessages(sessionId): Promise<UIMessage[]>;
  appendMessage(sessionId, message, messageId): Promise<void>;
  saveMetadata(sessionId, patch): Promise<void>;  // usage/标题/turn 计数
}

class WorkspaceService {
  list(): Promise<string[]>;
  add(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  resolveConfig(workspace): WorkspaceConfig;      // forWorkspace 收敛到这里
  listSessions(workspace): Promise<SessionSummary[]>;  // 委托 SessionService.listByWorkspace
}

class AgentsUniService {   // 对外门面，对齐现有 IAgentService 接口面（允许调整）
  constructor(agentService, sessionService, workspaceService, di, runtimeConfig);
  sessions: REMSessions;
  // run / steer / followUp / interrupt / reset / stream /
  // createSession / listSessions / searchSessions / getMessages /
  // updateSession / deleteSession / listWorkspaces / addWorkspace /
  // removeWorkspace / listPendingApprovals / resolveApproval / getTodos
}
```

## 错误处理

- REMAgent 执行出错 → `error` 事件（含 agentId）走正常三路分发，REMSession 置 `error`，不 throw 穿层；interrupt/abort 同理映射为事件。
- 子 Agent 出错不传染父 Agent：child 置 error，父的 tool result 收到错误内容，由 LLM 决定后续。
- SessionService 落盘失败 → 记录日志 + 发 `session-error` BusEvent，不中断事件流（与现状一致）。
- 审批 Promise 无超时（沿用现状）；session reset/interrupt 时统一 reject 挂起的审批。

## 测试策略

- core-v2：REMAgent 用 fake models（参考 `packages/core/tests/helpers` 的 InMemory*）验证事件序列、children 挂树、`message-persist` 事件产出；不依赖 bridge。
- bridge-v2：
  - REMSession 状态迁移单测（事件 → 状态映射，表驱动）。
  - AgentService 用 fake REMAgent（手搓 AsyncIterable）测三路分发与递归 listen。
  - SessionService 复用现有 sqlite 测试套路。
- 新旧对比：web 切 `REM_IMPL=v2` 后跑同一套 UI 手工冒烟清单。

## 迁移步骤（粗粒度）

1. 建 `packages/core-v2` 骨架 + REMAgent（runAgent 逻辑迁入，delegate_task 改 children 挂树）。
2. 建 `packages/bridge-v2`：SessionService → REMSession → AgentService → WorkspaceService → AgentsUniService。
3. web 加 `REM_IMPL` 开关，routes 薄层适配两版接口差异。
4. v2 跑通后旧 core/bridge 保留供对比，稳定后再删（删除不在本次范围）。

## 明确不做（YAGNI）

- session 内平级多 Agent 的交互能力（本次只把 delegate_task 子 Agent 挂进 agents/children 结构）。
- workspace 级独立 DI（独立 db/ruleEngine）：本次只到注册表 + 配置 + session 隔离。
- 旧包删除。
