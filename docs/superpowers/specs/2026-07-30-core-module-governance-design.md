# Core 模块目录治理设计

## 1. 背景

`packages/core/src` 当前约 8,800 行、120 余个 TypeScript 源文件。现有代码同时采用两套组织方式：根目录按历史演进堆放 Agent 装配与执行文件，子目录则按 `sdk`、`plugins`、`security`、`session-manager` 等技术或能力概念分组。

这造成以下问题：

- Agent 生命周期分散在根目录、`run-agent`、`session-manager`、`sub-agent` 等位置。
- `session.ts`、`session-manager`、`session-tree` 属于同一领域，却没有共同边界。
- 工具组合、覆盖和注册分别位于根目录与 `registry`。
- 审批位于含义模糊的 `execute`，实际却是安全管线的一部分。
- MCP、LLM、日志和路径配置作为基础设施，与核心领域文件并列。
- 根 `index.ts` 同时暴露稳定 API 和内部装配细节，公共边界过宽。
- `delegate-task-v2.ts` 等命名保留已经失去意义的版本后缀，制造双轨实现的错觉。
- 架构文档引用不存在的 `run-agent/session-writer.ts`，文档与代码已经发生漂移。

本次治理仅处理 `packages/core`。其他 workspace 包暂不迁移，通过临时兼容出口保持 monorepo 可编译。

## 2. 目标与非目标

### 2.1 目标

- 以业务能力为主要组织轴，让目录直接表达 Agent Harness 的领域模型。
- 收拢 Agent 生命周期、装配、运行时、Session、Tools、Security 和原生能力。
- 形成明确且可检查的依赖方向。
- 拆分超过模块规范建议或绝对上限的文件。
- 收紧根公共入口，把稳定、高级和临时兼容 API 分开。
- 在每个迁移批次后保持类型检查与测试通过。
- 同步修正 Core 结构文档，使文档描述真实代码。

### 2.2 非目标

- 不修改 Agent 运行行为。
- 不修改 Session schema 或持久化数据格式。
- 不修改 Agent/Bus 事件协议。
- 不修改 Provider 配置语义、模型调用逻辑或安全决策。
- 不在本阶段迁移 `bridge`、`routes`、`ui`、`web` 或 `local-demo` 的 import。
- 不借结构治理引入新功能。

## 3. 选择的方案

采用“按业务能力分区，分阶段迁移”。相比严格按技术层拆分，该方案让同一业务能力的模型、服务与协作逻辑保持邻近；相比只整理根目录，该方案能真正解决职责割裂。

目标结构如下：

```text
packages/core/src/
├── agent/
│   ├── context/
│   ├── rem-agent.ts
│   ├── agent-run-state.ts
│   ├── agent-output.ts
│   ├── agent-event.ts
│   ├── event-queue.ts
│   └── types.ts
├── assembly/
│   ├── agent-factory.ts
│   ├── agent-assembly.ts
│   ├── agent-context-assembler.ts
│   ├── agent-di.ts
│   ├── runtime-config.ts
│   └── types.ts
├── runtime/
│   ├── assemble-pi-agent.ts
│   ├── pi-agent-factory.ts
│   ├── context-bridge.ts
│   ├── tool-bridge.ts
│   ├── pi-agent-like.ts
│   └── generation/
├── session/
│   ├── model.ts
│   ├── manager/
│   └── tree/
├── tools/
│   ├── registry.ts
│   ├── composer.ts
│   ├── overlay.ts
│   └── types.ts
├── security/
│   ├── approval/
│   ├── permissions/
│   ├── rules/
│   ├── workspace/
│   └── tool-policy/
├── capabilities/
│   ├── sub-agent/
│   └── todo/
├── sdk/
├── plugins/
├── infrastructure/
│   ├── config/
│   ├── llm/
│   ├── mcp/
│   └── observability/
├── system-prompt/
├── shared/
├── compat.ts
└── index.ts
```

目录只在确有多个协作文件时存在；不会为了匹配树形图创建空目录或只有无意义转发的文件。

## 4. 模块职责

### 4.1 Agent

`agent/` 拥有单个 Agent 的生命周期、事件和运行结果语义。它不读取存储、不创建默认 Provider，也不负责具体基础设施初始化。

当前 `rem-agent.ts` 同时负责生命周期、事件归并、Usage 统计、输出构建和标题生成。治理后：

- `rem-agent.ts` 负责公开生命周期操作和协作编排。
- `agent-run-state.ts` 负责单次运行的可变状态与事件归并。
- `agent-output.ts` 负责从最终 Assistant 消息构造输出。
- 标题生成不再由 Agent 执行单元私自启动，交由装配或 Session 协调边界触发。

### 4.2 Assembly

`assembly/` 是唯一组合根，区分三种职责：

- 公共工厂：面向调用方创建并初始化 Agent Assembly。
- 默认组件构造：选择内置 Provider、路径、模板和工具。
- 纯 DI 装配：只把已提供的接口和实现连接起来，不读取环境或选择默认实现。

`AgentDI` 与运行配置只表达装配契约；异步初始化集中在明确入口，不散落到构造函数。

### 4.3 Runtime

`runtime/` 是 `@earendil-works/pi-agent-core` 与 `@earendil-works/pi-ai` 的适配边界，包含 pi Agent 构造、工具桥、上下文压缩桥和非流式生成。它不拥有 Session 持久化或跨 Agent 状态。

原 `reason/generate.ts` 迁入 `runtime/generation/`，避免使用暗示 Core 自建推理循环的 `reason` 名称。

### 4.4 Session

`session/` 统一当前 `session.ts`、`session-manager/` 和 `session-tree/`：

- `model.ts` 定义 Session 领域模型。
- `manager/` 负责 Session 生命周期协调。
- `tree/` 负责父子 Session 上下文投影。

持久化接口仍由 SDK 拥有，SQLite 实现仍属于 Plugin。

### 4.5 Tools

`tools/` 统一工具注册、组合和覆盖：

- Registry 负责定义与 Executor 的注册和解析。
- Composer 负责组合多个 Tool Provider。
- Overlay 负责在单次 Agent 运行中覆盖或补充工具。

具体文件系统工具和内置工具继续放在 `plugins/tool`，不进入 Core 工具编排层。

### 4.6 Security

`security/` 按安全能力收拢：

- `approval/` 接收原 `execute/*`，负责审批请求和决议状态。
- `permissions/` 负责工具分类和权限评估。
- `rules/` 负责规则模型、匹配和 Rule Engine。
- `workspace/` 负责工作区路径边界与相关异常。
- `tool-policy/` 负责工具策略管线和 profile。

审批不再作为独立的“执行层”；它是工具执行前的安全决策环节。

### 4.7 Capabilities

`capabilities/` 保存 Core 原生但非生命周期本身的能力：

- `todo/` 包含类型、校验错误和 Todo Service。
- `sub-agent/` 包含委派工具、子 Agent 上下文构造和结果格式化。

`delegate-task-v2.ts` 迁移后去除 `v2` 文件名与正式 API 名称。兼容层暂时保留旧导出别名。

### 4.8 SDK、Plugins 与 Infrastructure

- `sdk/` 只定义稳定抽象和跨边界 DTO，不引用具体 Plugin 或 Assembly。
- `plugins/` 实现 SDK，不拥有 Agent 生命周期，也不反向依赖 Assembly。
- `infrastructure/` 适配外部模型、MCP、文件路径与日志设施。
- `shared/` 仅包含无业务依赖的纯工具；日志不属于 `shared`。

## 5. 现有模块迁移映射

| 当前模块 | 目标模块 | 动作 |
|---|---|---|
| `rem-agent.ts`、`rem-agent-event.ts`、`event-queue.ts` | `agent/` | 收拢并拆分运行状态与输出构造 |
| `agent-context.ts` | `agent/context/` | 拆分类型、解析和工具注入 |
| `agent-factory.ts`、`agent-context-builder.ts`、`agent-context-assembler.ts` | `assembly/` | 明确工厂、默认构造和纯装配 |
| `agent-di.ts`、`agent-runtime-config.ts` | `assembly/` | 作为装配契约 |
| `assemble-pi-agent.ts`、`run-agent/*`、`pi-agent-like.ts` | `runtime/` | 形成完整 pi-agent 适配边界 |
| `reason/generate.ts` | `runtime/generation/` | 更名并收拢非流式生成 |
| `session.ts`、`session-manager/*`、`session-tree/*` | `session/` | 统一 Session 领域 |
| `tool-composer.ts`、`tool-overlay.ts`、`registry/tool-registry.ts` | `tools/` | 统一工具编排 |
| `execute/*` | `security/approval/` | 归入安全能力 |
| `security/workspace-*` | `security/workspace/` | 收拢工作区边界 |
| `security/tool-policy-*` | `security/tool-policy/` | 收拢工具策略 |
| `todo/*` | `capabilities/todo/` | 保持类型、服务、错误分离 |
| `sub-agent/*`、`delegate-task-v2.ts` | `capabilities/sub-agent/` | 统一委派能力并去版本后缀 |
| `llm/*`、`mcp/*`、`config/*` | `infrastructure/` | 统一外部适配 |
| `shared/debug-log*` | `infrastructure/observability/` | 明确日志基础设施属性 |
| `shared/generate-id.ts` | `shared/` | 保留纯工具 |
| `budget.ts`、`token-usage.ts`、根 `types.ts` | 对应拥有者目录 | 删除根目录杂项聚集 |

## 6. 大文件治理

以下文件必须在相应迁移批次拆分：

- `rem-agent.ts`（217 行）：拆出运行状态与输出构造；标题生成移出生命周期执行单元。
- `plugins/storage/sqlite/schema.ts`（281 行）：按 session、todo、rules、archive、workspace 拆分 schema，由单一入口聚合初始化顺序。
- `plugins/storage/sqlite/session-store.ts`（215 行）：拆出行映射和持久化转换，Store 只保留 CRUD 编排。
- `plugins/config/default/index.ts`（209 行）：`index.ts` 降为纯聚合出口，Provider 实现、初始化和文件监听分别维护。

拆分时遵守模块规范：实现文件绝对上限 200 行、入口文件绝对上限 120 行。测试文件不因本次迁移强制全面拆分，只有触及且超过绝对上限时才处理。

## 7. 依赖规则

核心依赖方向为：

```text
assembly → agent → runtime → tools
    │         │         │
    ├────→ capabilities │
    ├────→ plugins → sdk
    └────→ infrastructure → sdk
```

`session`、`security` 和 `system-prompt` 是可被上层使用的明确能力。补充硬约束如下：

- `sdk/` 不得导入 `plugins/` 或 `assembly/`。
- `agent/` 不得直接导入具体 Plugin。
- `shared/` 不得导入任何业务模块。
- `plugins/` 不得导入 `assembly/`。
- `runtime/` 不得创建默认 Provider 或读取环境配置。
- `infrastructure/` 可以实现或辅助 SDK，但不得控制 Agent 生命周期。
- 跨领域引用优先经过目标模块的公开入口，不跨目录深挖实现文件。

这些规则通过结构测试或静态检查脚本固化，避免目录在后续开发中重新退化。

## 8. 公共 API 与兼容策略

公共 API 分为三类：

1. 稳定 API：Agent 工厂、Agent/Session 核心类型、SDK 接口、宿主明确需要的装配入口。
2. 高级 API：工具注册、安全规则、运行时桥接等，通过显式子路径或受控导出提供。
3. 临时兼容 API：其他 workspace 包当前仍使用、但不应长期保留的内部函数。

根 `index.ts` 只表达经审查的稳定与必要高级 API。所有临时兼容导出集中到 `compat.ts`，根入口可以在本阶段从 `compat.ts` 转出旧名称，以保证调用方无需同步修改。兼容层中每个导出都注明目标 API 和后续删除条件：当所有 workspace 调用方完成迁移后删除。

本阶段允许调整 Core 内部 import 和真实文件路径，但不要求外部包使用新的子路径。

## 9. 迁移顺序

### 批次一：基础设施与纯模块

迁移 LLM、MCP、Config、日志和纯工具。只调整路径与出口，不修改运行逻辑。

### 批次二：Session、Tools 与 Security

统一相关领域目录，拆分 SQLite 大文件和安全子目录。重点验证持久化、工具审批和工作区边界。

### 批次三：Capabilities

迁移 Todo 与 Sub-agent，去除正式实现中的 `v2` 命名，通过兼容层保留旧名称。

### 批次四：Runtime

收拢 pi-agent 构造、工具桥、上下文桥和非流式生成，建立明确的第三方运行时适配边界。

### 批次五：Agent 与 Assembly

最后治理主生命周期，拆分 `REMAgent`，厘清公共工厂、默认构造和纯 DI 装配。

### 批次六：公共出口与文档

收紧根入口，完成 `compat.ts`，增加依赖约束检查，并更新架构文档。删除文档中不存在的 `session-writer.ts` 描述，改为记录真实的消息持久化事件链路。

每个批次独立提交，禁止把全部移动压成单个不可审查提交。

## 10. 行为保持与错误处理

- 保持现有异常类型、错误消息和错误事件结构。
- 目录迁移提交中不改变业务条件分支。
- 对无法通过纯移动完成的拆分，先增加刻画现有行为的测试，再提取实现。
- 审计中发现但不属于目录职责的问题记录为后续任务，不夹带修复。
- 任何需要改变 Session schema、事件协议、Provider 语义或安全决策的发现，都必须暂停并另行设计。

## 11. 测试与完成标准

每个迁移批次至少执行：

```bash
pnpm typecheck
pnpm test
```

针对拆分模块运行更小范围的定向测试，以缩短反馈周期；批次结束仍必须运行全仓验证。

最终结构检查至少覆盖：

- 禁止的目录依赖规则。
- 临时兼容导出只能在 `compat.ts` 汇集。
- `index.ts` 不直接导出未审查的内部实现。
- 源码文件不超过模块规范绝对上限。
- 所有文件使用 kebab-case、NodeNext `.js` 扩展名以及 type/value 分离导入。

完成标准是：Core 目标目录落地、重点大文件完成拆分、公共出口完成分级、文档与代码一致，并且全仓类型检查与测试通过。

