# Core Agent System 重建设计

## 背景

当前 `rem-agent-core` 已具备单个 `REMAgent`、模型与工具装配、Session 持久化、预算、
审批和一次性 `delegate_task` 等基础能力，但完整运行系统仍部分位于
`packages/bridge`：Session 运行态、Agent 复用、事件驱动、持久化协调和 child Agent
创建都由 Bridge 完成。

项目决定先移除外围实现，集中把 Core 建设成完整、可独立嵌入的 Agent Harness。
UI、Web 和 Routes 已移动到 `archive/` 并提交；本设计只删除仍在活动目录中的
`packages/bridge`，随后以 Core 为唯一活动包逐层重建。

## 目标

- Core 独立提供 Session、单 Agent、长期多 Agent、Organizer 调度和一次性 child
  Agent 的完整能力。
- `Session` 表示用户打开的一场中心会话。
- 长期 Agent 通过 `AgentThread` 在 Session 中拥有独立视角和私有执行上下文。
- Session 只持久化一份中心消息事实，并按用途投影为群聊记录或单 Agent 上下文。
- 多 Agent模式下，用户始终与 Session 对话，由 Organizer 决定由谁响应和何时收尾。
- 一次性 child Agent 拥有独立 child Session，但其 `REMAgent` 只执行一次，结束后释放。
- Core 公共 API 不依赖 HTTP、SSE、React 或 Bridge DTO。

## 非目标

- 本阶段不重建 UI、Web、Routes 或新的 Bridge。
- 不支持服务重启后自动续跑中断的 Agent 或 child Agent。
- 不让用户指定某个长期 Agent 处理输入。
- 不把 thinking 或其他 Agent 的私有工具历史展示到中心聊天。
- 不把可观测运行 ID 作为中心消息模型的基础层级。

## 第一阶段：收缩为 Core-only Workspace

删除：

- `packages/bridge/`

同步清理：

- 根 `package.json` 中所有 Bridge/UI/Web/Routes 构建与类型检查命令。
- 根 `tsconfig.json` 中 Bridge project reference。
- `vitest.config.ts` 中 Bridge/UI/Web alias，只保留 Core alias。
- lockfile 中已移除 workspace 包的 importer。
- README、`AGENTS.md` 和当前架构文档中的活动项目结构。

保留：

- `packages/core/`
- `archive/`
- 历史设计和研究文档；它们属于历史记录，不批量重写。

Core-only 验证命令：

```bash
pnpm --filter rem-agent-core build
pnpm --filter rem-agent-core typecheck
pnpm vitest run packages/core/tests
pnpm --filter rem-agent-core check-structure
```

## 核心领域模型

### Session

`Session` 是用户认知中的一场聊天，也是中心消息所属的持久化边界。

```typescript
interface Session {
  sessionId: string;
  type: 'chat' | 'delegation';
  workspace: string;
  metadata: SessionMetadata;
  createdAt: Date;
  updatedAt: Date;
}
```

child Session 使用明确的直接父关系：

```typescript
interface DelegationParent {
  sessionId: string;
  agentThreadId: string;
  toolCallId: string;
}
```

孙 child 指向直接创建它的 child Session 和 AgentThread，不再全部压平到根 Session。

### AgentProfile

`AgentProfile` 是可复用的 Agent 定义，保存角色、system prompt、模型、工具与行为策略。
同一个 Profile 可以加入多个 Session。

### AgentThread

`AgentThread` 表示一个 Agent 在一个 Session 中的身份、视角和私有上下文边界。

```typescript
interface AgentThread {
  agentThreadId: string;
  sessionId: string;
  agentProfileId: string;
  role: 'primary' | 'organizer' | 'member' | 'delegated';
  lifecycle: 'persistent' | 'one-shot';
}
```

- 单 Agent Session：一个 `primary/persistent` Thread。
- 长期多 Agent Session：一个 `organizer/persistent` Thread 和多个
  `member/persistent` Thread。
- child Session：一个 `delegated/one-shot` Thread。

## 中心消息与投影

### 持久化方式

继续使用现有 `session_entries` 和 `pi.Message`，不新增重复的 messages 表，也不修改
`pi.Message` 协议。多 Agent 编排信息放在 message entry payload 的 Harness 元数据中：

```typescript
interface MessageEntryPayload {
  message: pi.Message;
  messageId: string;
  author?: {
    type: 'user' | 'agent' | 'tool';
    agentThreadId?: string;
  };
  scope?: {
    type: 'session' | 'thread';
    agentThreadId?: string;
  };
  mentions?: string[];
  replyToMessageId?: string;
  rootUserMessageId?: string;
}
```

旧数据加载规则：

- `user` 消息默认为 Session 公开消息。
- `assistant` 消息归属 primary Thread，并默认为公开。
- `toolResult` 归属 primary Thread，并默认为 Thread 私有。
- 缺少 mentions 的旧消息不触发 Agent 投递。

### 中心聊天投影

中心聊天只包含：

- 用户公开消息。
- Agent 公开消息及其作者身份。
- Agent 间的公开 `@` 讨论。

不包含 thinking、Thread 私有消息、工具执行细节或 child Session 内部消息。

### AgentThread 上下文投影

某个 Thread 的模型上下文包含：

- Session 公开消息。
- 当前 Thread 的私有消息、工具调用和工具结果。
- 当前 Agent 自己的回复，保留 `assistant` role。
- 其他 Agent 的公开回复，转换为带作者信息的协作输入。

中心消息是唯一事实来源；AgentThread 不持久化一份重复的群聊 transcript。

### 并发写入

现有 Session tree 使用 `parentId + activeLeafId`。多个 Agent 并发读取同一个 active
leaf 后追加会产生错误分支，因此 Core 必须提供 Session 级原子或串行 append 入口。
所有公开和私有消息都通过该入口写入，投影层不直接操作 SQLite。

## 单 Agent 运行

Core 的 `SessionRuntime` 持有 persistent AgentThread 的运行态：

```typescript
class SessionRuntime {
  readonly sessionId: string;
  readonly threadRuntimes: Map<string, AgentThreadRuntime>;
}
```

```typescript
class AgentThreadRuntime {
  readonly thread: AgentThread;
  readonly agent: REMAgent;
  activity: AgentActivity;
}
```

同一进程内，persistent Thread 的 `REMAgent` 跨多次用户输入复用。每次运行前，Core
把中心消息的新投影同步到该 Agent 的自有 transcript。服务重启后，persistent Thread
从 Session、AgentThread 和消息投影惰性重建。

## 一次性 child Agent

一次 `delegate_task` 的流程是：

```text
创建 child Session
→ 创建 delegated/one-shot AgentThread 描述
→ 创建临时 REMAgent
→ 执行并持久化 child 历史
→ 返回父 Agent tool result
→ 释放 REMAgent
```

父 `REMAgent` 不维护 `children`，`SessionRuntime` 也不维护 child Agent 集合。运行期间，
executor 和事件驱动器临时持有 child 引用。child 完成、失败或中断后不恢复 Agent；
历史通过 child Session 按需读取。

child 状态持久化为：

```typescript
type DelegationStatus = 'running' | 'completed' | 'failed' | 'interrupted';
```

重启后遗留的 `running` 解释为 `interrupted`，不自动续跑。

## 长期多 Agent 运行

### 用户入口

用户只向 Session 发送消息，不指定 Agent。单 Agent Session 直接唤醒 primary Thread；
多 Agent Session 始终先唤醒 Organizer Thread。

### Organizer 与 Scheduler

- Organizer Agent 负责语义判断：向谁提问、信息是否充分、是否继续讨论、最终答案。
- 确定性的 Scheduler 负责消息投递、并发、去重、预算、归并和中止。
- 普通成员不能结束整轮用户问题。
- 只有 Organizer 可以调用 `finish_discussion`。

### 结构化通信

长期 Agent 通过 Core 内置工具发送消息，不解析自然语言中的 `@`：

```typescript
send_message({
  to: ['coder'],
  content: '请评估实现成本',
});
```

工具写入一条公开中心消息、记录 mentions，并创建目标 Thread 的 Delivery。UI 将来可以
根据元数据渲染为 `@coder`。

### MessageDelivery

```typescript
interface MessageDelivery {
  deliveryId: string;
  messageId: string;
  rootUserMessageId: string;
  targetAgentThreadId: string;
  requestedByAgentThreadId?: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'interrupted';
  attempt: number;
}
```

一条消息同时请求多个 Agent 时，该 `messageId` 自然形成并行批次。只有该消息创建的
所有 Delivery 都进入终态，Scheduler 才把聚合结果回投请求方。

### 讨论终止

每条用户消息的 `messageId` 是本轮讨论的根。成员结果最终归并回 Organizer；Organizer
可以继续分派，也可以调用：

```typescript
finish_discussion({ answer: '最终结论' });
```

正常结束必须同时满足：

```text
Organizer 显式 finish
AND
不存在 queued/processing Delivery
AND
讨论预算有效
```

若还有工作未完成，Core 拒绝 finish。讨论预算至少包括 Agent 调用次数、消息数量、深度、
墙钟时间和 token 数量。超限时停止新投递，中止活跃 Agent，并只允许 Organizer 做一次
受限总结。

## 运行状态与消息分离

Agent 当前在做什么属于实时观测维度，不进入中心聊天事实模型：

```typescript
interface AgentActivity {
  agentThreadId: string;
  rootUserMessageId?: string;
  state: 'idle' | 'queued' | 'thinking' | 'calling-function' | 'outputting' | 'error';
}
```

Core 通过事件发布 activity、流式内容、usage、审批和错误。未来 UI 可以分别构建中心聊天
视图和单 AgentThread 运行视图，但 Core 领域模型不由前端展示结构驱动。

## Core 模块边界

目标结构：

```text
packages/core/src/
├── system/                 # AgentSystem 公共门面与装配
├── session/
│   ├── model.ts
│   ├── service.ts
│   ├── runtime.ts
│   ├── runtime-registry.ts
│   ├── messages/           # entry 元数据、串行写入、聊天投影
│   └── agent-thread/       # Thread 类型、服务、runtime、上下文投影
├── orchestration/          # Scheduler、Organizer 协议、Delivery、讨论预算
├── delegation/             # one-shot child Session/Agent 执行
├── agent/                  # REMAgent、run state、run driver
├── workspace/              # workspace 应用服务
├── sdk/                    # 稳定 Store/Provider 接口
└── plugins/                # SQLite 等默认实现
```

文件遵循单一职责和项目大小限制。现有 Bridge 中的逻辑不整体复制到一个 Core 大类，而是按
职责迁移：

| 当前 Bridge 责任 | Core 目标模块 |
|---|---|
| `REMSession` | `session/runtime.ts` |
| `REMSessions` | `session/runtime-registry.ts` |
| `SessionService` | `session/service.ts` |
| `AgentService.drive()` | `agent/agent-run-driver.ts` |
| child 创建与运行 | `delegation/delegation-runner.ts` |
| `AgentsUniService` 编排 | `system/` 与 `orchestration/` 拆分 |
| `WorkspaceService` | `workspace/service.ts` |

## Core 公共门面

Core 最终通过 `AgentSystem` 独立提供完整能力：

```typescript
interface AgentSystem {
  createSession(input: CreateSessionInput): Promise<SessionInfo>;
  listSessions(workspace: string): Promise<SessionInfo[]>;
  getSession(sessionId: string): Promise<SessionSnapshot>;
  send(input: SendMessageInput): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  addAgent(sessionId: string, profile: AgentProfile): Promise<AgentThread>;
  removeAgent(sessionId: string, agentThreadId: string): Promise<void>;
  listAgents(sessionId: string): Promise<AgentThread[]>;
  listChildSessions(sessionId: string): Promise<ChildSessionInfo[]>;
  events(signal?: AbortSignal): AsyncIterable<AgentSystemEvent>;
}
```

Core API 使用领域类型，不包含 HTTP status、SSE frame 或 UI message DTO。

## 分阶段重建

1. 收缩 workspace：删除 Bridge，修正根配置和当前文档，确保 Core-only 基线通过。
2. 把现有 Bridge 的单 Agent Session runtime、事件驱动和持久化协调按职责迁回 Core。
3. 稳定单 Agent `AgentSystem` 公共门面，并用 Core 集成测试替代 Bridge 测试。
4. 删除 `REMAgent.children`，建立 one-shot `DelegationRunner` 和直接父 Session 关系。
5. 增加 AgentThread 持久化、中心 message 元数据和 Thread 上下文投影。
6. 增加长期多 Agent Scheduler、Organizer、Delivery 和终止协议。
7. 完成恢复、并发、预算、中断和多层 delegation 集成测试。

每一阶段都必须产生可独立构建、可测试的 Core，不允许长期保留半迁移状态。

## 错误与恢复语义

- Core 写入 Session、AgentThread、Message 和 Delivery 时保持可重试和幂等。
- 服务重启后 persistent AgentThread 可惰性恢复，活跃 `REMAgent` 不序列化。
- `processing` Delivery 和 `running` child 状态恢复为 `interrupted`。
- 不自动恢复外部工具调用，避免重复副作用。
- Agent失败时结果回投请求方；Organizer失败时整轮用户问题失败。
- 用户 interrupt 中止同一根用户消息下的全部活跃运行与排队 Delivery。

## 测试策略

- 单元测试：message 元数据默认、Thread 投影、Delivery 状态机、预算和终止判断。
- Store 契约测试：AgentThread、Message append、Delivery claim/complete/recovery。
- 单 Agent 集成测试：Session 创建、跨轮 Agent 复用、消息持久化、重启重建。
- child 集成测试：直接父关系、多层 delegation、完成/失败/中断、Agent 不被长期持有。
- 多 Agent 集成测试：Organizer 首发、并行投递、Agent 间通信、结果归并、继续讨论和 finish。
- 并发测试：同一 Session 多 Agent 写入不产生丢失分支或重复 Delivery。
- 结构检查：Core 新文件满足模块职责和文件大小红线。

## 完成标准

- 活动 workspace 只包含可独立构建和测试的 Core。
- 仅使用 `rem-agent-core` 即可完成 Session 创建、消息发送、事件订阅和中止。
- 单 Agent、一次性 child、多 Agent Organizer 三种路径使用同一 Core 公共门面。
- 中心聊天和任意 AgentThread 上下文都从同一持久化消息事实稳定投影。
- 多 Agent讨论只能由 Organizer 收尾，Scheduler 确保无未完成工作并执行预算限制。
- Core 不依赖 Bridge、Routes、UI、Web 或任何传输协议。
