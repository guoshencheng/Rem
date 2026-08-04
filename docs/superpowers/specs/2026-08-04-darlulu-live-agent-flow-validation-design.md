# Darlulu 真实 Agent 流程验证设计

## 背景

Darlulu 已经用一个 Workspace 内的 `assembly`、`template`、`instance`、`port` 和
`connection` 表达父装配体与子装配体。数据修改通过 MCP 工具完成；Template 发布前要
经过验证，完整求解、场景发布和预览则依赖已经连接的 Web 工作台。

当前需要验证的不是一组预先编排好的 API 调用，而是 Rem 中的真实 LLM Agent 能否理解
Darlulu 的操作约束，自主选择和调用工具，最终形成可以由人检查的装配结果。首版只提供
运行与证据采集，不对业务结构作自动断言。未来可以在相同运行产物上增加独立的只读校验
Agent。

Rem 当前活动 Core 已有 live-agent harness 和可注入的 `ToolProvider`，但没有活动的通用
MCP Client 实现。Darlulu MCP Server 已通过 stdio 暴露标准 MCP tools，并在进程内维护
面向 Web 工作台的 WebSocket bridge。

## 目标

- 用 Rem 的真实模型与 Agent 循环执行一次 Darlulu 父子装配流程。
- 自动启动 Darlulu Web 服务和 stdio MCP Server。
- 把 Darlulu MCP tools 动态暴露给该次 Rem Agent 运行。
- 自动打开 Agent 通过 `connect_web` 获取的装配专属工作台 URL。
- 引导 Agent 在一个 Workspace 中创建父装配体、子装配 Template、Template Instance，
  发布 Template，并完成 Render 和预览获取。
- 在终端输出并在文件中保存 Agent 消息、工具调用、工具结果和错误，供人工校验。
- 运行完成后清理脚本创建的服务进程，同时保留 Darlulu Workspace 和浏览器中的检查现场。

## 非目标

- 不为装配结构、尺寸、实例数量或 revision 一致性编写业务断言。
- 不让脚本直接代替 Agent 调用 Darlulu 业务工具。
- 不在本次工作中为 Rem Core 建设正式、通用的 MCP 基础设施。
- 不直接导入 Darlulu 内部 application service 或 handler，避免两个仓库在业务实现层耦合。
- 不自动判断最终 3D 结果是否符合设计意图。
- 不实现第二个校验 Agent；仅为以后接入它保留完整运行记录和最终 Workspace。

## 方案选择

采用“独立 live 验证脚本 + 测试范围 MCP ToolProvider 适配器”。

没有选择恢复 Rem Core 通用 MCP Client，因为这会把一次流程验证扩大成公共基础设施建设；
也没有直接包装 Darlulu handler，因为这样无法覆盖真实 MCP transport、工具发现和调用链路。
适配器位于 Rem 的 testing/live-agent 边界，只服务该命令，不进入通用 Agent 运行时的默认
装配。

## 架构

```text
验证命令
  ├─ Darlulu Web process (Vite)
  ├─ Darlulu MCP process (stdio)
  │    └─ WebSocket bridge
  └─ Rem live REMAgent
       ├─ Darlulu skill / 任务提示
       └─ MCP ToolProvider adapter
            ├─ tools/list → Rem pi.Tool[]
            ├─ tools/call → Darlulu MCP
            └─ connect_web result → host URL opener
```

### 验证命令

在 Rem 根目录增加一个明确的 live 命令，例如：

```bash
pnpm test:darlulu:live
```

命令使用固定的 Darlulu 仓库默认路径
`/Users/guoshencheng/Documents/work/darlulu`，同时允许通过命令行参数覆盖，以免脚本只能在
单台机器使用。模型与认证仍由 Rem Core 的配置入口解析，脚本不直接读取 provider API
key。

### 进程管理

脚本负责以下生命周期：

1. 检查 Darlulu 路径和必要入口。
2. 启动或复用可用的 Darlulu Web 服务，并通过 HTTP readiness 检查确认页面可访问。
3. 通过 MCP SDK 的 stdio transport 启动 Darlulu MCP Server。
4. MCP 初始化和工具发现完成后才启动 Rem Agent。
5. Agent 正常结束、失败或收到中断时关闭 MCP client 以及脚本创建的子进程。

脚本只终止自己创建并持有句柄的进程，不按端口或进程名批量杀进程。Darlulu Workspace
使用其正常持久化位置，脚本不在清理阶段删除装配数据。

### MCP ToolProvider 适配器

适配器实现 Rem `ToolProvider` 接口：

- 初始化时调用 MCP `tools/list`；
- 将 MCP JSON Schema 转为 Rem/pi-agent 可接受的工具参数 schema；
- 保留服务端工具名称和描述，使 Agent 看到的能力与 Darlulu MCP 一致；
- 执行时使用 MCP `tools/call`，完整返回结构化或文本结果；
- transport、协议和服务端错误转换为对 Agent 可见的工具失败，同时写入运行记录。

适配器不理解 `apply_template`、`apply_instance` 等业务参数，也不替 Agent规划调用顺序。

`connect_web` 是唯一的宿主副作用钩子：调用成功并返回 URL 后，适配器使用平台 URL opener
打开完整 URL。打开动作不等于 Web 已连接，Agent仍必须调用
`wait_for_web_connection`，并根据其结果决定是否继续 Render。

### Agent 任务与技能

Agent 使用 Rem 的真实 LLM 配置和正常 Agent loop。该次运行只注入 Darlulu MCP tools，避免
无关的文件系统或 shell 工具绕开验证路径。任务提示明确业务目标和人工验收要求，但不提供
逐条工具调用答案。

固定场景为：

- 创建一个包含父装配体的单一 Workspace；
- 创建一个可发布的子装配 Template；
- 在父装配体中创建至少一个该 Template 的 Instance；
- 由 Agent按 Darlulu 规则完成 Template 验证、发布、Web 连接、Render 和预览获取；
- 最终回复报告 `assemblyId`，方便人工定位结果。

Darlulu assembly designer skill 应作为 Agent 可读取的工作流知识提供。脚本不复制整份 skill
到任务提示；若 Rem 当前 skill provider 无法直接挂载外部单个 skill，则在 testing 边界增加
最小目录映射，而不是改写 Darlulu skill 内容。

## 数据流

```text
用户运行命令
→ Web readiness
→ MCP initialize + tools/list
→ 创建临时 Rem Session
→ Agent读取任务与 Darlulu skill
→ Agent自主调用 manage/apply/validate/publish 工具
→ connect_web 返回 assembly-scoped URL
→ 宿主打开 URL
→ Agent调用 wait_for_web_connection
→ Agent调用 render_assembly / get_preview_image
→ 输出最终回复与运行记录路径
→ 清理脚本创建的服务进程
```

## 运行记录与人工验收

终端继续使用现有 live-agent 的事件格式，便于实时观察。额外写入一个带时间戳的日志文件，
至少包含：

- 启动参数与 Darlulu 路径；
- 服务 readiness 和 MCP connection 状态；
- Agent消息；
- 每次工具调用的名称、参数和结果；
- Agent最终回复；
- 错误与退出原因；
- 若能从结果中取得，则记录最终 `assemblyId` 和工作台 URL。

日志属于运行产物，不提交到 Git。人工验收者根据最终回复中的 `assemblyId`、保留的 Workspace、
打开的工作台页面和工具轨迹判断 Agent 是否正确执行了父子装配流程。

## 错误与退出语义

以下基础设施或运行故障返回非零：

- Darlulu 路径或构建入口不存在；
- Web 服务未能在超时内 ready；
- MCP 进程启动、初始化或工具发现失败；
- Rem Agent产生 runtime error；
- 宿主无法打开工作台 URL，导致流程无法继续；
- 运行被信号中断。

Agent 正常结束但业务结果不理想，不由脚本判失败。日志和最终 Workspace 会保留，交由人工
判断。这个边界避免把首版悄然变成一套不完整、容易误判的业务校验器。

## 测试策略

自动测试只覆盖脚本基础设施，不覆盖最终装配语义：

- 命令参数和默认路径解析；
- MCP tool definition 到 Rem tool 的转换；
- 工具调用和错误转发；
- `connect_web` 成功结果触发一次 URL opener；
- 非 `connect_web` 工具不触发 opener；
- 子进程只清理自身创建的句柄；
- 日志记录器写入关键事件。

真实 live 命令作为人工运行的集成验证，不进入默认 `pnpm test`，避免依赖模型凭据、浏览器
和本地端口。

## 后续扩展

未来可以在执行 Agent结束后启动一个独立、只读的校验 Agent。它读取
`get_assembly(full)`、`get_render_status`、预览图和本次工具轨迹，给出结构与视觉评估，但
不修改原 Workspace。这个扩展不改变首版执行 Agent、MCP 适配器或日志格式的职责边界。
