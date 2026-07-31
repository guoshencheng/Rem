# Session Root Agent 复用设计

## 背景

`AgentsUniService` 已通过 `REMSession.agents` 持有运行时 `REMAgent`。但当前每次
`run()` 都会创建新的 root Agent，并将其追加到数组；与此同时，运行控制通过
`agents[0]` 查找 root Agent。

这会带来两个问题：

1. 同一 session 的后续运行无法复用 Agent 已初始化的上下文和内部 transcript。
2. 第二次运行创建新 Agent 后，`steer()` 和 `followUp()` 仍可能操作第一次运行的
   Agent。

## 目标

- 同一服务进程内，每个 session 只创建一个 root `REMAgent`。
- 同一 session 的后续 `run()` 复用该 root Agent。
- 每次运行仍拥有独立的中止控制器和运行状态。
- child Agent 继续按每次 `delegate_task` 创建，不跨委派任务复用。
- 服务重启后，从持久化 session conversation 创建新的 root Agent。

## 非目标

- 不把 `REMAgent` 序列化到持久化 `Session`。
- 不新增 Core session runtime 抽象。
- 不改变 child Agent 的生命周期。
- 不在本次改动中增加 Agent 缓存淘汰策略。

## 设计

### REMSession 所有权

`REMSession` 将 root Agent 与 child Agent 的所有权表达清楚：

- 使用单独的 `rootAgent` 属性保存唯一 root Agent。
- child Agent 使用独立集合保存，供运行状态展示和子 Agent 编号使用。
- 提供获取或设置 root Agent 的窄接口，避免调用方依赖 `agents[0]` 的隐式约定。

root Agent 的创建仍由 `AgentsUniService` 负责，因为它拥有组装 Agent 所需的
`AgentDI`、`AgentRuntimeConfig`、workspace 和 child-spawn 回调。

### run 数据流

第一次调用 `run(workspace, sessionId, input)`：

1. 加载或创建持久化 `Session`。
2. 获取对应的 `REMSession`。
3. 创建本轮 `AbortController`。
4. 若尚无 root Agent，则用持久化 Session 创建并保存。
5. 调用该 root Agent 的 `run(input)`。

后续调用相同 session：

1. 复用已经加载的持久化 `Session` 和 `REMSession`。
2. 创建新的本轮 `AbortController`。
3. 取得已有 root Agent，不再重新构造。
4. 调用同一个 root Agent 的 `run(input)`。

`REMAgent` 自身已在每次 `run()` 时创建新的 `AgentRunState` 和内部
`AbortController`，并保留 `messages`、惰性初始化结果及消息队列，因此适合作为
跨轮次复用对象。

### 中止控制

当前 root Agent 构造时接收首次运行的 `signal`，该 signal 不适合复用到后续运行。
设计调整为：

- root Agent 不绑定 `REMSession.startRun()` 返回的单次 signal。
- `interrupt()` 同时触发 session 当前运行控制器和 root Agent 的 `interrupt()`。
- `reset()` 采用相同的中止路径，然后结束 session 本轮状态，但保留 root Agent。
- `deleteSession()` 中止当前运行并删除整个 `REMSession`，因此 root Agent 随之释放。

`REMAgent` 每次执行内部创建的 `activeAbort` 仍是实际传入 Agent loop 的中止信号。

### child Agent

每次 `delegate_task` 仍创建一个新 child Session 和 child Agent。child Agent：

- 附着到当前 root/parent Agent 的 children 树。
- 加入 `REMSession` 的 child Agent 集合。
- 不参与 root Agent 复用。

child Agent ID 使用独立的递增序号或 child 集合长度生成，避免依赖包含 root Agent
的混合数组。

### 错误和并发

- session 已处于 `running` 时，重复 `run()` 继续返回 409。
- root Agent 自身也拒绝并发 `run()`，作为第二层保护。
- 一次运行失败后，`REMSession` 可进入 `error`；下一次 `run()` 可复用同一 root
  Agent，因为 Agent 的单次运行状态会重新创建。
- 若首次 root Agent 创建同步失败，不缓存不完整对象，并按现有路径结束本轮 session。

## 模块边界

本次修改限定在现有职责内：

- `rem-session.ts`：表达 session 对 root/child Agent 的运行时所有权。
- `agents-uni-service.ts`：创建或复用 root Agent，并协调中止。
- 对应 bridge 测试：验证实例复用、消息连续性和运行控制目标。

不修改持久化 `Session` 类型，也不把 bridge 的运行编排职责移入 Core。

## 测试

新增或扩展测试覆盖：

1. 同一 session 连续运行两次，root Agent 对象引用保持相同。
2. 第二次运行的 transcript 包含第一轮消息，并最终持久化两轮对话。
3. 连续运行不会增加 root Agent 数量。
4. `steer()`、`followUp()` 始终定位唯一 root Agent。
5. `interrupt()` 和 `reset()` 能中止当前运行，且 reset 后 root Agent 仍可复用。
6. `deleteSession()` 后内存 session 与 root Agent 一并移除。
7. 不同 session 使用不同的 root Agent。

验证命令：

```bash
pnpm typecheck
pnpm test
```

## 完成标准

- 同一进程内，一个 session 对应一个稳定的 root Agent 实例。
- 后续运行不再执行 root Agent 构造和惰性上下文初始化。
- session 控制 API 不会指向旧 Agent。
- 全仓类型检查和测试通过。
