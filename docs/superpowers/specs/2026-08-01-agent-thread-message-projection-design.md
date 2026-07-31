# AgentProfile、AgentThread 与中心消息投影设计

## 背景

Core 已支持持久 Session、可复用单 Agent Runtime 和一次性 child Agent。长期多 Agent需要在
重启后恢复 Session 的成员组织，并让多个 Agent基于同一份中心消息形成各自模型上下文。

本阶段建设 Profile、Thread、中心消息元数据和投影层，不实现 Organizer、Scheduler 或多 Agent
并发执行。

## 不变量

1. `AgentProfile` 和 `AgentThread` 可持久化恢复。
2. 一条消息只在 `session_entries` 中保存一次。
3. Thread 不保存 transcript；上下文始终由中心消息投影得到。
4. 所有消息追加经过 Session 级串行入口。
5. 投影只读，不修改中心消息或创建副本。

## 目标与非目标

目标：

- 正式持久化可复用 AgentProfile。
- 正式持久化 Agent 在 Session 中的 AgentThread 身份。
- 为 message entry 增加 Harness 作者、scope、mentions 和讨论关联元数据。
- 提供群聊展示投影和单 Thread 模型上下文投影。
- 自动为既有单 Agent Session 建立默认 Profile 和 primary Thread。
- 单 Agent Runtime 重启时通过 Thread/Profile 重建 Agent。
- child Session 建立 delegated/one-shot Thread。

非目标：

- 不实现 Organizer、Member 调度、Delivery、`send_message` 或 `finish_discussion`。
- 不同时运行多个 persistent Thread。
- 不提供 Profile 管理 UI 或传输 DTO。
- 不迁移或重写旧 message entry。

## AgentProfile

```typescript
interface AgentProfile {
  agentProfileId: string;
  name: string;
  systemPrompt?: string;
  model?: { provider: string; model: string };
  toolPolicy?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
```

Profile 表达可跨 Session 复用的 Agent定义，不保存会话状态。默认单 Agent Profile 使用稳定 ID
`default-primary`；它由 ProfileService 幂等创建。Profile 更新不在本阶段公共 AgentSystem API 中
开放，但 Store/Service 提供基础 CRUD 供后续组建多 Agent使用。

## AgentThread

```typescript
type AgentThreadRole = 'primary' | 'organizer' | 'member' | 'delegated';
type AgentThreadLifecycle = 'persistent' | 'one-shot';

interface AgentThread {
  agentThreadId: string;
  sessionId: string;
  agentProfileId: string;
  role: AgentThreadRole;
  lifecycle: AgentThreadLifecycle;
  createdAt: Date;
  updatedAt: Date;
}
```

Thread 表达 Profile 在某个 Session 中的身份和上下文边界。约束：

- 一个 Session 最多一个 primary Thread。
- 一个长期多 Agent Session 最多一个 organizer Thread。
- `(sessionId, agentProfileId)` 对 persistent Thread 唯一。
- delegated Thread 为 one-shot，并绑定 child Session。
- 删除 Session 时删除其 Thread；删除 Profile 前若仍被 Thread 引用则拒绝。

## Store 与 SQLite

`StorageProvider` 新增：

```typescript
readonly agentProfileStore: AgentProfileStore;
readonly agentThreadStore: AgentThreadStore;
```

Store 接口：

```typescript
interface AgentProfileStore {
  save(profile: AgentProfile): Promise<void>;
  get(agentProfileId: string): Promise<AgentProfile | null>;
  list(): Promise<AgentProfile[]>;
  delete(agentProfileId: string): Promise<void>;
}

interface AgentThreadStore {
  save(thread: AgentThread): Promise<void>;
  get(agentThreadId: string): Promise<AgentThread | null>;
  listBySession(sessionId: string): Promise<AgentThread[]>;
  delete(agentThreadId: string): Promise<void>;
}
```

SQLite schema 从 v9 升到 v10，新增 `agent_profiles`、`agent_threads`、Session/role/profile 索引和
外键。Session 删除级联 Thread；Profile 删除使用 RESTRICT。新数据库 DDL 和 v9→v10 migration
产生相同结构。

## 中心消息 Payload

```typescript
interface MessageAuthor {
  type: 'user' | 'agent' | 'tool';
  agentThreadId?: string;
}

interface MessageScope {
  type: 'session' | 'thread';
  agentThreadId?: string;
}

interface MessageEntryPayload {
  message: Message;
  messageId: string;
  author?: MessageAuthor;
  scope?: MessageScope;
  mentions?: string[];
  replyToMessageId?: string;
  rootUserMessageId?: string;
}
```

写入新消息时 author/scope 必填；字段保持可选是为了读取旧 entry。校验规则：

- author 为 agent/tool 时必须有 agentThreadId。
- scope 为 thread 时必须有 agentThreadId。
- mentions 去重，内容为 AgentThread ID。
- user 默认 session scope。
- assistant 默认 agent author。
- toolResult 默认 tool author和 thread scope。

## 旧消息归一化

```typescript
normalizeMessagePayload(payload, primaryThreadId): NormalizedMessageEntryPayload
```

缺失 metadata 时：

- user → `author:user`、`scope:session`
- assistant → `author:agent(primaryThreadId)`、`scope:session`
- toolResult → `author:tool(primaryThreadId)`、`scope:thread(primaryThreadId)`

其他 Harness 自定义消息按 role 明确处理或抛出领域错误，不能猜测作者。归一化只存在于读取
结果中，不回写数据库。

## Session 级 MessageAppender

```typescript
interface AppendMessageInput extends MessageEntryPayload {
  sessionId: string;
}

class SessionMessageAppender {
  append(input: AppendMessageInput): Promise<void>;
}
```

Appender 按 `sessionId` 维护 Promise tail：同一 Session 的操作严格串行，不同 Session 可并发。
每次操作在临界区内读取最新 active leaf、追加 entry 并推进 active leaf。失败不会阻塞后续追加，
tail 在 settle 后清理。

`SessionProvider.appendMessage()` 扩展为接收完整 payload，并委托 Appender。现有调用方由
SessionService补充 primary Thread metadata。投影模块不允许直接 append。

## 群聊投影

```typescript
projectSessionChat(
  entries: SessionTreeEntry[],
  leafId: string | null,
  primaryThreadId: string,
): SessionChatMessage[];
```

沿 active leaf 链读取，只包含：

- session scope 的用户消息；
- session scope 的 Agent公开消息。

排除 toolResult、thinking-only 私有消息和所有 thread scope 消息。返回 messageId、原始 Message、
authorThreadId、mentions、reply/root ID，供未来 UI 展示。

## Thread 模型上下文投影

```typescript
projectThreadContext(input: {
  entries: SessionTreeEntry[];
  leafId: string | null;
  target: AgentThread;
  threads: AgentThread[];
  profiles: AgentProfile[];
}): Message[];
```

投影规则：

- 所有 session scope 用户消息可见。
- target Thread 的 session/thread scope Agent消息可见，并保持 assistant role。
- target Thread 的 toolResult和私有工具历史可见。
- 其他 Thread 的 session scope Agent消息转换为 user 消息，文本前缀为
  `[Agent: <profile.name>]`。
- 其他 Thread 的 thread scope 消息不可见。
- mentions 不改变历史可见性；后续 Scheduler 用它创建 Delivery。
- 输出顺序与中心 entry 链一致。

非文本的其他 Agent公开消息在转换时保留文本/图片内容，并增加一个作者文本块；无法安全转换的
Harness 私有消息不进入目标上下文。

## Profile/Thread Service

`AgentProfileService` 提供默认 Profile 幂等创建和基础查询。

`AgentThreadService` 提供：

```typescript
ensurePrimaryThread(sessionId): Promise<AgentThread>;
createDelegatedThread(sessionId, profileId): Promise<AgentThread>;
listBySession(sessionId): Promise<AgentThread[]>;
```

并发 ensure 依靠数据库唯一约束和失败后的重新读取保证一个 primary Thread。

## 单 Agent接入

`SessionRuntime` 增加 primary Thread 身份，但仍只持有一个 root REMAgent。`AgentSystem.send()`：

1. 加载 Session。
2. `ensurePrimaryThread()`。
3. 由消息投影构造该 Thread 的恢复 conversation。
4. 创建 Runtime/root Agent；同进程后续继续复用。
5. AgentRunDriver 持久化事件时附加 primary Thread author/scope。

公开 user/assistant 使用 session scope；toolResult 使用 primary Thread scope。thinking 是 assistant
内容的一部分时沿 assistant消息 scope；本阶段不拆 pi Message 内容块。

## child 接入

创建 delegation Session 后，Runner 为其创建 delegated/one-shot Thread。child 的 Profile：

- 默认继承直接父 Thread 的 Profile。
- systemPrompt/maxTurns 覆盖仍属于本次 REMAgent 参数，不修改共享 Profile。
- child 消息使用 delegated Thread 元数据。

Runner 局部持有 delegated Thread ID，完成后释放 Agent；Thread 和 Session 历史继续持久化。

## 模块边界

```text
agent-profile/
  model.ts
  store.ts
  service.ts
session/agent-thread/
  model.ts
  store.ts
  service.ts
session/messages/
  payload.ts
  normalize.ts
  appender.ts
  entry-chain.ts
  session-chat-projector.ts
  thread-context-projector.ts
plugins/storage/sqlite/
  agent-profile-store.ts
  agent-thread-store.ts
```

类型、接口、实现和投影分别维护。实现文件目标不超过 150 行，绝对不超过 200 行。

## 错误处理

- Profile/Thread 不存在：明确领域错误。
- Thread 引用不存在 Profile：加载失败，不使用默认 Profile掩盖损坏。
- primary/organizer 唯一约束冲突：Service 重新读取现有项；若角色不一致则报错。
- payload metadata 非法：写入前拒绝。
- append 失败：本次调用失败，但 Session tail 清理，后续消息仍可追加。
- 投影遇到未知 Thread/Profile：抛出投影错误，避免错误归属消息。

## 测试

- SQLite Profile/Thread CRUD、唯一约束、级联和 RESTRICT。
- v9→v10 migration 与新库结构一致。
- 并发 ensure primary 只产生一个 Thread。
- MessageAppender 同 Session 串行、跨 Session 并行、失败后恢复。
- 旧消息归一化规则。
- 群聊投影过滤私有消息。
- Thread 投影保留自己角色、转换其他 Agent公开消息、隔离他人私有消息。
- 单 Agent首次访问创建默认 Profile/Thread，重启后恢复同一 ID 和历史。
- child 创建 delegated Thread 并继承父 Profile。
- build、typecheck、全量测试和结构检查通过。
