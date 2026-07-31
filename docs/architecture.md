# Rem Agent — 当前架构

> 状态：Core-first 重建阶段（2026-07-31）

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
├── capabilities/   todo 与一次性 delegate_task 基础能力
├── tools/          Tool provider 组合、overlay、registry
├── security/       审批、权限、规则、tool policy、workspace 守卫
├── sdk/            Provider 与 Store 稳定接口
├── plugins/        默认 Provider 和 SQLite 存储实现
├── infrastructure/ 配置、LLM、MCP、可观测基础设施
├── system-prompt/  system prompt 选择、装配和模板
└── shared/         无业务依赖的共享工具
```

当前 `REMAgent` 直接调用 pi-agent-core 的无状态 loop，并持有 transcript、steering、follow-up、abort 和 maxTurns。Session 已能通过默认 Session Provider 与 SQLite tree entries 持久化 `pi.Message`。

当前缺口是 Session 运行态、完整事件驱动、长期 AgentThread、中心消息投影和多 Agent调度仍未成为 Core 的完整公共能力。

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
- `pi.Message` 只表达模型消息；多 Agent作者、scope 和 mentions 作为 Harness entry 元数据保存。
- Session 是用户的一场中心会话，AgentThread 是某个长期 Agent 在该 Session 中的私有视角。
- child Agent 的 REMAgent 只运行一次，历史由独立 child Session 保存。

## 目标 Core 能力

### Session 与中心消息

Session 保存唯一消息事实。中心聊天和每个 AgentThread 的模型上下文都由投影器从同一批 entry 生成。Session 级写入入口负责串行化并发消息 append。

### 单 Agent

单 Agent Session 拥有一个 persistent primary AgentThread。同一进程内复用对应 REMAgent；重启后从 Session 消息投影惰性重建。

### 一次性 child Agent

`delegate_task` 创建 child Session、one-shot AgentThread 描述和临时 REMAgent。完成后释放 Agent，不在父 REMAgent 或 Session runtime 中维护 children 集合。

### 长期多 Agent

多 Agent Session 拥有一个 Organizer Thread 和多个 member Thread。用户消息只进入 Organizer；Agent 通过结构化 `send_message` 创建中心消息与 Delivery。Scheduler 负责投递、归并、预算和中止，Organizer 负责判断是否继续讨论并通过 `finish_discussion` 收尾。

### AgentSystem

Core 最终暴露与传输无关的 `AgentSystem` 门面，覆盖 Session CRUD、消息发送、中止、Agent membership、child Session 查询和系统事件订阅。

## 重建顺序

1. 建立 Core-only workspace 基线。
2. 将单 Agent Session runtime、事件驱动和持久化协调建设到 Core。
3. 稳定单 Agent `AgentSystem` 门面。
4. 将 child Agent 收敛为 one-shot DelegationRunner。
5. 增加 AgentThread、中心消息元数据和上下文投影。
6. 增加 Organizer、Scheduler、Delivery 和讨论终止协议。
7. 完成恢复、并发、预算、中断和多层 delegation 集成测试。

完整设计见 [Core Agent System 重建设计](superpowers/specs/2026-07-31-core-agent-system-rebuild-design.md)。
