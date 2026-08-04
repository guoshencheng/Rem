# Rem Agent — 当前架构

> 状态：Core-first 多 Agent 执行内核已落地（2026-08-02）

## 活动边界

`packages/core` 是唯一活动包。`archive/` 保存旧 Core、Bridge、Routes、UI 和 Web 实现，不参与 workspace 构建。

当前目标不是维护接入层，而是先让 Core 独立提供完整 Agent System。未来的协议、服务和 UI 只能依赖 Core；Core 不依赖 HTTP、SSE、React 或其他表现层协议。

## 当前 Core 能力

```text
packages/core/src/
├── agent/          REMAgent、单次 run 状态、事件、输出、预算
├── assembly/       DI、runtime config、Agent 装配与环境入口
├── runtime/        工具组装、压缩 transform、待处理消息队列
├── session/        Session 模型、tree entry 与通用管理逻辑
├── orchestration/  Team、Delivery、三层 Runtime、Scheduler 与讨论预算
├── capabilities/   todo 与一次性 delegate_task 基础能力
├── tools/          Tool provider 组合、overlay、registry
├── security/       审批、权限、规则、tool policy、workspace 守卫
├── sdk/            Provider 与 Store 稳定接口
├── plugins/        默认 Provider 和 SQLite 存储实现
├── plugin-system/  装配期 Agent 插件执行、事务与错误边界
├── infrastructure/ 配置、LLM、MCP、可观测基础设施
├── system-prompt/  system prompt 选择、装配和模板
└── shared/         无业务依赖的共享工具
```

`REMAgent` 直接调用 pi-agent-core 的无状态 loop，并持有 transcript、steering、follow-up、abort 和每次运行独立的 maxTurns。Session 通过默认 Session Provider 与 SQLite tree entries 持久化 `pi.Message`；`AgentSystem` 已统一支持单 Agent、一次性 child Agent 和配置驱动的长期多 Agent Team。

## 依赖原则

```text
未来接入层 / UI
        ↓
Core AgentSystem
├── Session 与消息事实
├── AgentThread 与上下文投影
├── 单 Agent runtime
├── one-shot delegation
├── Organizer / Scheduler
├── persistence / events / interrupt / budget
└── REMAgent / pi-agent-core loop
```

- Core 领域层不引用未来接入层类型。
- SDK 只定义稳定抽象，默认实现位于 plugins。
- `AgentDI` 持有已完成装配的运行时能力；`AgentPlugin` 只参与装配，不进入 Agent 执行生命周期。
- `plugin-system/` 执行统一插件协议，`plugins/` 仍表示 SDK Provider 的内置实现，两者不可混用。
- System prompt 插件通过具名 section registry 贡献内容；`runtime` 内容可替换，但始终是最后一个 section。
- `pi.Message` 只表达模型消息；多 Agent作者、scope 和 mentions 作为 Harness entry 元数据保存。
- Session 是用户的一场中心会话，AgentThread 是某个长期 Agent 在该 Session 中的私有视角。
- child Agent 的 REMAgent 只运行一次，历史由独立 child Session 保存。

## 已落地 Core 能力

### Session 与中心消息

Session 保存唯一消息事实。中心聊天和每个 AgentThread 的模型上下文都由投影器从同一批 entry 生成。Session 级写入协调器串行化并发 append；Agent 间通信的一条中心 Message 与整批 Delivery 在同一 SQLite 事务中提交。

### 单 Agent

单 Agent Session 拥有一个 persistent primary AgentThread。同一进程内复用对应 REMAgent；重启后从 Session 消息投影惰性重建。

### 一次性 child Agent

`delegate_task` 创建 child Session、one-shot AgentThread 描述和临时 REMAgent。完成后释放 Agent，不在父 REMAgent 或 Session runtime 中维护 children 集合。

### 长期多 Agent

多 Agent Session 拥有一个 Organizer Thread 和多个 member Thread。用户消息只进入 Organizer；Agent 通过结构化 `send_message` 创建中心消息与 Delivery。Scheduler 负责投递、归并、预算和中止，Organizer 负责判断是否继续讨论并通过 `finish_discussion` 收尾。

Team 来自 workspace 配置：`agents` 定义稳定的 `agentId`，`teams` 引用 Organizer 和 Members。没有显式 `teamId` 时始终创建单 Agent Session，不存在缺省 Team。

```yaml
agents:
  organizer: { name: Organizer, corePrompt: "组织讨论并收敛结论" }
  architect: { name: Architect, corePrompt: "负责架构分析" }
teams:
  engineering:
    organizer: organizer
    members: [architect]
orchestration:
  maxAgentRuns: 20
  maxMessages: 50
  maxDepth: 8
  timeoutMs: 300000
  maxTokens: 200000
  maxParallelAgents: 4
```

运行态分为三层：

- `SessionRuntime`：持有一个 Session 的进程内执行权，同一 Session 不并行处理两条用户输入。
- `AgentThreadRuntime`：缓存一个 REMAgent，并以 FIFO 队列保证同一 Thread 永不并发。
- `DiscussionRuntime`：只覆盖一条根用户消息，维护 abort、finish 请求和讨论预算。

不同 AgentThread 受 `maxParallelAgents` 限制并行。每条 Delivery 执行前重新投影中心消息并调用 `syncTranscript()`；Runtime 与 REMAgent 不序列化，重启后按 Session、Thread 和配置惰性重建。

Delivery 记录 message/resume、批次、请求方、目标 Thread、深度与状态。批次中的 message Delivery 全部终态后，Scheduler 幂等创建一个 requester resume；初始 Organizer Delivery 不回投。启动恢复把遗留 processing Delivery 改为 interrupted，不自动重试或重放工具。

讨论预算覆盖 Agent run 数、中心消息数、投递深度、墙钟时间和 token。耗尽后普通投递被中止，只允许一次禁用 `send_message` 的 Organizer 受限总结。

### AgentSystem

Core 暴露与传输无关的 `AgentSystem` 门面，覆盖 Session 创建/查询、消息发送、中止、Thread 列表、中心聊天投影、单 Thread 模型上下文和系统事件订阅。接入层无需指定由哪个 Agent 响应。

## 当前持久化模型

- Session schema 使用 v2 tree entry；SQLite schema 当前为 v11。
- `AgentThread.agentId` 直接引用配置 key，不再持久化独立身份配置实体。
- Session 删除级联删除 Thread 和 Delivery。
- 中心 Message 只存一份；Delivery 只保存路由和执行状态，不复制消息正文。

完整设计见 [Core Agent System 重建设计](superpowers/specs/2026-07-31-core-agent-system-rebuild-design.md)。
